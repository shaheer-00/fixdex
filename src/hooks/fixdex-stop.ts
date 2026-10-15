// Stop / SessionEnd hook — nudges Claude to save fixes for open problems
// that may have been resolved this session.
//
// Claude Code calls on Stop with stdin: { transcript?, ... }
// Stop has no additionalContext channel — emit via systemMessage.
import { FixdexDB } from '../db.js';
import { readHookInput, safeHook, clearCounters, emitSystemMessage } from './io.js';
import { renderLine, renderCard } from './renderer.js';

function safeRender(fn: () => string): string {
  try {
    return fn();
  } catch {
    return '[fixdex] render failed';
  }
}

safeHook(() => {
  const input = readHookInput<{ transcript?: string }>();
  const db = new FixdexDB(process.env.FIXDEX_DB);
  try {
    const open = db.openProblems();
    const transcript = input.transcript ?? '';

    // Session summary compact line (Stop -> systemMessage; no context channel)
    emitSystemMessage(
      safeRender(() => renderLine({
        kind: 'info',
        text: 'session summary: ' + open.length + ' open problem(s) tracked',
      }))
    );

    // Nudge for open problems whose title appears in the transcript.
    // Conservative: never auto-closes anything, only nudges.
    const nudged: number[] = [];
    for (const e of open) {
      if (e.problem_title && transcript.includes(e.problem_title.slice(0, 30))) {
        nudged.push(e.id);
      }
    }

    if (nudged.length) {
      emitSystemMessage(
        safeRender(() => renderCard({
          kind: 'warning',
          title: 'Open problems may be resolved',
          detail: nudged.length + ' open problem(s) touched this session - run fixdex save to record the fix',
          meta: 'review ' + nudged.length,
          actions: 'review ' + nudged.length,
          width: 'fit' as const,
        }))
      );
    }
  } finally {
    db.close();
  }
  clearCounters();
});
