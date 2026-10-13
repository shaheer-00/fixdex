// SessionStart hook — brief one-liner
import { FixdexDB } from '../src/db.js';
const db = new FixdexDB();
const { total } = db.counts();
console.log(`fixdex: active — ${total} known entries`);
