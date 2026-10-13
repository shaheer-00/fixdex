import { FixdexDB } from '../src/db.js';
import { test } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const db = new FixdexDB(join(tmpdir(), `fixdex-test-${process.pid}.db`));

// fresh schema
db.save({
  problem_title: 'Test error A', symptoms: 'Error: something broke at /path/to/file.ts:10:5',
  summary: 'Test A fix', tags: 'test', project: 'demo',
});
db.save({
  problem_title: 'Test error B', symptoms: 'Error: something broke at /other/file.ts:20:3',
  summary: 'Test B fix', tags: 'test', project: 'other',
});

test('dedup on signature', () => {
  // same-normalized symptoms → same signature → merged
  const before = db.counts().total;
  db.save({
    problem_title: 'Test error A variant', symptoms: 'Error: something broke at /path/to/file.ts:11:6',
    summary: 'Test A fix', tags: 'test', project: 'demo',
  });
  assert.equal(db.counts().total, before); // not a new row
});

test('exact signature search', () => {
  const hits = db.search('Error: something broke at /path/to/file.ts:10:5');
  assert.ok(hits.length >= 1);
  assert.ok(hits[0].confidence > 0.5);
});

test('FTS keyword search', () => {
  // search by keyword not path/line
  const hits = db.search('something broke');
  assert.ok(hits.length >= 1);
});

test('get returns full entry', () => {
  const all = db.list({});
  assert.ok(all.length >= 1);
  const full = db.get(all[0].id);
  if (!full) throw new Error('entry not found');
  assert.ok(full.problem_title);
  assert.ok(full.symptoms);
  assert.ok(full.summary);
});

test('feedback updates counters', () => {
  const all = db.list({});
  const id = all[0].id;
  const before = db.get(id)!.times_helped;
  db.feedback(id, true);
  assert.equal(db.get(id)!.times_helped, before + 1);
});

test('open problems list', () => {
  const all = db.list({});
  const ids = all.map(e => e.id);
  // mark one as open
  db.raw('UPDATE entries SET status = ? WHERE id = ?').run('open', ids[0]);
  const open = db.openProblems();
  assert.ok(open.some(e => e.id === ids[0]));
});

test('counts correct', () => {
  const c = db.counts();
  assert.equal(c.total, c.solved + c.open);
});

// --- v0.2.1 regression tests ---

test('save accepts status and persists it', () => {
  const e = db.save({
    problem_title: 'Custom status', symptoms: 'boom', summary: 's',
    tags: 't', project: 'p', status: 'solved',
  });
  assert.equal(e.status, 'solved');
});

test('save defaults to open', () => {
  const e = db.save({ problem_title: 'Open item', symptoms: 'boom', summary: 's' });
  assert.equal(e.status, 'open');
});

test('empty query search returns [] not a crash', () => {
  const hits = db.search('');
  assert.deepEqual(hits, []);
});

test('update recomputes signature when symptoms change', () => {
  const e = db.save({
    problem_title: 'Original', symptoms: 'Error: path to /a.ts:1',
    root_cause: 'rc', solution: 'sol', summary: 's',
  });
  const oldSig = e.signature;
  assert.equal(db.update(e.id, { symptoms: 'Error: path to /b.ts:2, different' }), true);
  const updated = db.get(e.id)!;
  assert.notEqual(updated.signature, oldSig, 'signature must change with symptoms');
  const hits = db.search('Error: path to /b.ts:2, different');
  assert.ok(hits.length >= 1, 'new symptoms must resolve via exact match');
});

test('update redacts secrets on each field', () => {
  const e = db.save({
    problem_title: 'Leak', symptoms: 'fail here', summary: 's',
  });
  db.update(e.id, { solution: 'sk-abcdefghijklmnopqrstuvwxyz0123456789' });
  const u = db.get(e.id)!;
  assert.equal(u.solution, '[SK-KEY]', 'solution must be redacted on update');
});

test('update refuses symptom edit that collides with another entry signature', () => {
  // Use text that produces distinct signatures (normalizeSignature strips
  // bare numbers, so 'unique-1' and 'unique-2' hash identically).
  const a = db.save({ problem_title: 'A', symptoms: 'Error alpha in module', summary: 's1' });
  const b = db.save({ problem_title: 'B', symptoms: 'Error beta in module', summary: 's2' });
  const bSymptoms = db.get(b.id)!.symptoms;
  assert.notEqual(a.signature, b.signature, 'seed data must be distinct signatures');
  assert.throws(() => db.update(a.id, { symptoms: bSymptoms }), /collide/);
});

test('prune keeps solved entries with one failure (no auto-downvote deletion)', () => {
  const e = db.save({
    problem_title: 'Fragile fix', symptoms: 'flaky', summary: 's',
    root_cause: 'rc', solution: 'sol',
  });
  db.update(e.id, { status: 'solved' });
  db.feedback(e.id, false); // one downvote
  const pruned = db.prune(0); // 0 days = prune everything stale
  const stillThere = db.get(e.id);
  assert.ok(stillThere, 'entry with one failure must survive prune');
});

test('findSolvedBySignature redacts input like save() does', () => {
  // Bug: save() hashed redact(symptoms); lookups hashed raw text.
  // An error containing a redactable token must still match.
  const symptoms = 'EADDRINUSE: TOKEN=abcdefghijklmnopqrstuvwxyz0123456789abcdefGHIJKL';
  db.save({
    problem_title: 'Port conflict', symptoms, summary: 'kill the process',
    root_cause: 'rc', solution: 'sol', status: 'solved',
  });
  // Lookup with the RAW (un-redacted) text — should still resolve because
  // findSolvedBySignature now redacts before hashing, matching save().
  const hit = db.findSolvedBySignature(symptoms);
  assert.ok(hit, 'lookup with raw secret text must match saved entry');
  assert.equal(hit!.summary, 'kill the process');
});

test('findBySignature also redacts', () => {
  const s = 'Error: bad thing TOKEN=abcdefghijklmnopqrstuvwxyz0123456789abcdefGHIJKL';
  db.save({ problem_title: 'BySig', symptoms: s, summary: 'bysig fix' });
  const hit = db.findBySignature(s);
  assert.ok(hit, 'findBySignature must resolve raw-text lookup via redaction');
});
