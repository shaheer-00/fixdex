// PostToolUse hook — detect failures, track repeats, mark open entries
import { FixdexDB } from '../src/db.js';

const db = new FixdexDB();

// In-session counter (process-lifetime; hooks run as short-lived CLI per call)
// We use the DB itself: a temp table or a separate file. Use a JSON counter file.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
const COUNTER_FILE = join(require('os').homedir(), '.fixdex', '.session-counters.json');

interface Counters { [sig: string]: number; }

function loadCounters(): Counters {
  if (!existsSync(COUNTER_FILE)) return {};
  try { return JSON.parse(readFileSync(COUNTER_FILE, 'utf8')); } catch { return {}; }
}

function saveCounters(c: Counters) {
  writeFileSync(COUNTER_FILE, JSON.stringify(c, null, 2));
}

// Entry point — Claude Code calls this with JSON on stdin:
//   { tool_name, tool_output_or_error, transcript_snippet }
const input = JSON.parse(readStdin());
const sig = db.getSignature(input.output ?? input.error ?? '');

if (input.exit_code !== 0 || input.error) {
  const counters = loadCounters();
  counters[sig] = (counters[sig] ?? 0) + 1;
  saveCounters(counters);

  if (counters[sig] >= 2) {
    // Mark / create open entry
    const existing = db.db.prepare('SELECT * FROM entries WHERE signature = ? LIMIT 1').get(sig);
    if (existing) {
      if (existing.status === 'open') {
        console.log(`[Fixdex] Known repeated issue — see entry #${existing.id}. Search Fixdex before debugging.`);
      } else {
        console.log(`[Fixdex] Fix exists (#${existing.id}) but hasn't been used recently — review before re-solving.`);
        db.feedback(existing.id, false);
      }
    } else {
      console.log('[Fixdex] New repeated issue detected. Save the fix after solving → `fixdex save`.');
    }
  }
}

function readStdin(): string {
  const chunks: Buffer[] = [];
  let buf = Buffer.alloc(0);
  try {
    const stream = process.stdin;
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => { buf = Buffer.concat(chunks); });
    // synchronous read for hook speed
    buf = Buffer.concat(chunks);
  } catch { /* no stdin */ }
  return buf.toString('utf8');
}
