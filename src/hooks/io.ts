// Shared hook I/O.
//
// Rules: hooks must (1) never block Claude Code and (2) never throw, because a
// non-zero exit surfaces as an error in the user's session.
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { renderCard, renderLine } from './renderer.js';
import type { CardOpts, LineOpts } from './renderer.js';

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
 * Emit a rendered card into the transcript context.
 *
 * The text is passed through renderCard() so every card has the same
 * framed layout, color scheme, and wrapping. The JSON shape is the only
 * form Claude Code honours for UserPromptSubmit, SessionStart, and PostToolUse:
 *   { hookSpecificOutput: { hookEventName, additionalContext } }
 */
export function emitCard(event: string, opts: CardOpts): void {
  const text = safeRender(() => renderCard(opts));
  writeFileSync(1, JSON.stringify({
    hookSpecificOutput: { hookEventName: event, additionalContext: text },
  }) + '\n');
}

/**
 * Emit a compact one-liner into the transcript context.
 * Used for routine events so the screen isn't flooded.
 */
export function emitLine(event: string, opts: LineOpts): void {
  const text = safeRender(() => renderLine(opts));
  writeFileSync(1, JSON.stringify({
    hookSpecificOutput: { hookEventName: event, additionalContext: text },
  }) + '\n');
}

/**
 * Stop / SessionEnd emits to the transcript via systemMessage — no
 * additionalContext channel. The caller passes already-rendered text.
 */
export function emitSystemMessage(text: string): void {
  writeFileSync(1, JSON.stringify({ systemMessage: text }) + '\n');
}

// Backward-compat: some tests and external callers still use emitContext.
// Keep it as a thin alias that renders a plain-line card.
export function emitContext(event: string, text: string): void {
  emitLine(event, { kind: 'info', text });
}

/**
 * Wrap a render call so rendering failures never break a hook.
 * Falls back to the plain text on any error.
 */
function safeRender(fn: () => string): string {
  try {
    return fn();
  } catch {
    // Last-resort: return the plain text without any framing.
    return '[fixdex: render failed, see log]';
  }
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
