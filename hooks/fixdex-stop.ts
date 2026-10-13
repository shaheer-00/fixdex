// Stop / SessionEnd hook — find open entries resolved this session
import { FixdexDB } from '../src/db.js';
import { FixdexDB as DB } from '../src/db.js';
const db = new FixdexDB();
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
const COUNTER_FILE = join(require('os').homedir(), '.fixdex', '.session-counters.json');

// Heuristic: if an 'open' entry's symptoms signature later appeared as a success
// in the same session (command with exit_code 0 containing the same error),
// nudge to save. We look at recent transcript lines passed via stdin.
const input = JSON.parse(readStdin() || '{}');
const transcript: string = input.transcript ?? '';

// find open entries whose normalized error text is a substring of a recent success block
const open = db.openProblems();
let nudged: number[] = [];
for (const e of open) {
  const needle = e.signature.slice(0, 8);
  // crude: check if error signature string appears in transcript after a "fail" block
  if (transcript.includes(e.problem_title?.slice(0, 30))) {
    nudged.push(e.id);
  }
}
if (nudged.length) {
  console.log(`fixdex: ${nudged.length} open problem(s) may be resolved this session — run \`/fixdex-save\` to record the fix.`);
}

// cleanup counters
if (existsSync(COUNTER_FILE)) unlinkSync(COUNTER_FILE);

function readStdin(): string {
  try {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => {});
    return Buffer.concat(chunks).toString('utf8');
  } catch { return ''; }
}
