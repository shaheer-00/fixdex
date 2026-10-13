# 🔧 Fixdex — Local Error / Fix Memory for Claude Code

> Fixdex records every problem Claude Code hits twice and its solution. The next time a similar error appears, Fixdex **injects the saved fix before Claude starts debugging** — saving tokens and developer time. All data stays on your machine. No network calls.
[![Instagram](https://img.shields.io/badge/Instagram-@shaheer0.0-black?logo=instagram)](https://www.instagram.com/shaheer0.0/)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FF8921?logo=buymeacoffee&logoColor=white)](https://buymeacoffee.com/shaheer0.0)

---

## ✨ Why

When you debug the same `EADDRINUSE` or `Cannot find module` twice, Claude wastes ~150k tokens re-deriving the fix it already found once. Fixdex turns that into a **0-token lookup**: a 40-byte signature hash matches instantly, or a ranked FTS search returns the 1-line summary of the best fix.

**Layered search (stops at first confident match):**

| Layer | What | Tokens |
|-------|------|--------|
| 1️⃣ | **Exact signature** (sha1 of normalized error — paths, ports, UUIDs, line numbers all stripped) | ~0 |
| 2️⃣ | **FTS5 BM25** over title / symptoms / root cause / tags (prefix + trigram) | low |
| 3️⃣ | **Scored re-rank** of top-20: BM25 + project boost + tag boost + help/fail delta + recency | top-3 |

---

## 🚀 Quick start

```bash
# from the repo
npm install
npm run build

# register the MCP server in Claude Code
claude config mcp add fixdex -- cmd=./fixdex/dist/mcp.js

# open the dashboard
npm run ui
# → http://localhost:4747
```

### Install hooks (optional, recommended)

Copy the hooks into your global Claude Code settings (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "fixdex": { "command": "node", "args": ["<path-to-fixdex/dist/mcp.js"] }
  },
  "hooks": {
    "SessionStart": [{ "type": "command", "command": "node <path-to-fixdex/dist/hooks/fixdex-startup.js" }],
    "PostToolUse":  [{ "type": "command", "command": "node <path-to-fixdex/dist/hooks/fixdex-post.js", "matcher": "Bash" }],
    "UserPromptSubmit": [{ "type": "command", "command": "node <path-to-fixdex/dist/hooks/fixdex-pre.js" }],
    "Stop":          [{ "type": "command", "command": "node <path-to-fixdex/dist/hooks/fixdex-stop.js" }]
  }
}
```

The hooks live in [`fixdex/dist/hooks/`](fixdex/dist/hooks) after building.

---

## 🛠️ MCP tools

All available once the MCP server is registered:

| Tool | Args | Returns |
|------|------|---------|
| `fixdex_search` | `query`, `project?`, `tags?` | top 3 `{id, summary, confidence}` |
| `fixdex_get` | `id` | full entry |
| `fixdex_save` | `problem_title, symptoms, root_cause, solution, summary, tags, project` | entry id (**deduped**) |
| `fixdex_feedback` | `id, helped: bool` | updates stats (good fixes rank up) |
| `fixdex_open` | — | unresolved repeated problems |

### Using from Claude Code

```
/fixdex-search EADDRINUSE port 3000
→ #2  Port 3000 occupied → kill existing process or switch ports.  conf 0.92

/fixdex-save "EADDRINUSE port 3000" "Error: listen EADDRINUSE..." "Previous dev server holds port." "lsof -i :3000 && kill -9 <PID>" "Kill process on port 3000." "nodejs,linux"
→ Saved #3 (sig=4a1f2c…)
```

---

## 📊 Web dashboard

Start with `npm run ui` (or `node dist/ui.js`). Serves from `http://localhost:4747`.

- **Dashboard** — total / solved / open entries, 7-day searches vs hits (inline SVG charts), estimated tokens saved
- **Entries** — live search, filter by project / tag / status, sort by most used / recent
- **Open problems** — repeated errors still without a fix
- **Settings** — token-cost estimate, prune stale entries, export JSON

All charts use inline SVG — no CDN, no network.

---

## 🔒 Safety

| ✅ | Guarantee |
|---|-----------|
| **Secrets redacted** | API keys, Bearer tokens, passwords, `.env` keys, private keys, emails replaced with `[SECRET]` / `[TOKEN]` / `[EMAIL]` / `[PRIVATE-KEY]` |
| **Signature dedup** | Same error text (after normalization) → merged, never duplicated |
| **Size caps** | Symptoms ≤ 500 chars, solution ≤ 800 chars, title ≤ 120 chars |
| **Offline only** | No telemetry, no external calls. DB lives at `~/.fixdex/fixdex.db` |
| **Auto-prune** | 90-day-stale or failures > helps → flagged / removable via `fixdex prune` |
| **Safe hooks** | If the DB is missing or locked, hooks skip silently (never block Claude Code) |

---

## 🧪 Tests

```bash
npm test
# 19 tests: normalization (UUIDs, ports, paths, versions), redaction,
# signature dedup, layered search, ranking, feedback, open-problem listing
```

---

## 📁 Project structure

```
fixdex/
├── README.md                ← this file
├── package.json             ← bin: fixdex-cli, fixdex-mcp, fixdex-ui
├── tsconfig.json            ← main (src → dist)
├── tsconfig.test.json       ← tests
├── .gitignore
├── .claude/settings.json    ← hooks + MCP registration
├── src/
│   ├── db.ts                ← SQLite wrapper (schema, search, dedupe, stats, activity)
│   ├── normalize.ts         ← signature normalization + secret redaction
│   ├── schema.ts            ← entries + FTS5 + trigram + activity + config tables
│   ├── mcp.ts               ← MCP stdio server (5 tools)
│   ├── ui.ts                ← static HTML API + dashboard server (port 4747)
│   ├── cli.ts               ← CLI: search | get | save | stats | open | prune | seed
│   └── seed.ts              ← 10 example entries
├── hooks/                   ← TypeScript → /fixdex/hook/*.js
│   ├── fixdex-startup.ts    ← SessionStart banner
│   ├── fixdex-post.ts       ← PostToolUse failure counting + open-entry reminder
│   ├── fixdex-pre.ts        ← UserPromptSubmit inject summary
│   └── fixdex-stop.ts       ← Stop nudge to save resolved fixes
├── skills/fixdex.md         ← skill text (search → save → feedback)
├── web/ui.html              ← dashboard (single-file, adhd-style palette)
└── tests/
    ├── normalize.test.ts    ← 12 tests
    └── db.test.ts           ← 7 tests
```

---

## 💡 How the hooks work

1. **SessionStart** → one-liner: `fixdex: active — N entries`
2. **PostToolUse(Bash)** → on non-zero exit, compute signature, increment session counter. **2nd occurrence** → if open entry exists, remind; else create open entry + reminder
3. **UserPromptSubmit** → if the prompt contains a known error signature whose status is `solved`, inject 1-line summary before Claude starts solving
4. **Stop** → if a session-open entry's error later succeeded → `fixdex: N open problem(s) may be resolved — run /fixdex-save`

All hooks read stdin JSON (from Claude Code's hook context), run their logic in <50ms, and **exit cleanly** whether the DB exists or not.

---

## 🔧 Configurable via env vars

| Var | Default | Meaning |
|-----|---------|---------|
| `FIXDEX_PORT` | `4747` | UI server port |
| `FIXDEX_PROJECT` | `$(basename)` | default project for saves |
| `FIXDEX_TOKEN_COST` | `150` | avg tokens saved per hit (for dashboard estimate) |

Set `token_cost` from the Settings panel to change the estimate on the fly.

---

## License

MIT — built for the Claude Code ecosystem.

---

### Follow

[![Instagram](https://img.shields.io/badge/Instagram-@shaheer0.0-black?logo=instagram)](https://www.instagram.com/shaheer0.0/)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FF8921?logo=buymeacoffee&logoColor=white)](https://buymeacoffee.com/shaheer0.0)
