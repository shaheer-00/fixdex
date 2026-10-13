// PostToolUse hook — detect a failing Bash result, count repeats within the
// session, and remind Claude when a known fix exists for it.
//
// Claude Code calls POST tool-use with stdin:
//   { tool_name, tool_output, tool_error?, exit_code?, is_error? }
//
// Rules enforced here:
//   — Must never throw (wraps in safeHook).
//   — Must not downvote an entry just because it hasn't been used recently;
//     that was the data-loss vector in v0.2 (downvotes feed prune()).
//   — Exact-match first (signature), so we only nudge on 2nd occurrence.
import { FixdexDB } from '../db.js';
import {
  readHookInput,
  safeHook,
  loadCounters,
  saveCounters,
  emitSystemMessage,
} from './io.js';

interface PostInput {
  tool_name?: string;
  tool_output?: string | object;
  tool_error?: string;
  output?: string | object;
  error?: string;
  exit_code?: number;
  is_error?: boolean;
}

// Anchor patterns that indicate the tool invocation failed.
const ERROR_RE = /\b(fail|error|refus|denied|abort|exited with non-zero|non-zero exit)\b/i;
const SUCCESS_RE = /\b(completed|success|done)\b/i;

function failureText(input: PostInput): string {
  const out = JSON.stringify(input.output ?? input.tool_output ?? input.tool_error ?? input.error ?? '');
  return out;
}

function didFail(input: PostInput): boolean {
  if (input.is_error === true) return true;
  if (input.exit_code != null) return input.exit_code !== 0;
  const text = failureText(input);
  return ERROR_RE.test(text) && !SUCCESS_RE.test(text);
}

safeHook(() => {
  const input = readHookInput<PostInput>();
  if (!didFail(input)) return;

  // Only the Bash tool is wired up (settings.json matcher="Bash"). Still, guard
  // so a stray payload never breaks the session.
  const counters = loadCounters();
  const counter = new FixdexDB(process.env.FIXDEX_DB);
  try {
    const text = failureText(input);
    const sig = counter.getSignature(text);
    counters[sig] = (counters[sig] ?? 0) + 1;
    saveCounters(counters);

    if (counters[sig] >= 2) {
      const hit = counter.findBySignature(text);
      if (hit) {
        if (hit.status === 'open') {
          emitSystemMessage(
            `[Fixdex] Known repeated issue — entry #${hit.id}. Review the saved context before re-debugging.`
          );
        } else {
          emitSystemMessage(
            `[Fixdex] Fix exists (#${hit.id}) — see the saved summary before re-solving.`
          );
        }
      } else {
        emitSystemMessage(
          '[Fixdex] Repeated failure detected. Save the fix after resolving → `fixdex save`.'
        );
      }
    }
  } finally {
    counter.close();
  }
});
