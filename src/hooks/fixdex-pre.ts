// UserPromptSubmit hook — two jobs:
// 1. If the prompt repeats a known error, inject the saved fix before Claude
//    starts re-debugging.
// 2. If the prompt contains correction keywords (fix, correct, wrong, etc.)
//    AND contains a problem/solution pattern (-> or "use X instead of Y"),
//    auto-save the correction to fixdex so it's remembered.
//
// Claude Code calls POST user-prompt with stdin:
//   { prompt: "..." }
import { FixdexDB } from '../db.js';
import { emitContext, readHookInput, safeHook, loadCounters, saveCounters } from './io.js';

// Keywords that indicate the user is correcting a mistake.
const CORRECTION_RE = /\b(fix|correct|correction|fixed|wrong|mistake|error|bug|should be|use .*instead|should have|instead of)\b/i;

// Pattern: "problem -> solution" or "problem | solution" or "problem instead of Y"
const FIX_PATTERN_RE = /(?:use\s+(.+?)\s+instead|instead of\s+(.+?)|->|→|\|)(.+)/i;

safeHook(() => {
  const { prompt } = readHookInput<{ prompt?: string }>();
  if (!prompt) return;

  const db = new FixdexDB(process.env.FIXDEX_DB);
  try {
    // --- Job 1: inject known fix if prompt matches a solved entry's signature ---
    const hit = db.findSolvedBySignature(prompt);
    if (hit) {
      db.touch(hit.id);
      db.log('hook_inject', hit.id, 'signature');
      emitContext('UserPromptSubmit', `fixdex #${hit.id}: ${hit.summary}`);
    }

    // --- Job 2: auto-capture corrections when user explicitly says "fix/correct/etc" ---
    if (CORRECTION_RE.test(prompt)) {
      let problem: string | null = null;
      let solution: string | null = null;

      // Pattern 1: "problem -> solution" or "problem | solution"
      const parts = prompt.split(/\s*(?:->|\||→)\s*/);
      if (parts.length >= 2 && parts[0].trim().length > 3 && parts[1].trim().length > 3) {
        problem = parts[0].trim();
        solution = parts[1].trim();
      }

      // Pattern 2: "wrong X, use Y instead"
      if (!problem) {
        const wrongUseMatch = prompt.match(/wrong\s+(.+?)(?:,|\.|;)\s+use\s+(.+?)\s+instead/i);
        if (wrongUseMatch) {
          problem = wrongUseMatch[1].trim();
          solution = `use ${wrongUseMatch[2].trim()} instead`;
        }
      }
      // Pattern 3: "use Y instead of X"
      if (!problem) {
        const insteadOfMatch = prompt.match(/use\s+(.+?)\s+instead\s+of\s+(.+?)(?:\s|$)/i);
        if (insteadOfMatch) {
          problem = insteadOfMatch[2].trim();
          solution = `should use ${insteadOfMatch[1].trim()} instead`;
        }
      }

      if (problem && solution && problem.length >= 5 && solution.length >= 5) {
        db.save({
          problem_title: problem.slice(0, 120),
          symptoms: problem,
          solution: solution.slice(0, 800),
          summary: `${problem} → ${solution}`.slice(0, 300),
          description: prompt.slice(0, 500),
          status: 'solved',
          tags: 'auto-captured',
        });
        db.log('auto_save', null, 'user-prompt-correction');
      }

      // Also check: if the user just said "correct" / "fix that" and there's
      // a recent failure in the counters, link the attempt to it
      const counters = loadCounters();
      const counterKeys = Object.keys(counters).filter((k) => counters[k] >= 2);
      if (counterKeys.length > 0) {
        // Re-inject reminder for repeated failures the user is trying to fix
        const recentFail = counterKeys[0];
        const failEntry = db.findBySignature(recentFail);
        if (failEntry) {
          db.recordAttempt(failEntry.id);
          db.log('auto_attempt', failEntry.id, 'user-correction-pattern');
        }
      }
    }
  } finally {
    db.close();
  }
});
