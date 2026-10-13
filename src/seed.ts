// Seed script: insert ~10 example entries into a fresh Fixdex DB
import { FixdexDB } from './db.js';

const db = new FixdexDB();

const seedEntries = [
  {
    problem_title: 'npm ENOENT: no such file or directory for package-lock.json',
    symptoms: 'npm ERR! enoent ENOENT: no such file or directory, open \'C:\\projects\\myapp\\package-lock.json\'',
    root_cause: 'Lock file referenced but not present (e.g. after partial checkout).',
    solution: 'Run `rm package-lock.json && npm install` to regenerate, or restore from version control.',
    summary: 'Missing package-lock.json on npm install → regenerate or restore from git.',
    tags: 'npm,nodejs',
    project: 'cli',
  },
  {
    problem_title: 'EADDRINUSE port 3000 already in use',
    symptoms: 'Error: listen EADDRINUSE: address already in use 0.0.0.0:3000',
    root_cause: 'Another process (often a previous dev server) holds the port.',
    solution: 'Run `lsof -i :3000` (macOS/Linux) or `netstat -ano | findstr :3000` (Windows), then `kill -9 <PID>`. Or start on a different port: `next -p 3001`.',
    summary: 'Port 3000 occupied → kill existing process or switch ports.',
    tags: 'nodejs,nextjs',
    project: 'web',
  },
  {
    problem_title: 'Git: refusing to merge unrelated histories',
    symptoms: 'fatal: refusing to merge unrelated histories',
    root_cause: 'Remote and local have unrelated root commits.',
    solution: 'Run `git pull --allow-unrelated-histories origin <branch>` and resolve any conflicts, then commit.',
    summary: 'Unrelated git histories → use --allow-unrelated-histories flag.',
    tags: 'git',
    project: '',
  },
  {
    problem_title: 'Cannot find module \'lodash\' after npm install',
    symptoms: 'Error: Cannot find module \'lodash\' / Module not found: Can\'t resolve lodash',
    root_cause: 'Dependency missing from node_modules (incomplete install or wrong workspace).',
    solution: 'Run `npm ls lodash` to verify, then `rm -rf node_modules package-lock.json && npm install`.',
    summary: 'Missing module after install → clean reinstall (rm -rf node_modules package-lock.json).',
    tags: 'npm,nodejs',
    project: 'web',
  },
  {
    problem_title: 'TypeScript TS2307: Cannot find module or its corresponding type declarations',
    symptoms: 'TS2307: Cannot find module \'@types/node\' or its corresponding type declarations.',
    root_cause: '@types package not installed or tsconfig excludes node_modules.',
    solution: 'Run `npm i -D @types/node` and ensure `types: ["node"]` or `"typeRoots": ["./node_modules/@types"]`.',
    summary: 'TS2307 missing types → install @types/* and check tsconfig typeRoots.',
    tags: 'typescript',
    project: '',
  },
  {
    problem_title: 'SQLite database is locked',
    symptoms: '/Error: SQLITE_BUSY: database is locked/',
    root_cause: 'Concurrent write contention — another connection holds the write lock.',
    solution: 'Set `PRAGMA busy_timeout = 5000` before writes; prefer WAL mode; ensure connections close after use.',
    summary: 'SQLite locked → set busy_timeout, use WAL mode.',
    tags: 'sqlite,database',
    project: 'backend',
  },
  {
    problem_title: 'Prerender failed: /api/health returned 500 on Cloudflare Pages',
    symptoms: 'Error: Prerender failed for /api/health — Internal Error',
    root_cause: 'Server-side env vars not available at build time for SSG route.',
    solution: 'Mark the route as `dynamic` via `export const runtime = "nodejs"` or add `prerender = false`.',
    summary: '500 on prerender → mark route dynamic to skip static generation.',
    tags: 'vercel',
    project: 'web',
  },
  {
    problem_title: 'Docker COPY failed: file not found',
    symptoms: 'COPY failed: no source of file named app/build in known locations',
    root_cause: '.dockerignore excludes the build dir or build step not run before COPY.',
    solution: 'Either build inside the Dockerfile (`RUN npm run build`) before COPY, or remove the dir from .dockerignore.',
    summary: 'Docker COPY file not found → check .dockerignore or build before copy.',
    tags: 'docker',
    project: '',
  },
  {
    problem_title: 'WordPress white screen of death — error display off',
    symptoms: 'Blank white page, no errors visible.',
    root_cause: 'PHP errors suppressed (display_errors=Off) or fatal exhausted memory.',
    solution: 'Add `define(\'WP_DEBUG\', true); define(\'WP_DEBUG_DISPLAY\', true);` to wp-config.php, raise `memory_limit`.',
    summary: 'WordPress white screen → enable WP_DEBUG + raise memory_limit.',
    tags: 'wordpress,php',
    project: 'cms',
  },
  {
    problem_title: 'Git: Your local changes would be overwritten by checkout',
    symptoms: 'error: Your local changes to \'src/index.ts\' would be overwritten by checkout.',
    root_cause: 'Uncommitted changes conflict with the target branch version.',
    solution: 'Stash (`git stash`) then checkout; or `git checkout -- <file>` to discard; or commit with `--amend`.',
    summary: 'Git checkout blocked by local changes → stash or discard before switching.',
    tags: 'git',
    project: '',
  },
];

let count = 0;
for (const e of seedEntries) {
  const id = db.save(e);
  // seed entries are solved
  db.raw('UPDATE entries SET status = ?, times_seen = 3, times_helped = 2 WHERE id = ?')
    .run('solved', id.id);
  count++;
}
console.log(`Seeded ${count} entries into ${db.path}`);
