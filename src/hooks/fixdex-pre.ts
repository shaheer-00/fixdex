// UserPromptSubmit hook — if the prompt repeats a known error, inject the fix
// before Claude starts debugging it.
//
// Claude Code calls POST user-prompt with stdin:
//   { prompt: "..." }
// On a match we write a single JSON line that Claude surfaces inline.
import { FixdexDB } from '../db.js';
import { emitContext, readHookInput, safeHook } from './io.js';

safeHook(() => {
  const { prompt } = readHookInput<{ prompt?: string }>();
  if (!prompt) return;

  const db = new FixdexDB(process.env.FIXDEX_DB);
  try {
    const hit = db.findSolvedBySignature(prompt);
    if (hit) {
      db.touch(hit.id);
      db.log('hook_inject', hit.id, 'signature');
      emitContext('UserPromptSubmit', `fixdex #${hit.id}: ${hit.summary}`);
    }
  } finally {
    db.close();
  }
});
