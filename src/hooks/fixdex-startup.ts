// SessionStart hook — one-line banner: how many fixes Fixdex already knows.
import { FixdexDB } from '../db.js';
import { emitContext, readHookInput, safeHook } from './io.js';

safeHook(() => {
  const input = readHookInput();
  const db = new FixdexDB();
  try {
    const { total, solved, open } = db.counts();
    if (total > 0) {
      const openPart = open > 0 ? `, ${open} open` : '';
      emitContext(
        'SessionStart',
        `fixdex: ${total} known fixes (${solved} solved${openPart}). Search before debugging, save after fixing.`
      );
    }
  } finally {
    db.close();
  }
});
