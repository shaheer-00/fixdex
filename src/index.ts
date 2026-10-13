// Re-export the public API from a single entry point so that
//   "main": "dist/index.js"  (set in package.json) resolves.
export { FixdexDB } from './db.js';
export type { Entry, SearchHit } from './db.js';
export { redactSecrets, normalizeSignature, signature } from './normalize.js';
export { PACKAGE_VERSION } from './version.js';
