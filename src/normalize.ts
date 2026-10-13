// Signature normalization + secret redaction
import crypto from 'crypto';

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Generic 32-64 hex/char hashes
  [new RegExp(/([a-f0-9]{32,64})/gi), '[HASH]'],
  // Long opaque tokens (32+ chars) followed by quote/space/comma
  [new RegExp(/([A-Za-z0-9_-]{32,})(["'\s,)])/g), '$1[TOKEN]$2'],
  // sk-... API keys
  [new RegExp(/sk-[A-Za-z0-9]{20,}/gi), '[SK-KEY]'],
  // GitHub PAT
  [new RegExp(/ghp_[A-Za-z0-9]{36}/gi), '[GHP-TOKEN]'],
  // Bearer auth
  [new RegExp(/Bearer\s+[A-Za-z0-9_.-]+/gi), 'Bearer [TOKEN]'],
  // env-style password=secret
  [new RegExp(/([A-Za-z0-9_]*?(?:password|pass|secret|token|api[_-]?key)[A-Za-z0-9_]*\s*[:=]\s*)["']?[A-Za-z0-9_!@#$%^&*.\-]+["']?/gi), '$1[SECRET]'],
  // Emails
  [new RegExp(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g), '[EMAIL]'],
  // Private keys
  [new RegExp(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g), '[PRIVATE-KEY]'],
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const [re, rep] of SECRET_PATTERNS) {
    out = out.replace(re, rep);
  }
  return out;
}

// Normalize error text for hashing — strips volatile details
export function normalizeSignature(text: string): string {
  if (!text) return '';
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[UUID]')      // UUIDs
    .replace(/\b(?:localhost|127\.0\.0\.1)(?::\d+)?/g, '[HOST]')                                // localhost
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b(?::\d+)?/g, '[IP]')                       // IPv4 (+ port)
    .replace(/(?:\/[\w.-]+)+\.\w+/g, '[PATH]')                                                  // absolute/relative paths
    .replace(/(0x[0-9a-f]+)|(#[0-9a-f]{3,8})\b/gi, '[HEX]')                                    // hex colors & hashes
    .replace(/:\d{1,5}\b/g, '')                                                                // port numbers
    .replace(/\b\d+\.\d+(?:\.\d+)*\b/g, '[VER]')                                               // version-like numbers
    .replace(/\b\d+\b/g, '')                                                                   // standalone numbers (line/col/status refs)
    .replace(/\b\d+[A-Za-z]+\b/g, '')                                                          // number+word tokens (e.g. 123ms)
    .replace(/\b(?:line|col(?:umn)?|row|L\d+)\s*\d+/gi, '')                                    // line/col refs
    .replace(/\s+/g, ' ')                                                                       // collapse whitespace
    .trim()
    .toLowerCase();
}

// Quick test: same error, different details → same signature
// normalizeSignature("Cannot find module '/src/foo.ts'") === normalizeSignature("Cannot find module '/lib/bar.ts'")
export function signature(text: string): string {
  return crypto.createHash('sha1').update(normalizeSignature(text)).digest('hex');
}
