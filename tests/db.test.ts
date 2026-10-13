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
