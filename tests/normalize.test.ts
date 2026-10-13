import { normalizeSignature, signature, redactSecrets } from '../src/normalize.js';
import { test } from 'node:test';
import assert from 'node:assert';

// --- Signature normalization ---

test('same error, different paths → same signature', () => {
  const a = normalizeSignature("Cannot find module '/src/foo.ts'");
  const b = normalizeSignature("Cannot find module '/lib/bar.ts'");
  assert.equal(a, b);
});

test('line numbers stripped, signature identical', () => {
  const a = normalizeSignature('Error at /foo/bar.ts:42:7');
  const b = normalizeSignature('Error at /foo/bar.ts:10:3');
  assert.equal(a, b);
});

test('timestamps and ports stripped', () => {
  const a = normalizeSignature('GET http://localhost:3000/api 500 in 123ms');
  const b = normalizeSignature('GET http://127.0.0.1:8080/api 404 in 456ms');
  assert.equal(a, b);
});

test('UUIDs normalized', () => {
  const a = signature('User 550e8400-e29b-41d4-a716-446655440000 not found');
  const b = signature('User 6ba7b810-9dad-11d1-80b4-00c04fd430c8 not found');
  assert.equal(a, b);
});

test('version numbers normalized', () => {
  const a = normalizeSignature('react@18.2.0 failed');
  const b = normalizeSignature('react@19.0.1 failed');
  assert.equal(a, b);
});

test('case-insensitive + whitespace collapse', () => {
  const a = normalizeSignature('  Error:   Something   BAD happened  ');
  const b = normalizeSignature('error: something bad happened');
  assert.equal(a, b);
});

test('signature is deterministic sha1 hex', () => {
  assert.equal(signature('test'), signature('test'));
  assert.match(signature('err'), /^[0-9a-f]{40}$/);
});

// --- Secret redaction ---

test('redacts API key', () => {
  const out = redactSecrets('API_KEY=sk-abc123def456gh789ijkl012mnop345qrst');
  assert.equal(out.includes('sk-'), false);
  assert.ok(out.includes('[SK-KEY]') || out.includes('[TOKEN]') || out.includes('[SECRET]'));
});

test('redacts email', () => {
  assert.equal(
    redactSecrets('contact me at john@example.com please'),
    'contact me at [EMAIL] please'
  );
});

test('redacts bearer token', () => {
  assert.equal(
    redactSecrets('Authorization: Bearer abc123.def456.ghi789'),
    'Authorization: Bearer [TOKEN]'
  );
});

test('redacts env-style password', () => {
  const out = redactSecrets('password: "super-secret-123"');
  assert.ok(out.includes('[SECRET]') || out.includes('[TOKEN]'));
  assert.equal(out.includes('super-secret'), false);
});

test('private key redacted', () => {
  const out = redactSecrets('-----BEGIN RSA PRIVATE KEY-----\nabc==\n-----END RSA PRIVATE KEY-----');
  assert.ok(out.includes('[PRIVATE-KEY]'));
});

// --- v0.2.1 regression: TOKEN redaction leak ---

test('long token (32+ chars, no suffix) fully redacted — no leak', () => {
  const secret = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const out = redactSecrets(`TOKEN=${secret}`);
  assert.equal(out.includes(secret), false, 'secret must not appear in output');
  assert.ok(out.includes('[SECRET]') || out.includes('[TOKEN]'), 'must carry a redaction marker');
});

test('long token with trailing space redacted (regression of $1 leak)', () => {
  const secret = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const out = redactSecrets(`TOKEN=${secret} `);
  assert.equal(out.includes(secret), false, 'secret must not appear in output');
  assert.ok(out.includes('[SECRET]') || out.includes('[TOKEN]'), 'must carry a redaction marker');
});

test('bearer token with trailing space fully redacted', () => {
  const secret = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const out = redactSecrets(`Authorization: Bearer ${secret} `);
  assert.equal(out.includes(secret), false, 'token must not leak');
  assert.ok(out.includes('[TOKEN]'));
});

test('api key and github pat redacted', () => {
  const sk = 'sk-abcDEF123456789012345678901234';
  const pat = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  const out = redactSecrets(`key=${sk}\npat=${pat}`);
  assert.equal(out.includes(sk), false);
  assert.equal(out.includes(pat), false);
  assert.ok(out.includes('[SK-KEY]'));
  assert.ok(out.includes('[GHP-TOKEN]'));
});
