// Shared hook I/O.
//
// Rules: hooks must (1) never block Claude Code and (2) never throw, because a
// non-zero exit surfaces as an error in the user's session.
import { readFileSync } from 'node:fs';
import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const FIXDEX_DIR = join(homedir(), '.fixdex');
export const COUNTER_FILE = join(FIXDEX_DIR, '.session-counters.json');

/**
 * Read all of stdin synchronously.
 *
 * The original hooks attached a 'data' listener and returned immediately — the
 * event loop never yielded, so they always got ''. Read fd 0 directly.
 *
 * EAGAIN happens when stdin is an interactive TTY (someone runs a hook by
 * hand); retry briefly, then give up silently.
 */
export function readStdin(): string {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return readFileSync(0, 'utf8');
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'EAGAIN') continue;
      return '';
    }
  }
  return '';
}

/** Parse hook stdin defensively — malformed payload must not break a hook. */
export function readHookInput<T = Record<string, unknown>>(): T {
  const raw = readStdin().trim();
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return {} as T;
  }
}

/**
 * Inject context into the transcript.
 *
 * This is the only form Claude Code honours: it must be a single JSON object
 * on stdout with `hookSpecificOutput.additionalContext` for UserPromptSubmit,
 * SessionStart, and PostToolUse hooks. (Stop has no context channel — use
 * emitSystemMessage there.)
 */
export function emitContext(event: string, text: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: event, additionalContext: text },
    }) + '\n'
  );
}

/** Stop emits to the transcript via systemMessage — no additionalContext channel. */
export function emitSystemMessage(text: string): void {
  process.stdout.write(JSON.stringify({ systemMessage: text }) + '\n');
}

/**
 * Run a hook body, swallowing anything it throws. Hooks are short-lived
 * processes; a throw would surface as a Claude Code error, which must never
 * happen. Always exits 0.
 */
export async function safeHook(fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
  } catch {
    // Intentionally empty — hook stability is non-negotiable.
  }
  process.exit(0);
}

// --- counter file helpers (in-session failure counting) ---
type Counters = Record<string, number>;

export function loadCounters(): Counters {
  try {
    if (!existsSync(COUNTER_FILE)) return {};
    return JSON.parse(readFileSync(COUNTER_FILE, 'utf8')) as Counters;
  } catch {
    return {};
  }
}

export function saveCounters(c: Counters): void {
  try {
    writeFileSync(COUNTER_FILE, JSON.stringify(c, null, 2), { mode: 0o600 });
  } catch {
    /* counter persistence is best-effort */
  }
}

export function clearCounters(): void {
  try {
    if (existsSync(COUNTER_FILE)) unlinkSync(COUNTER_FILE);
  } catch {
    /* ignore */
  }
}
