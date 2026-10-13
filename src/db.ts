// SQLite wrapper with Fixdex schema
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { SCHEMA_SQL, CREATE_ENTRIES_SQL } from './schema.js';
import { signature, redactSecrets } from './normalize.js';

// --- limits ---
export const SYMPTOMS_MAX = 500;
export const SOLUTION_MAX = 800;

export interface Entry {
  id: number;
  created_at: string;
  updated_at: string;
  project: string;
  tags: string;
  signature: string;
  problem_title: string;
  symptoms: string;
  root_cause?: string | null;
  solution?: string | null;
  summary?: string | null;
  status: 'open' | 'solved';
  times_seen: number;
  times_helped: number;
  times_failed: number;
  last_used_at?: string | null;
}

export interface SearchHit {
  id: number;
  summary: string;
  confidence: number;
}

export class FixdexDB {
  private db: Database.Database;
  public readonly path: string;

  constructor(dbPath?: string) {
    this.path = dbPath ?? join(homedir(), '.fixdex', 'fixdex.db');
    mkdirSync(join(homedir(), '.fixdex'), { recursive: true });
    this.db = new Database(this.path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.init();
  }

  private init() {
    this.db.exec(CREATE_ENTRIES_SQL);
    this.db.exec(SCHEMA_SQL);
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_signature ON entries(signature)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_entries_project ON entries(project)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_entries_status ON entries(status)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_entries_last_used ON entries(last_used_at)');
  }

  getSignature(text: string): string {
    return signature(text);
  }

  redact(text: string): string {
    return redactSecrets(text);
  }

  // --- Search (layered) ---

  search(query: string, project?: string, tags?: string): SearchHit[] {
    const time = performance.now();
    const sig = this.getSignature(query);
    const redacted = this.redact(query);
    let hits: { id: number; summary: string; score: number }[] = [];

    // Layer 1: exact signature match
    const sigRow = this.db
      .prepare(
        `SELECT id, summary FROM entries WHERE signature = ?${project ? ' AND project = ?' : ''}`
      );
    const row = project
      ? sigRow.get(sig, project)
      : sigRow.get(sig);
    if (row) {
      const r = row as { id: number; summary: string };
      this.recordUsed(r.id);
      this.log('search_hit', r.id, 'exact');
      return [{ id: r.id, summary: r.summary, confidence: 1.0 }];
    }

    // Layer 2: FTS5 BM25 (title/symptoms/cause/tags) — prefix search via default tokenizer
    const term = this.cleanTerm(redacted);
    if (term) {
      const q = `${term}*`;
      let sql = `SELECT fts_entries.rowid AS id, e.summary, bm25(fts_entries) AS score
                 FROM fts_entries JOIN entries e ON fts_entries.rowid = e.id
                 WHERE fts_entries MATCH ?`;
      const params: unknown[] = [q];
      if (project) {
        sql += ' AND e.project = ?';
        params.push(project);
      }
      sql += ' ORDER BY score LIMIT 20';
      hits = this.db.prepare(sql).all(...params) as any[];
    }

    // Layer 3: trigram fallback for partial words / typos (FTS5 trigram MATCH uses bm25 rank)
    if (!hits || hits.length < 2) {
      const q = term ? `${term}*` : ' *';
      let sql = `SELECT trgm_entries.rowid AS id, e.summary, bm25(trgm_entries) AS score
                 FROM trgm_entries JOIN entries e ON trgm_entries.rowid = e.id
                 WHERE trgm_entries MATCH ?`;
      const params: unknown[] = [q];
      if (project) {
        sql += ' AND e.project = ?';
        params.push(project);
      }
      sql += ' ORDER BY score LIMIT 20';
      hits = this.db.prepare(sql).all(...params) as any[];
    }

    if (!hits.length) {
      this.log('search_miss', null, query.slice(0, 140));
      return [];
    }

    // Score: BM25 + project boost + tag boost + help/fail + recency
    const ranked = this.rankHits(hits, query, project, tags);

    if (ranked[0] && ranked[0].confidence > 0.15) {
      this.recordUsed(ranked[0].id);
      this.log('search_hit', ranked[0].id, 'fts');
    }

    // Top 3, confidence scaled 0..1
    return ranked.slice(0, 3).map((h) => ({
      id: h.id,
      summary: h.summary,
      confidence: Math.min(1, h.confidence),
    }));
  }

  private cleanTerm(text: string): string {
    if (!text) return '';
    return text
      .replace(/[`~!@#$%^&*()_+\-=\[\]{};:'"<>?,.\/|/]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private rankHits(
    hits: { id: number; summary: string; score: number }[],
    query: string,
    project?: string,
    tags?: string
  ): { id: number; summary: string; confidence: number }[] {
    const ids = hits.map((h) => h.id);
    const inps = this.db.prepare(`SELECT id, project, tags, times_helped, times_failed, last_used_at, summary
                                  FROM entries WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as any[];
    const byId = new Map(inps.map((r) => [r.id, r]));

    return hits.map((h) => {
      const r = byId.get(h.id);
      if (!r) return { id: h.id, summary: h.summary || '', confidence: 0 };
      const s = typeof r.summary === 'string' ? r.summary : (h.summary || '');
      // BM25 returns negative score (lower = more relevant); convert to 0..1
      const bm25 = h.score < 0 ? -h.score : 0;
      let c = Math.min(1, bm25 / (bm25 + 10)) * 0.7;   // base relevance 0..0.7
      if (project && r.project === project) c += 0.25;
      if (tags && r.tags?.split(',').some((t: string) => tags.split(',').includes(t.trim()))) c += 0.2;
      c += (r.times_helped - r.times_failed) * 0.15;
      if (r.last_used_at) {
        const days = (Date.now() - new Date(r.last_used_at).getTime()) / 86400000;
        c += Math.max(0, 1 - days / 30) * 0.1;
      }
      return { id: r.id, summary: r.summary, confidence: c };
    });
  }

  // --- Reads ---

  get(id: number): Entry | null {
    return this.db.prepare(
      `SELECT * FROM entries WHERE id = ?`
    ).get(id) as Entry | null;
  }

  list(filter?: { project?: string; status?: string; tags?: string; sort?: string }): Entry[] {
    let sql = 'SELECT * FROM entries';
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter?.project) {
      where.push('project = ?');
      params.push(filter.project);
    }
    if (filter?.status) {
      where.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.tags) {
      where.push('tags LIKE ?');
      params.push(`%${filter.tags}%`);
    }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += filter?.sort
      ? ` ORDER BY ${filter.sort} DESC`
      : ' ORDER BY last_used_at DESC';
    return this.db.prepare(sql).all(...params) as Entry[];
  }

  openProblems(): Entry[] {
    return this.db.prepare(
      `SELECT * FROM entries WHERE status = 'open' ORDER BY times_seen DESC`
    ).all() as Entry[];
  }

  // --- Writes ---

  save(params: {
    problem_title: string;
    symptoms: string;
    root_cause?: string | null;
    solution?: string | null;
    summary: string;
    tags?: string | null;
    project?: string | null;
  }): Entry {
    const { problem_title, symptoms, root_cause, solution, summary, tags = '' } = params;
    const project = params.project || process.env.FIXDEX_PROJECT || '';
    const redactedSymptoms = this.redact(symptoms);
    const redactedSolution = solution ? this.redact(solution) : null;
    const redactedCause = root_cause ? this.redact(root_cause) : null;
    const sig = this.getSignature(redactedSymptoms);

    // Dedupe: same signature or similar title
    let existing = this.db
      .prepare('SELECT * FROM entries WHERE signature = ?')
      .get(sig) as Entry | null;
    if (!existing && problem_title.length > 8) {
      const likeRow = this.db
        .prepare(
          `SELECT * FROM entries WHERE problem_title LIKE ? AND project = ? LIMIT 1`
        )
        .get(`%${problem_title.slice(0, 20)}%`, project) as Entry | null;
      if (likeRow) existing = likeRow;
    }

    if (existing) {
      // Merge: increment counters, fill gaps
      const newCause = existing.root_cause || redactedCause;
      const newSol = existing.solution || redactedSolution;
      const newTags = existing.tags ? existing.tags + ',' + tags : tags;
      const newProject = existing.project || project;
      const newSeen = existing.times_seen + 1;
      this.db.prepare(`
        UPDATE entries SET
          updated_at = datetime('now'),
          project = ?, tags = ?, root_cause = ?, solution = ?,
          times_seen = ?, status = 'solved', last_used_at = datetime('now')
        WHERE id = ?
      `).run(newProject, newTags, newCause, newSol, newSeen, existing.id);
      this.log('save', existing.id, 'merged');
      return this.get(existing.id)!;
    }

    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO entries (created_at, updated_at, project, tags, signature,
        problem_title, symptoms, root_cause, solution, summary, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
    `);
    const info = stmt.run(
      now,
      now,
      project,
      tags,
      sig,
      problem_title.slice(0, 120),
      redactedSymptoms.slice(0, SYMPTOMS_MAX),
      redactedCause ? redactedCause.slice(0, 300) : null,
      redactedSolution ? redactedSolution.slice(0, SOLUTION_MAX) : null,
      summary.slice(0, 300)
    ) as { lastInsertRowid: number } | unknown;
    const newId = typeof info === 'object' && info !== null
      ? Number((info as { lastInsertRowid: number }).lastInsertRowid)
      : Number(info);
    this.log('save', newId, 'new');
    return this.get(newId)!;
  }

  raw(sql: string): Database.Statement {
    return this.db.prepare(sql);
  }

  // --- Stats / feedback ---

  recordUsed(id: number): void {
    this.db.prepare(`UPDATE entries SET last_used_at = datetime('now') WHERE id = ?`).run(id);
  }

  feedback(id: number, helped: boolean): void {
    const col = helped ? 'times_helped' : 'times_failed';
    this.db.prepare(`UPDATE entries SET ${col} = ${col} + 1, last_used_at = datetime('now') WHERE id = ?`).run(id);
    this.log(helped ? 'feedback_up' : 'feedback_down', id, null);
  }

  // --- Lifecycle ---

  counts(): { total: number; solved: number; open: number; searches7d: number; hits7d: number } {
    const stats = this.db
      .prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status='solved' THEN 1 ELSE 0 END) as solved,
          SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) as open
        FROM entries
      `)
      .get() as any;
    const act = this.db
      .prepare(`
        SELECT
          SUM(CASE WHEN kind LIKE 'search%' THEN 1 ELSE 0 END) as searches,
          SUM(CASE WHEN kind='search_hit' THEN 1 ELSE 0 END) as hits
        FROM activity WHERE ts >= datetime('now','-7 days')
      `)
      .get() as any;
    return {
      total: stats.total ?? 0, solved: stats.solved ?? 0, open: stats.open ?? 0,
      searches7d: act?.searches ?? 0, hits7d: act?.hits ?? 0,
    };
  }

  countUsedInDays(days: number): number {
    const r = this.db.prepare(
      `SELECT COUNT(*) as n FROM entries WHERE last_used_at IS NULL OR last_used_at < datetime('now', ?)
       AND status='solved'`
    ).get({ days: `-${days} days` }) as { n: number };
    return Number(r?.n ?? 0);
  }

  // Remove stale entries: no usage in 90 days, or failures strictly exceed helps
  prune(daysUnused = 90): number {
    const tx = this.db.transaction(() => {
      const r1 = this.db.prepare(`
        DELETE FROM entries
        WHERE status='solved'
          AND (last_used_at IS NOT NULL AND last_used_at < datetime('now', ?))
      `).run(`-${daysUnused} days`);
      const r2 = this.db.prepare(`
        DELETE FROM entries
        WHERE times_failed > times_helped AND times_failed > 0
      `).run();
      return r1.changes + r2.changes;
    });
    return tx();
  }

  // --- v0.2: activity + aggregate state ---

  log(kind: string, entryId?: number | null, detail?: string | null): void {
    try {
      this.db.prepare('INSERT INTO activity (kind, entry_id, detail) VALUES (?,?,?)')
        .run(kind, entryId ?? null, detail ?? null);
    } catch { /* logging must never break a search */ }
  }

  getConfig(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined;
    return r?.value ?? null;
  }

  setConfig(key: string, value: string): void {
    this.db.prepare('INSERT INTO config (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, value);
  }

  tokenCost(): number {
    return Number(this.getConfig('token_cost') ?? process.env.FIXDEX_TOKEN_COST ?? 150);
  }

  last14(): { date: string; searches: number; hits: number; saves: number }[] {
    const rows = this.db.prepare(`
      SELECT date(ts) as date,
        SUM(CASE WHEN kind LIKE 'search%' THEN 1 ELSE 0 END) as searches,
        SUM(CASE WHEN kind='search_hit' THEN 1 ELSE 0 END) as hits,
        SUM(CASE WHEN kind='save' THEN 1 ELSE 0 END) as saves
      FROM activity WHERE ts >= date('now','-13 days')
      GROUP BY date(ts)
    `).all() as any[];
    const byDate = new Map(rows.map((r) => [r.date, r]));
    const out: { date: string; searches: number; hits: number; saves: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const r = byDate.get(d);
      out.push({ date: d, searches: r?.searches ?? 0, hits: r?.hits ?? 0, saves: r?.saves ?? 0 });
    }
    return out;
  }

  state() {
    const counts = this.counts();
    const projects = this.db.prepare(`
      SELECT project, COUNT(*) as entries,
        SUM(CASE WHEN status='solved' THEN 1 ELSE 0 END) as solved,
        SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) as open
      FROM entries GROUP BY project ORDER BY entries DESC
    `).all() as any[];

    const tagRows = this.db.prepare(`SELECT tags FROM entries WHERE tags != ''`).all() as { tags: string }[];
    const tagMap = new Map<string, number>();
    for (const r of tagRows) {
      for (const t of r.tags.split(',').map((x) => x.trim()).filter(Boolean)) {
        tagMap.set(t, (tagMap.get(t) ?? 0) + 1);
      }
    }
    const tags = [...tagMap.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);

    const cost = this.tokenCost();
    return {
      counts, projects, tags,
      entries: this.list({}),
      activity: this.db.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT 25').all(),
      last14: this.last14(),
      config: { tokenCost: cost },
      estSavedTokens: counts.hits7d * cost,
    };
  }

  merge(from: number, to: number): boolean {
    const a = this.get(from); const b = this.get(to);
    if (!a || !b || from === to) return false;
    const tagSet = new Set([...(a.tags || '').split(','), ...(b.tags || '').split(',')].filter(Boolean));
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE entries SET
          times_seen = ?, times_helped = ?, times_failed = ?,
          tags = ?,
          solution = COALESCE(NULLIF(?, ''), solution),
          root_cause = COALESCE(NULLIF(?, ''), root_cause),
          status = 'solved', updated_at = datetime('now')
        WHERE id = ?
      `).run(
        b.times_seen + a.times_seen, b.times_helped + a.times_helped, b.times_failed + a.times_failed,
        [...tagSet].join(','), a.solution || '', a.root_cause || '', to
      );
      this.db.prepare('DELETE FROM entries WHERE id = ?').run(from);
    });
    tx();
    this.log('merge', to, `merged #${from} into #${to}`);
    return true;
  }

  remove(id: number): boolean {
    const r = this.db.prepare('DELETE FROM entries WHERE id = ?').run(id);
    if (r.changes) this.log('delete', id, null);
    return r.changes > 0;
  }

  update(id: number, fields: Record<string, unknown>): boolean {
    const allowed = ['problem_title','symptoms','root_cause','solution','summary','tags','status','project'];
    const sets: string[] = []; const vals: unknown[] = [];
    for (const k of allowed) {
      if (k in fields && fields[k] != null) { sets.push(`${k} = ?`); vals.push(fields[k]); }
    }
    if (!sets.length) return false;
    sets.push(`updated_at = datetime('now')`);
    vals.push(id);
    const r = this.db.prepare(`UPDATE entries SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    if (r.changes) this.log('edit', id, null);
    return r.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
