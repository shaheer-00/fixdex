// Single rendering module for all Fixdex notices.
//
// One renderer to rule them all — every hook, every command, calls these two:
//   renderCard({ kind, title, detail, meta, actions }) -> framed ANSI card
//   renderLine({ kind, text })                        -> compact one-liner
//
// Color detection, width detection, word-wrapping, and the no-color fallback
// all live here. No other file in the plugin prints notices.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ─── Types ──────────────────────────────────────────────────────────────

export type CardKind = 'captured' | 'match' | 'saved' | 'warning' | 'error' | 'info';
export type LineKind = CardKind;
export type WidthMode = 'full' | 'fit' | number;

export interface CardOpts {
  kind: CardKind;
  title: string;
  detail: string;
  meta?: string;
  actions?: string;
  width?: WidthMode;
}

export interface LineOpts {
  kind: LineKind;
  text: string;
}

export type Verbosity = 'quiet' | 'normal' | 'verbose';

// ─── Constants ──────────────────────────────────────────────────────────

const FIXDEX_DIR = join(homedir(), '.fixdex');
const CONFIG_FILE = join(FIXDEX_DIR, '.config.json');

const MIN_WIDTH = 52;
const MAX_WIDTH = 140;
const DEFAULT_WIDTH = 100;
const FIT_MIN = 52;
const FIT_MAX = 80;

// ANSI 256-color helpers
const ESC = '\u001b';
function C(n: number): string { return `${ESC}[38;5;${n}m`; }
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const RESET = `${ESC}[0m`;

const COLORS = {
  symbol: 208,     // ✻ = orange
  frame: 240,      // grey
  title: 15,       // bold white
  detail: 252,     // light grey
  meta: 244,       // dim grey
  actionNum: 15,   // white
  actionText: 244, // dim
} as const;

// Header label accent per kind
const HEADER_LABEL: Record<CardKind, { label: string; fg: number }> = {
  captured: { label: 'Mistake captured',         fg: 220 }, // yellow
  match:    { label: 'Past solution found',      fg: 114 }, // green
  saved:    { label: 'Solution saved',           fg: 114 }, // green
  warning:  { label: 'Warning',                  fg: 215 }, // amber
  error:    { label: 'Error',                    fg: 203 }, // red
  info:     { label: 'fixdex',                   fg: 208 }, // orange
};

// ─── Verbosity config ───────────────────────────────────────────────────

interface ConfigStore { verbosity: Verbosity }

function readConfig(): ConfigStore {
  try {
    if (!existsSync(CONFIG_FILE)) return { verbosity: 'normal' as Verbosity };
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as { verbosity?: string };
    return normalizeVerbosity(parsed.verbosity);
  } catch {
    return { verbosity: 'normal' as Verbosity };
  }
}

function normalizeVerbosity(v: string | undefined): ConfigStore {
  if (v === 'quiet' || v === 'normal' || v === 'verbose') return { verbosity: v };
  return { verbosity: 'normal' as Verbosity };
}

export function getVerbosity(): Verbosity {
  return readConfig().verbosity;
}

export function setVerbosity(v: Verbosity): void {
  try {
    writeFileSync(CONFIG_FILE, JSON.stringify({ verbosity: v }, null, 2), { mode: 0o600 });
  } catch {
    // config persistence is best-effort; hooks must never fail
  }
}

// ─── Width detection ────────────────────────────────────────────────────

/**
 * Detect terminal width in this order:
 *   1) process.stdout.columns
 *   2) COLUMNS env var
 *   3) `tput cols` reading from /dev/tty
 *   4) fallback 100
 *
 * Returns 'fit' when width can't be detected reliably, otherwise a number
 * already capped to [MIN_WIDTH, MAX_WIDTH].
 */
export function detectWidth(): 'fit' | number {
  if (process.stdout.columns != null && process.stdout.columns > 0) {
    return clampNumber(process.stdout.columns, MIN_WIDTH, MAX_WIDTH);
  }
  if (process.env.COLUMNS) {
    const n = parseInt(process.env.COLUMNS, 10);
    if (!Number.isNaN(n) && n > 0) {
      return clampNumber(n, MIN_WIDTH, MAX_WIDTH);
    }
  }
  try {
    const out = execFileSync('tput', ['cols'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 });
    const n = parseInt(out.toString().trim(), 10);
    if (!Number.isNaN(n) && n > 0) {
      return clampNumber(n, MIN_WIDTH, MAX_WIDTH);
    }
  } catch {
    // tput unavailable (no TTY)
  }
  return 'fit';
}

function clampNumber(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ─── Color detection ────────────────────────────────────────────────────

export function colorMode(): { enabled: boolean; reason: string; mode: 'color' | 'plain' } {
  // NO_COLOR = force plain text
  if (process.env.NO_COLOR !== undefined) {
    return { enabled: false, mode: 'plain', reason: 'NO_COLOR is set' };
  }
  // No TTY = plain fallback (Claude Code hooks run without a TTY)
  if (!process.stdout.isTTY) {
    return { enabled: false, mode: 'plain', reason: 'no TTY (stdout.isTTY false)' };
  }
  try {
    const out = execFileSync('tput', ['colors'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 });
    const n = parseInt(out.toString().trim(), 10);
    if (!Number.isNaN(n) && n >= 256) {
      return { enabled: true, mode: 'color', reason: `${n} colors supported` };
    }
  } catch {
    // tput unavailable -> plain fallback
  }
  return { enabled: false, mode: 'plain', reason: 'ANSI not detected' };
}

/** Report which rendering mode is active (color vs plain) and why. */
export function renderModeReport(): string {
  const m = colorMode();
  return `rendering mode: ${m.mode} (${m.reason})`;
}

// ─── Text measurement ───────────────────────────────────────────────────

/** Remove ANSI escape codes (any SGR/CSI sequence). */
export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
}

/** Visible character count — handles wide (CJK) chars via Intl.Segmenter. */
export function visibleWidth(text: string): number {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    let w = 0;
    for (const seg of new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(stripAnsi(text))) {
      const len = seg.segment.length;
      w += len > 1 ? 2 : 1; // wide chars count as 2
    }
    return w;
  }
  // Fallback: treat every character as width 1.
  return stripAnsi(text).length;
}

// ─── Wrapping ───────────────────────────────────────────────────────────

/** Word-wrap at word boundaries; never splits a word. */
function wrapWords(text: string, maxWidth: number): string[] {
  const plain = stripAnsi(text);
  const words = plain.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let cur = '';

  for (const w of words) {
    const wv = visibleWidth(w);
    const space = cur ? 1 : 0;
    if (cur && visibleWidth(cur) + space + wv > maxWidth) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + ' ' + w : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ─── Renderer core ──────────────────────────────────────────────────────

/** Split a field into at most 3 wrapped lines, ellipsising the last. */
function fieldLines(text: string, w: number): string[] {
  const all = wrapWords(text, w);
  const out = all.slice(0, 3);
  if (all.length > 3 && out.length === 3) {
    const last = out[2];
    out[2] = (last.length >= 2 ? last.slice(0, -1) : last) + '\u2026';
  }
  return out;
}

/** Content-driven width for `width: 'fit'` — min 52, max 80. */
function fitWidth(opts: CardOpts): number {
  const rows: string[] = [opts.title];
  if (opts.detail) rows.push('\u21b3 ' + opts.detail);
  if (opts.meta) rows.push(opts.meta);
  if (opts.actions) rows.push(opts.actions);
  const longest = Math.max(...rows.map((r) => visibleWidth(r)));
  return clampNumber(longest + 6, FIT_MIN, FIT_MAX);
}

/** Render the full framed card.
 *
 * Layout (plain text shown; colour uses the same widths):
 *
 *   ╭─ ✻ Mistake captured ────────────────────────────╮
 *   │                                                 │
 *   │  SSH password auth refused on shared hosting    │
 *   │  ↳ Fix: switched to key auth on port 22999      │
 *   │  seen 1× · my-site · 2 secrets masked           │
 *   │                                                 │
 *   ╰─ 1 review · 2 save · 0 dismiss ─────────────────╯
 *
 * `width` is the full card width including both borders. Body text wraps at
 * word boundaries, at most 3 lines per field, then "\u2026".
 */
export function renderCard(opts: CardOpts): string {
  const { kind, title, detail, meta, actions, width: widthOpt } = opts;

  const hasColor = colorMode().enabled;
  const label = HEADER_LABEL[kind] ?? HEADER_LABEL.info;

  const width: number = (() => {
    if (typeof widthOpt === 'number') return clampNumber(widthOpt, MIN_WIDTH, MAX_WIDTH);
    if (widthOpt === 'fit') return fitWidth(opts);
    const w = detectWidth();
    return w === 'fit' ? fitWidth(opts) : w;
  })();

  const F = hasColor ? C(COLORS.frame) : '';
  const R = hasColor ? RESET : '';
  const SYM = hasColor ? C(COLORS.symbol) : '';
  const LABEL_FG = hasColor ? C(label.fg) : '';
  const TITLE_FG = hasColor ? BOLD + C(COLORS.title) : '';
  const DETAIL_FG = hasColor ? C(COLORS.detail) : '';
  const META_FG = hasColor ? C(COLORS.meta) : '';
  const ACT_FG = hasColor ? C(COLORS.meta) : '';

  // Width of the text area between the two border columns.
  const fieldW = width - 2;
  const bodyW = Math.max(8, fieldW - 2);    // "  " indent
  const detailW = Math.max(8, fieldW - 4);  // "  \u21b3 " indent

  /** Pad a rendered line to the full inner width, then wrap in borders. */
  const row = (s: string): string => {
    const vw = visibleWidth(s);
    const fill = vw >= fieldW ? '' : ' '.repeat(fieldW - vw);
    return `${F}\u2502${R}${s}${fill}${F}\u2502${R}`;
  };

  const parts: string[] = [];

  // Header, embedded in the top border: "\u256d\u2500 \u273b Label \u2500\u2500\u2500\u256e"
  const headerPlain = '\u273b ' + label.label;
  const headerFill = Math.max(1, width - 5 - visibleWidth(headerPlain));
  parts.push(`${F}\u256d\u2500 ${R}${SYM}\u273b ${LABEL_FG}${label.label}${R} ${F}${'\u2500'.repeat(headerFill)}\u256e${R}`);

  // Blank padding line under the header.
  parts.push(row(''));

  // Title (bold white).
  parts.push(row('  ' + TITLE_FG + title + R));

  // Detail: "  \u21b3 " + text.
  if (detail) {
    for (const line of fieldLines(detail, detailW)) {
      parts.push(row('  ' + DETAIL_FG + '\u21b3 ' + line + R));
    }
  }

  // Meta (dim), joined by " \u00b7 ".
  if (meta) {
    for (const line of fieldLines(meta, bodyW)) {
      parts.push(row('  ' + META_FG + line + R));
    }
  }

  // Blank padding line above the footer.
  parts.push(row(''));

  // Footer, embedded in the bottom border, carrying the actions.
  const footerText = actions ?? '';
  let footerBody = footerText;
  if (hasColor && footerText) {
    footerBody = footerText.replace(/(\d+)/g, C(COLORS.actionNum) + '$1' + R);
  }
  const footerFill = Math.max(1, width - 5 - visibleWidth(footerText));
  parts.push(`${F}\u2570\u2500 ${R}${ACT_FG}${footerBody}${R} ${F}${'\u2500'.repeat(footerFill)}\u2571${R}`.replace('\u2571', '\u256f'));

  return parts.join('\n');
}

/** Compact one-liner: "\u273b <plugin> \u00b7 text" \u2014 dim grey with only \u273b in orange.
 * Used for routine events so the screen isn't flooded. */
export function renderLine(opts: LineOpts): string {
  const { kind, text } = opts;
  const hasColor = colorMode().enabled;
  const label = HEADER_LABEL[kind].label;

  const SYM = hasColor ? C(COLORS.symbol) : '';
  const DIM_FG = hasColor ? DIM : '';
  const R = hasColor ? RESET : '';
  return `${SYM}\u273b ${DIM_FG}${label} \u00b7 ${text}${R}`;
}
