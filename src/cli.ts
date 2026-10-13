// CLI entry: fixdex <cmd> [args]
import { FixdexDB } from './db.js';

const args = process.argv.slice(2);
const db = new FixdexDB();

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
    default:
      console.log('Usage: fixdex <search|get|save|stats|open|prune|seed>');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
