// Checks that package.json, src/mcp.ts, and src/version.ts all agree on the
// version. Run as the final step of `npm run build`.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const versionTs = fs.readFileSync(path.join(root, 'src', 'version.ts'), 'utf8');
const mcpTs = fs.readFileSync(path.join(root, 'src', 'mcp.ts'), 'utf8');

const errors = [];

// version.ts must read from package.json, so just confirm it references the
// JSON import (the single source of truth).
if (!versionTs.includes('package.json')) {
  errors.push('src/version.ts does not import package.json');
}

// mcp.ts must NOT hardcode a literal version string.
const hardcoded = mcpTs.match(/version:\s*['"](\d[^'"]*)['"]/);
if (hardcoded) {
  errors.push(`src/mcp.ts hardcodes version '${hardcoded[1]}' — use PACKAGE_VERSION`);
}

if (errors.length) {
  console.error('Version consistency check FAILED:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`v${pkg.version} — version consistency OK`);
