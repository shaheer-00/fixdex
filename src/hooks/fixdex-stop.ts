// Stop / SessionEnd hook — nudges Claude to save fixes for open problems
// that may have been resolved this session.
//
// Claude Code calls on Stop with stdin: { transcript?, ... }
// Stop has no additionalContext channel — emit via systemMessage.
import { FixdexDB } from '../db.js';
import { readHookInput, safeHook, clearCounters, emitSystemMessage } from './io.js';

safeHook(() => {
  const input = readHookInput<{ transcript?: string }>();
  const db = new FixdexDB();
  try {
    const open = db.openProblems();
    const transcript = input.transcript ?? '';
    const nudged: number[] = [];

    for (const e of open) {
      // Loose heuristic: the entry title appears in a recent part of the
      // transcript, suggesting the issue was touched. Conservative — never
      // auto-closes anything, only nudges.
      if (e.problem_title && transcript.includes(e.problem_title.slice(0, 30))) {
        nudged.push(e.id);
      }
    }

    if (nudged.length) {
      emitSystemMessage(
        `fixdex: ${nudged.length} open problem(s) may be resolved this session — run \`fixdex save\` to record the fix.`
      );
    }
  } finally {
    db.close();
  }
  clearCounters();
});
