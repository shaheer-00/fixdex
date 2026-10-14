// DB schema for Fixdex
// Run once on first open: DB.exec(SCHEMA_SQL)

export const SCHEMA_SQL = `
-- Enable FTS5 + trigram
CREATE VIRTUAL TABLE IF NOT EXISTS fts_entries USING fts5(
  problem_title, symptoms, root_cause, tags,
  content='entries', content_rowid='id'
);

CREATE VIRTUAL TABLE IF NOT EXISTS trgm_entries USING fts5(
  problem_title, symptoms, root_cause, tags,
  content='entries', content_rowid='id',
  tokenize='trigram'
);

-- External content triggers keep FTS in sync with main table
CREATE TRIGGER IF NOT EXISTS fts_ai AFTER INSERT ON entries BEGIN
  INSERT INTO fts_entries(rowid, problem_title, symptoms, root_cause, tags)
  VALUES (new.id, new.problem_title, new.symptoms, new.root_cause, new.tags);
  INSERT INTO trgm_entries(rowid, problem_title, symptoms, root_cause, tags)
  VALUES (new.id, new.problem_title, new.symptoms, new.root_cause, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS fts_ad AFTER DELETE ON entries BEGIN
  INSERT INTO fts_entries(fts_entries, rowid, problem_title, symptoms, root_cause, tags)
  VALUES ('delete', old.id, old.problem_title, old.symptoms, old.root_cause, old.tags);
  INSERT INTO trgm_entries(trgm_entries, rowid, problem_title, symptoms, root_cause, tags)
  VALUES ('delete', old.id, old.problem_title, old.symptoms, old.root_cause, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS fts_au AFTER UPDATE ON entries BEGIN
  INSERT INTO fts_entries(fts_entries, rowid, problem_title, symptoms, root_cause, tags)
  VALUES ('delete', old.id, old.problem_title, old.symptoms, old.root_cause, old.tags);
  INSERT INTO fts_entries(rowid, problem_title, symptoms, root_cause, tags)
  VALUES (new.id, new.problem_title, new.symptoms, new.root_cause, new.tags);
  INSERT INTO trgm_entries(trgm_entries, rowid, problem_title, symptoms, root_cause, tags)
  VALUES ('delete', old.id, old.problem_title, old.symptoms, old.root_cause, old.tags);
  INSERT INTO trgm_entries(rowid, problem_title, symptoms, root_cause, tags)
  VALUES (new.id, new.problem_title, new.symptoms, new.root_cause, new.tags);
END;

-- v0.2: activity log + config
CREATE TABLE IF NOT EXISTS activity (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT NOT NULL DEFAULT (datetime('now')),
  kind     TEXT NOT NULL,
  entry_id INTEGER,
  detail   TEXT
);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity(ts);
CREATE INDEX IF NOT EXISTS idx_activity_kind ON activity(kind);

CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export const CREATE_ENTRIES_SQL = `
CREATE TABLE IF NOT EXISTS entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  project         TEXT NOT NULL DEFAULT '',
  tags            TEXT NOT NULL DEFAULT '',
  signature       TEXT NOT NULL,
  problem_title   TEXT NOT NULL,
  symptoms        TEXT NOT NULL,
  root_cause      TEXT,
  solution        TEXT,
  summary         TEXT,
  status          TEXT NOT NULL DEFAULT 'open',
  times_seen      INTEGER NOT NULL DEFAULT 1,
  times_helped    INTEGER NOT NULL DEFAULT 0,
  times_failed    INTEGER NOT NULL DEFAULT 0,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_used_at    TEXT,
  UNIQUE(signature)
)
`;
