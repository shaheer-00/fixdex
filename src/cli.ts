// CLI entry: fixdex <cmd> [args]
import { FixdexDB } from './db.js';
import { redactSecrets } from './normalize.js';
import { renderCard, renderLine, renderModeReport, setVerbosity, getVerbosity } from './hooks/renderer.js';
import type { CardKind } from './hooks/renderer.js';

const args = process.argv.slice(2);
const db = new FixdexDB(process.env.FIXDEX_DB);

/** Color + box helpers for a readable terminal banner. */
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function box(title: string, lines: string[], color = C.cyan) {
  const width = Math.max(title.length, ...lines.map((l) => l.length)) + 2;
  const bar = '─'.repeat(width);
  console.log(`${color}${bar}`);
  console.log(` ${title} `.padStart((width + title.length + 2) / 2 + 1, ' ').slice(0, width));
  console.log(bar + C.reset);
  for (const l of lines) console.log(` ${l}`);
  console.log(`${color}${'─'.repeat(width)}${C.reset}`);
}

async function main() {
  const cmd = args[0] || 'help';
  switch (cmd) {
    case 'search':
      console.log(JSON.stringify(db.search(args.slice(1).join(' ')), null, 2));
      break;
    case 'get':
      console.log(JSON.stringify(db.get(Number(args[1])), null, 2));
      break;
    case 'save': {
      const flags: Record<string, string> = {};
      let positional: string[] = [];
      for (let i = 1; i < args.length; i++) {
        const a = args[i];
        if (a.startsWith('--')) {
          const next = args[i + 1];
          if (next && !next.startsWith('--')) {
            flags[a.slice(2)] = next;
            i++;
          }
        } else {
          positional.push(a);
        }
      }
      const text = positional.join(' ');
      const parts = text.split(/\s*(?:->|\||→)\s*/);
      const title = parts[0] || text;
      const fix = parts[1] || '';
      const e = db.save({
        problem_title: title.slice(0, 120),
        symptoms: title,
        root_cause: flags['root-cause'],
        solution: fix.slice(0, 800),
        summary: (title + (fix ? ' → ' + fix : '')).slice(0, 300),
        description: flags['description'],
        tags: flags['tags'],
        project: flags['project'],
      });
      console.log(`Saved #${e.id}: ${e.problem_title}`);
      break;
    }
    case 'stats':
      console.log(JSON.stringify(db.counts(), null, 2));
      break;
    case 'open':
      console.log(JSON.stringify(db.openProblems(), null, 2));
      break;
    case 'prune':
      db.prune();
      console.log('Pruned.');
      break;
    case 'seed':
      (await import('./seed.js'));
      break;
    case 'recent': {
      // Fixdex recent — terminal banner of top mistakes + solutions.
      // Like claude-mem, surfaces what you've already learned so you
      // don't repeat the same debug session.
      const n = Number(args[1]) || 5;
      const c = db.counts();
      if (c.total === 0) {
        console.log(`${C.dim}fixdex: no saved mistakes yet. Errors you hit twice will land here.${C.reset}`);
        break;
      }
      // Top 3 by impact (helped - failed), solved, most recent first
      const rows = db.raw(`
        SELECT id, problem_title, summary, solution, root_cause, description, attempts, times_seen, times_helped
        FROM entries
        WHERE status = 'solved' AND summary IS NOT NULL
        ORDER BY (times_helped - times_failed) DESC, times_seen DESC, last_used_at DESC
        LIMIT ?
      `).all(n) as Array<{
        id: number; problem_title: string; summary: string;
        solution?: string | null; root_cause?: string | null;
        description?: string | null; attempts: number;
        times_seen: number; times_helped: number;
      }>;
      console.log('');
      box(
        `fixdex • last ${n} mistakes you already solved`,
        rows.length
          ? rows.map((r) => `#${r.id} ${r.problem_title}  ${C.yellow}(${r.times_seen} seen, +${r.times_helped} helped)`)
          : ['none yet'],
      );
      for (const r of rows) {
        const badge = r.attempts > 0 ? ` ${C.yellow}(${r.attempts}x)${C.reset}` : '';
        const seen = r.times_seen > 1 ? ` ${C.yellow}↻${r.times_seen}${C.reset}` : '';
        console.log(`\n${C.bold}#{${r.id}} ${redactSecrets(r.problem_title)}${badge}${seen}${C.reset}`);
        if (r.description) console.log(`  ${C.green}→ ${C.reset}${redactSecrets(r.description)}`);
        else if (r.summary) console.log(`  ${C.green}→ ${C.reset}${C.bold}${redactSecrets(r.summary)}${C.reset}`);
        if (r.root_cause) console.log(`  ${C.dim}rc:${C.reset}  ${redactSecrets(String(r.root_cause))}`);
        if (r.solution) console.log(`  ${C.dim}fix:${C.reset} ${redactSecrets(String(r.solution))}`);
      }
      console.log(`\n${C.dim}fixdex: ${c.solved} solved · ${c.open} open · ${c.total} total · run \`fixdex recent <n>\` for more${C.reset}\n`);
      break;
    }
    case 'verbosity': {
      // fixdex verbosity [quiet|normal|verbose] — read or set notice level.
      const v = args[1];
      if (v === 'quiet' || v === 'normal' || v === 'verbose') {
        setVerbosity(v);
        console.log(`fixdex verbosity: ${v}`);
      } else {
        console.log(`fixdex verbosity: ${getVerbosity()} (options: quiet | normal | verbose)`);
      }
      break;
    }
    case 'notices': {
      // fixdex notices [width] — render sample output for every notice kind,
      // in both color and NO_COLOR mode. Width defaults to 80.
      const width = Number(args[1]) || 80;
      const caps = Math.max(52, Math.min(140, width));
      console.log(`Active mode: ${renderModeReport()}`);
      console.log('');
      const samples: Array<{ kind: CardKind; title: string; detail: string; meta: string; actions: string }> = [
        {
          kind: 'captured',
          title: 'SSH password auth refused on shared hosting',
          detail: 'Fix: switched to key auth on port 22999',
          meta: 'seen 1× · this-project · 2 secrets masked',
          actions: '1 review · 2 save · 0 dismiss',
        },
        {
          kind: 'match',
          title: 'Same error as 3 days ago: SSH auth refused',
          detail: 'Applying saved fix instead of re-debugging',
          meta: 'used 4× · saved Oct 12 · 96% match',
          actions: '1 view fix · 0 dismiss',
        },
        {
          kind: 'saved',
          title: 'SSH password auth refused on shared hosting',
          detail: 'Recorded: key auth on port 22999 works',
          meta: 'saved just now · this-project',
          actions: '1 review · 0 dismiss',
        },
        {
          kind: 'warning',
          title: 'Secrets masked before saving',
          detail: '2 tokens redacted from the entry body',
          meta: 'this-project',
          actions: '0 dismiss',
        },
        {
          kind: 'error',
          title: 'Hook failed: fixdex-post',
          detail: 'Could not open the database file',
          meta: 'exit 0 kept · never fails silently again',
          actions: '1 review',
        },
      ];
      for (const s of samples) {
        console.log(renderCard({ ...s, width: caps }));
        console.log('');
      }
      console.log(renderLine({ kind: 'info', text: 'checked 142 solutions · no match' }));
      console.log(renderLine({ kind: 'info', text: 'ready · 142 solutions loaded' }));
      console.log('');
      console.log('--- NO_COLOR mode ---');
      process.env.NO_COLOR = '1';
      process.stdout.isTTY = false;
      for (const s of samples) {
        console.log(renderCard({ ...s, width: caps }));
        console.log('');
      }
      console.log(renderLine({ kind: 'info', text: 'checked 142 solutions · no match (plain)' }));
      break;
    }
    default:
      console.log('Usage: fixdex <search|get|save|stats|open|prune|seed|recent|verbosity|notices> [args]');
      console.log('       fixdex save "problem -> solution" [--description "..." --tags "..." --project "..."]');
      console.log('       fixdex verbosity [quiet|normal|verbose]');
      console.log('       fixdex notices [width]');
  }
  db.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
