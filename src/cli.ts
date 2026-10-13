// CLI entry: fixdex <cmd> [args]
import { FixdexDB } from './db.js';
import { redactSecrets } from './normalize.js';

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
      const e = db.save({
        problem_title: args[1] || '',
        symptoms: args[2] || '',
        root_cause: args[3],
        solution: args[4],
        summary: args[5] || '',
        tags: args[6],
        project: args[7],
      });
      console.log(`Saved #${e.id}`);
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
        SELECT id, problem_title, summary, solution, root_cause, times_seen, times_helped
        FROM entries
        WHERE status = 'solved' AND summary IS NOT NULL
        ORDER BY (times_helped - times_failed) DESC, last_used_at DESC
        LIMIT ?
      `).all(n) as Array<{
        id: number; problem_title: string; summary: string;
        solution?: string | null; root_cause?: string | null;
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
        console.log(`\n${C.bold}#{${r.id}} ${redactSecrets(r.problem_title)}${C.reset}`);
        if (r.summary) console.log(`  ${C.green}→ ${C.reset}${C.bold}${r.summary}${C.reset}`);
        if (r.solution) console.log(`  ${C.dim}sol:${C.reset} ${redactSecrets(String(r.solution))}`);
        if (r.root_cause) console.log(`  ${C.dim}rc:${C.reset}  ${redactSecrets(String(r.root_cause))}`);
      }
      console.log(`\n${C.dim}fixdex: ${c.solved} solved · ${c.open} open · run \`fixdex recent <n>\` for more${C.reset}\n`);
      break;
    }
    default:
      console.log('Usage: fixdex <search|get|save|stats|open|prune|seed|recent> [args]');
  }
  db.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
