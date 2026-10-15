// UserPromptSubmit hook — two jobs:
// 1. If the prompt repeats a known error, inject the saved fix before Claude
//    starts re-debugging.
// 2. If the prompt contains correction keywords (fix, correct, wrong, etc.)
//    AND contains a problem/solution pattern, auto-save the correction.
//
// Both jobs render their notices through the unified renderer.
import { FixdexDB } from '../db.js';
import { emitCard, emitLine, safeHook, readHookInput, loadCounters } from './io.js';
import { getVerbosity } from './renderer.js';

// Keywords that indicate the user is correcting a mistake.
const CORRECTION_RE = /\b(fix|correct|correction|fixed|wrong|mistake|error|bug|should be|use .*instead|should have|instead of)\b/i;

// Pattern: "problem -> solution" or "problem | solution" or "problem instead of Y"
const FIX_PATTERN_RE = /(?:use\s+(.+?)\s+instead|instead of\s+(.+?)|->|→|\|)(.+)/i;

safeHook(() => {
  const { prompt } = readHookInput<{ prompt?: string }>();
  if (!prompt) return;

  // One notice per hook run: Claude Code treats multi-line stdout as plain
  // text, which would break JSON parsing of the emitted context.
  let noticed = false;

  const db = new FixdexDB(process.env.FIXDEX_DB);
  try {
    // --- Job 1: inject known fix if prompt matches a solved entry's signature ---
    const hit = db.findSolvedBySignature(prompt);
    if (hit) {
      db.touch(hit.id);
      db.log('hook_inject', hit.id, 'signature');

      const seen = hit.times_seen;
      const project = hit.project || 'unknown';
      const actions = `1 view fix · 1 save · 1 dismiss`;

      emitCard('UserPromptSubmit', {
        kind: 'match',
        title: hit.summary ?? hit.problem_title,
        detail: hit.solution ?? '',
        meta: `used ${seen}× · ${project} · entry #${hit.id} saved`,
        actions,
        width: 'fit',
      });
      noticed = true;
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
        // Clean the title: strip leading correction keywords so the title
        // names the issue, not the instruction ("fix the CORS error" → "CORS error").
        const cleanTitle = problem
          .replace(/^(?:please\s+)?(?:fix|correct|repair|solve)\s+(?:the\s+|this\s+|that\s+)?/i, '')
          .replace(/^(?:the\s+|this\s+|that\s+)/i, '')
          .trim() || problem;

        const situation = buildDescription(cleanTitle, solution, prompt);

        const entry = db.save({
          problem_title: cleanTitle.slice(0, 120),
          symptoms: problem,
          solution: solution.slice(0, 800),
          summary: `${cleanTitle} → ${solution}`.slice(0, 300),
          description: situation.slice(0, 1000),
          status: 'solved',
          tags: 'auto-captured',
        });

        db.log('auto_save', null, 'user-prompt-correction');

        // Confirm with a compact line — but never alongside the match card,
        // or Claude Code would see two JSON lines and treat both as text.
        if (getVerbosity() !== 'quiet' && !noticed) {
          emitLine('UserPromptSubmit', {
            kind: 'info',
            text: `auto-captured correction → saved entry #${entry.id}`,
          });
        }

        // Also check: if the user just said "correct" / "fix that" and there's
        // a recent failure in the counters, link the attempt to it
        const counters = loadCounters();
        const counterKeys = Object.keys(counters).filter((k) => counters[k] >= 2);
        if (counterKeys.length > 0) {
          const recentFail = counterKeys[0];
          const failEntry = db.findBySignature(recentFail);
          if (failEntry) {
            db.recordAttempt(failEntry.id);
            db.log('auto_attempt', failEntry.id, 'user-correction-pattern');
          }
        }
      }
    }
  } finally {
    db.close();
  }
});

/**
 * Turn a raw correction prompt into a situation-aware, human-readable
 * description. Raw prompts read like commands ("fix the asset URL -> use
 * s3://prod"); descriptions should read like a memory note anyone can
 * revisit: the situation, what went wrong, what the right move is.
 */
function buildDescription(problem: string, solution: string, rawPrompt: string): string {
  const lines: string[] = [];

  const now = new Date();
  const date = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  lines.push(`Situation: while working on ${now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}, this issue came up — ${problem}.`);

  const note = rawPrompt.trim().replace(/\s+/g, ' ');
  if (note.length > 0 && note.toLowerCase() !== problem.toLowerCase()) {
    lines.push(`Original note: "${note}"`);
  }

  const fix = solution.trim().replace(/\s+/g, ' ');
  if (fix) {
    lines.push(`What to do instead: ${fix.charAt(0).toUpperCase() + fix.slice(1)}.`);
  }

  return lines.join('\n');
}
