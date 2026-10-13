// SessionStart hook — banner: how many fixes Fixdex already knows, plus
// the top 3 you've solved (terminal-friendly, like claude-mem reminders).
import { FixdexDB } from '../db.js';
import { emitContext, safeHook } from './io.js';

safeHook(() => {
  const db = new FixdexDB(process.env.FIXDEX_DB);
  try {
    const { total, solved, open } = db.counts();
    if (total === 0) return;

    const openPart = open > 0 ? `, ${open} open` : '';
    const lines = [`fixdex: ${total} known fixes (${solved} solved${openPart}). Search before re-debugging.`];

    // Top 3 by impact so you start the session with context.
    const rows = db.raw(`
      SELECT id, problem_title, summary
      FROM entries
      WHERE status = 'solved' AND summary IS NOT NULL
      ORDER BY (times_helped - times_failed) DESC, last_used_at DESC
      LIMIT 3
    `).all() as Array<{ id: number; problem_title: string; summary: string }>;
    for (const r of rows) {
      lines.push(`  #${r.id} ${r.problem_title.trim().slice(0, 60)} → ${r.summary.trim().slice(0, 60)}`);
    }

    emitContext('SessionStart', lines.join('\n'));
  } finally {
    db.close();
  }
});
