// PostToolUse hook — detect a failing Bash result, count repeats within the
// session, and remind Claude when a known fix exists for it.
//
// Claude Code calls POST tool-use with stdin:
//   { tool_name, tool_output, tool_error?, exit_code?, is_error? }
//
// Rules enforced here:
//   - Must never throw (wraps in safeHook).
//   - Must not downvote an entry just because it has not been used recently;
//     that was the data-loss vector in v0.2 (downvotes feed prune()).
//   - Exact-match first (signature), so we only nudge on 2nd occurrence.
//   - All output rendered through the unified renderer.
import { FixdexDB } from '../db.js';
import {
  readHookInput,
  safeHook,
  loadCounters,
  saveCounters,
  emitSystemMessage,
} from './io.js';
import { renderCard, renderLine } from './renderer.js';

interface PostInput {
  tool_name?: string;
  tool_output?: string | object;
  tool_error?: string;
  output?: string | object;
  error?: string;
  exit_code?: number;
  is_error?: boolean;
}

const ERROR_RE = /\b(fail|error|refus|denied|abort|exited with non-zero|non-zero exit)\b/i;
const SUCCESS_RE = /\b(completed|success|done)\b/i;

function failureText(input: PostInput): string {
  return JSON.stringify(input.output ?? input.tool_output ?? input.tool_error ?? input.error ?? '');
}

function didFail(input: PostInput): boolean {
  if (input.is_error === true) return true;
  if (input.exit_code != null) return input.exit_code !== 0;
  const text = failureText(input);
  return ERROR_RE.test(text) && !SUCCESS_RE.test(text);
}

/** Wrap rendering in try/catch — hooks must never break. */
function safeRender(fn: () => string): string {
  try {
    return fn();
  } catch {
    return '[Fixdex] render failed';
  }
}

safeHook(() => {
  const input = readHookInput<PostInput>();
  if (!didFail(input)) return;

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
            safeRender(() => renderCard({
              kind: 'captured',
              title: hit.problem_title,
              detail: hit.solution ?? 'No solution recorded yet.',
              meta: 'seen ' + hit.times_seen + '×' + ' · ' + (hit.project || 'unknown') + ' · entry #' + hit.id,
              actions: '1 review · 1 save · 0 dismiss',
              width: 'fit' as const,
            }))
          );
        } else {
          emitSystemMessage(
            safeRender(() => renderCard({
              kind: 'match',
              title: hit.summary ?? hit.problem_title,
              detail: hit.solution ?? '',
              meta: 'used ' + hit.times_seen + '×' + ' · saved entry #' + hit.id + ' · match found',
              actions: '1 view fix · 1 dismiss',
              width: 'fit' as const,
            }))
          );
        }
      } else {
        emitSystemMessage(
          safeRender(() => renderLine({
            kind: 'warning',
            text: 'repeated failure - save the fix after resolving (fixdex save)',
          }))
        );
      }
    }
  } finally {
    counter.close();
  }
});
