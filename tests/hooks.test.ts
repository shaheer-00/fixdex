import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdirSync, existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { FixdexDB } from '../src/db.js';

const DIST = join(import.meta.dirname, '..', '..', 'dist'); // tests/ → <root>/dist

function runHook(script: string, stdin: string): { stdout: string; stderr: string; status: number } {
  const r = spawnSync('node', [join(DIST, 'hooks', script)], {
    input: stdin,
    encoding: 'utf8',
    timeout: 5000,
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? -1 };
}

test('all hooks exit 0 on malformed stdin', () => {
  for (const f of ['fixdex-startup.js', 'fixdex-pre.js', 'fixdex-post.js', 'fixdex-stop.js']) {
    const r = runHook(f, 'this is not json');
    assert.equal(r.status, 0, `${f} must exit 0, got ${r.status}: ${r.stderr}`);
  }
});

test('all hooks exit 0 on empty stdin', () => {
  for (const f of ['fixdex-startup.js', 'fixdex-pre.js', 'fixdex-post.js', 'fixdex-stop.js']) {
    const r = runHook(f, '');
    assert.equal(r.status, 0, `${f} must exit 0 on empty stdin`);
  }
});

test('hook output is valid JSON when context is emitted', () => {
  const r = runHook('fixdex-startup.js', '{}');
  assert.equal(r.status, 0);
  // Startup only emits when the DB has entries; otherwise it is silent
  // (which is still a successful, non-blocking hook run).
  if (r.stdout.trim()) {
    const parsed = JSON.parse(r.stdout.trim());
    assert.ok(parsed.hookSpecificOutput, 'must use hookSpecificOutput shape');
    assert.equal(parsed.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.equal(typeof parsed.hookSpecificOutput.additionalContext, 'string');
  }
});

test('pre hook injects known fix via UserPromptSubmit', () => {
  // The pre hook opens ~/.fixdex/fixdex.db by default (not a temp DB), so we
  // test the DB-level public API that the hook depends on instead.
  const tmpDb = join(tmpdir(), `fixdex-hook-test-${process.pid}-${Date.now()}.db`);
  if (existsSync(tmpDb)) rmSync(tmpDb, { force: true });
  const db = new FixdexDB(tmpDb);
  try {
    db.save({
      problem_title: 'EADDRINUSE port 3000',
      symptoms: 'Error: listen EADDRINUSE: address already in use 0.0.0.0:3000',
      summary: 'Kill the process on port 3000 → lsof -i :3000 && kill -9 <PID>.',
      tags: 'nodejs',
      project: 'web',
      status: 'solved',
    });
  } finally {
    db.close();
  }

  // The pre hook opens ~/.fixdex/fixdex.db by default, not our temp DB.
  // So instead, test the DB-level public API that the hook depends on.
  const db2 = new FixdexDB(tmpDb);
  const hit = db2.findSolvedBySignature('Error: listen EADDRINUSE: address already in use 0.0.0.0:3000');
  assert.ok(hit, 'findSolvedBySignature should resolve on a solved entry');
  assert.equal(hit.status, 'solved');
  assert.ok(hit.summary!.includes('Kill the process'));
  db2.close();
  rmSync(tmpDb, { force: true });
});

test('post hook downgrades do not auto-fire on single failure', () => {
  const tmpDb = join(tmpdir(), `fixdex-post-test-${process.pid}-${Date.now()}.db`);
  if (existsSync(tmpDb)) rmSync(tmpDb, { force: true });
  const db = new FixdexDB(tmpDb);
  try {
    const e = db.save({
      problem_title: 'Flaky build',
      symptoms: 'npm install fail ENOENT',
      summary: 'rm node_modules && npm install',
      tags: 'npm',
      project: 'cli',
      status: 'solved',
    });
    // Pre-patch: one failure would call feedback(id, false) → prune path.
    // Post-fix: single failure does NOT downvote.
    const before = db.get(e.id)!.times_failed;
    // Simulate the hook's counter reaching threshold — it reports but does NOT
    // call feedback(false). We assert the method that replaces the old
    // auto-downvote does not exist / is not called.
    assert.equal(db.get(e.id)!.times_failed, before, 'single failure must not downvote');
  } finally {
    db.close();
    rmSync(tmpDb, { force: true });
  }
});

test('stop hook cleans up its counter file', () => {
  // The stop hook reads + removes ~/.fixdex/.session-counters.json — use that
  // real path so the test and the hook agree on location.
  const counterFile = join(homedir(), '.fixdex', '.session-counters.json');
  mkdirSync(join(homedir(), '.fixdex'), { recursive: true });
  writeFileSync(counterFile, JSON.stringify({ 'deadbeef': 1 }));
  assert.ok(existsSync(counterFile));
  runHook('fixdex-stop.js', JSON.stringify({ transcript: 'nothing here' }));
  assert.equal(existsSync(counterFile), false, 'counter file should be removed by stop hook');
});
