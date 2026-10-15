// SessionStart hook — banner: how many fixes Fixdex already knows, plus
// the top 3 you've solved.  Uses the unified renderer so every card
// shares the same framed layout, colours, and width detection.
import { FixdexDB } from '../db.js';
import { emitCard, emitLine, safeHook } from './io.js';
import { getVerbosity } from './renderer.js';

safeHook(() => {
  const db = new FixdexDB(process.env.FIXDEX_DB);
  try {
    const { total, solved, open } = db.counts();
    if (total === 0) {
      if (getVerbosity() === 'verbose') {
        emitLine('SessionStart', {
          kind: 'info',
          text: 'fixdex · no known fixes yet · ready',
        });
      }
      return;
    }

    const openPart = open > 0 ? `, ${open} open` : '';
    const detail = `${total} known fixes (${solved} solved${openPart})`;

    // Top 3 by impact so you start the session with context.
    const rows = db.raw(`
      SELECT id, problem_title, summary
      FROM entries
      WHERE status = 'solved' AND summary IS NOT NULL
      ORDER BY (times_helped - times_failed) DESC, last_used_at DESC
      LIMIT 3
    `).all() as Array<{ id: number; problem_title: string; summary: string }>;

    const meta = rows.length
      ? rows.map((r) => `#${r.id} ${r.problem_title.trim().slice(0, 40)}`).join(' / ')
      : 'session start';

    const verbosity = getVerbosity();

    if (verbosity !== 'quiet') {
      // In verbose mode, also show the top entries as compact lines.
      if (verbosity === 'verbose') {
        for (const r of rows) {
          const t = r.problem_title.trim().slice(0, 50);
          const s = r.summary.trim().slice(0, 50);
          emitLine('SessionStart', {
            kind: 'match',
            text: `#${r.id} ${t} -> ${s}`,
          });
        }
      }
    }

    emitCard('SessionStart', {
      kind: 'info',
      title: 'fixdex ready',
      detail,
      meta,
      actions: `${solved} solved · ${open} open · ${total} total`,
      width: 'fit',
    });
  } finally {
    db.close();
  }
});
