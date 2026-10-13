// UserPromptSubmit / PreToolUse hook — inject 1-line summary if error matches known signature
import { FixdexDB } from '../src/db.js';

const db = new FixdexDB();
const input = JSON.parse(readStdin());
// input: { prompt_or_tool_input }
const text = input.prompt ?? input.tool_input ?? input.content ?? '';

const sig = db.getSignature(text);
const row = db.db.prepare(
  `SELECT id, summary FROM entries WHERE signature = ? AND status='solved' LIMIT 1`
).get(sig) as { id: number; summary: string } | undefined;

if (row) {
  // Claude reads this on stdout — it surfaces as a passive reminder
  console.log(`\u0001fixdex: Known pattern. ${row.summary} (entry #${row.id})\n`);
  // update usage stats
  db.db.prepare('UPDATE entries SET times_seen = times_seen + 1, last_used_at = datetime(\'now\') WHERE id = ?').run(row.id);
}

function readStdin(): string {
  const chunks: Buffer[] = [];
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => {});
  return Buffer.concat(chunks).toString('utf8');
}
