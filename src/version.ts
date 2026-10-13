// Single source of truth for the package version.
// Imported by src/mcp.ts and consumed by a build-time consistency check.
import pkg from '../package.json' with { type: 'json' };

export const PACKAGE_VERSION = pkg.version;
