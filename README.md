# Fixdex — Local Error / Fix Memory for Claude Code

> **Fixdex** records every error you hit twice in SQLite. The next time a similar error appears, Fixdex **injects the saved fix before Claude starts re-debugging** — saving ~150k tokens per repeat incident. All data stays on your machine. No network, no telemetry, fully offline.
>
> It is a **Claude Code plugin** (MCP server + hooks + web dashboard) that ships with an inline skill for `/fixdex-search`, `/fixdex-save`, and `/fixdex-feedback`.

[![npm version](https://img.shields.io/npm/v/fixdex)](https://www.npmjs.com/package/fixdex)
[![M8ven Score](https://m8ven.ai/badge/mcp/shaheer-00-fixdex-qwdptn?v=213216cd3ff0e016b1010fcb638eae67)](https://m8ven.ai/mcp/shaheer-00-fixdex-qwdptn?s=readme)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-Plugin-000000?logo=claude)](https://docs.anthropic.com/en/docs/claude-code)
[![GitHub stars](https://img.shields.io/github/stars/shaheer-00/fixdex?style=social)](https://github.com/shaheer-00/fixdex)
[![Instagram](https://img.shields.io/badge/Instagram-@shaheer0.0-black?logo=instagram)](https://www.instagram.com/shaheer0.0/)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FF8921?logo=buymeacoffee&logoColor=white)](https://buymeacoffee.com/shaheer0.0)

---

## TL;DR

1. **`/plugin add fixdex`** — install from the Claude Code marketplace (or `npm i -g fixdex` for CLI-only use)
2. **Register the hooks + MCP server** — one-line install command (see below)
3. **Start coding.** On the 2nd occurrence of any error, Fixdex injects the prior fix automatically.

---

## Why Fixdex?

When you debug the same `EADDRINUSE: address already in use` or `Cannot find module 'lodash'` twice, **Claude Code wastes ~150k tokens re-deriving the fix it already found once**. Fixdex turns that into a **0-token lookup**: a 40-byte signature hash match, or a ranked FTS5 search returning the 1-line summary of the best fix.

### How it works

- **Hooks** (Claude Code `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `Stop`) call Fixdex after every tool run. On the 2nd failure with the same signature, a reminder surfaces. Before a prompt that repeats a known error, the saved fix is injected inline.
- **MCP server** exposes `fixdex_search`, `fixdex_get`, `fixdex_save`, `fixdex_feedback`, `fixdex_open` as native agent tools.
- **Skills** surface as `/fixdex-search`, `/fixdex-save`, `/fixdex-feedback` slash commands inside Claude Code.
- **Web UI** at `http://127.0.0.1:4747` — dashboard, charts, quick-save, export.

---

## ✨ Features

| ✅ | Feature |
|----|---------|
| **Signature deduplication** | Same error text (after normalizing paths, ports, UUIDs, line numbers, version numbers) → merged, never duplicated |
| **Layered search** | Exact sha1 signature → FTS5 BM25 → trigram fuzzy → scored re-rank |
| **Fix pre-injection** | On `UserPromptSubmit`, if the prompt matches a known error, the saved summary is injected before Claude debugs |
| **Failure counting** | The `PostToolUse` hook tracks repeated errors within a session; 2nd occurrence → reminder |
| **Secret redaction** | `sk-*`, `AKIA*`, GitHub/GitLab/Slack tokens, Bearer tokens, 32+ char opaque tokens, env-style passwords, emails, private keys — all redacted before storage |
| **Offline-first** | No telemetry, no external calls. SQLite DB lives at `~/.fixdex/fixdex.db` |
| **Web dashboard** | Entries, search, project/tag filters, inline-SVG charts, quick-save (`problem -> solution`), export JSON |
| **MCP server** | 5 native tools — search, get, save, feedback, list open problems |
| **Claude Code skill** | Inline slash-command guidance: search → apply → feedback |

---

## 🚀 Quick Start — Install as a Claude Code Plugin

### From the marketplace (recommended)

```
/plugin add fixdex
```

This auto-registers the MCP server, hooks, and skill. Restart your Claude Code session.

### Manual install (from source or npm)

```bash
# 1. Install (or clone + build from source)
npm i -g fixdex

# 2. Register the MCP server
claude config mcp add fixdex -- cmd=fixdex-mcp

# 3. Install hooks — paste into ~/.claude/settings.json:
```

```json
{
  "mcpServers": {
    "fixdex": { "command": "node", "args": ["fixdex/dist/mcp.js"] }
  },
  "hooks": {
    "SessionStart": [{ "type": "command", "command": "node fixdex/dist/hooks/fixdex-startup.js" }],
    "PostToolUse":  [{ "type": "command", "command": "node fixdex/dist/hooks/fixdex-post.js", "matcher": "Bash" }],
    "UserPromptSubmit": [{ "type": "command", "command": "node fixdex/dist/hooks/fixdex-pre.js" }],
    "Stop":          [{ "type": "command", "command": "node fixdex/dist/hooks/fixdex-stop.js" }]
  }
}
```

> Hooks live in `fixdex/dist/hooks/` after `npm run build`. They exit 0 and emit nothing unless there's a fix to inject, so a missing or locked DB never blocks your session.

### Start the dashboard

```bash
fixdex-ui            # → http://127.0.0.1:4747
# or from source:
npm run ui
```

---

## 🔧 MCP Tools

All available once the `fixdex` MCP server is registered:

| Tool | Args | Returns |
|------|------|---------|
| `fixdex_search` | `query`, `project?`, `tags?` | top 3 `{id, summary, confidence}` |
| `fixdex_get` | `id` | full entry |
| `fixdex_save` | `problem_title, symptoms, root_cause, solution, summary, tags, project, status?` | entry id (**deduped**) |
| `fixdex_feedback` | `id, helped: bool` | updates stats (good fixes rank up) |
| `fixdex_open` | — | unresolved repeated problems |

### Using from Claude Code

```
/fixdex-search EADDRINUSE port 3000
→ #2  Kill process on port 3000.  conf 0.92

/fixdex-save "EADDRINUSE port 3000" "Error: listen EADDRINUSE..." "Previous dev server holds port." "lsof -i :3000 && kill -9 <PID>" "Kill process on port 3000." "nodejs,linux"
→ Saved #3 (sig=4a1f2c…)
```

---

## 📊 Web Dashboard

Start with `fixdex-ui` (or `node dist/ui.js`). Serves from `http://127.0.0.1:4747` (localhost only by default — set `FIXDEX_HOST` to bind elsewhere).

- **Dashboard** — total / solved / open entries, 7-day searches vs hits (inline SVG charts), estimated tokens saved
- **Entries** — live search, filter by project / tag / status, sorted by last used
- **Open problems** — repeated errors still without a fix
- **Quick save** — paste `problem -> solution` to add a solved entry in one step
- **Settings** — token-cost estimate, prune stale entries, export JSON

All charts use inline SVG — no CDN, no network.

---

## 🤖 How the Hooks Work

| Hook | Fires When | What It Does |
|------|------------|--------------|
| `SessionStart` | new session | Emits `fixdex: N known fixes (S solved, O open). Search before debugging, save after fixing.` |
| `UserPromptSubmit` | before each prompt | If the prompt contains a known solved error signature, injects `fixdex #N: <summary>` so Claude sees the fix first |
| `PostToolUse` (Bash) | after a failed command | On the 2nd occurrence of the same error signature, reminds you a fix exists — **without** downvoting it |
| `Stop` | session end | If an open entry's title appeared in the transcript, nudges to save the fix; then clears the in-session counter file |

---

## 🔒 Safety

| ✅ | Guarantee |
|---|-----------|
| **Secrets redacted** | `sk-*`, `AKIA*`, `ghp_`, `gho_`, `ghs_`, `glpat-*`, `xox[bpoa]-*`, Bearer tokens, 32+ char opaque tokens, password/pass/secret/token/env-style keys, emails, AWS secret keys, private keys → all replaced with `[TOKEN]` / `[SECRET]` / `[PRIVATE-KEY]` before storage |
| **Signature dedup** | Same error text (after normalization) → merged, never duplicated |
| **Size caps** | Symptoms ≤ 500 chars, solution ≤ 800 chars, title ≤ 120 chars |
| **Offline only** | No telemetry, no external calls. DB lives at `~/.fixdex/fixdex.db` |
| **Safe prune** | A single downvote does not delete an entry — prune requires `status='solved'` and `times_failed > times_helped + 1` (≥2 net failures), or 90 days of no use |
| **Safe hooks** | If the DB is missing or locked, hooks skip silently (never block Claude Code). All hooks wrap their body in a no-throw `safeHook()`. |

---

## ⚙️ Configurable via Env Vars

| Var | Default | Meaning |
|-----|---------|---------|
| `FIXDEX_PORT` | `4747` | UI server port |
| `FIXDEX_HOST` | `127.0.0.1` | UI bind host (localhost only by default) |
| `FIXDEX_ALLOWED_ORIGINS` | `http://localhost:4747,http://127.0.0.1:4747` | Allowed origins for mutating POST requests |
| `FIXDEX_PROJECT` | `$(basename)` | default project for saves |
| `FIXDEX_TOKEN_COST` | `150` | avg tokens saved per hit (for dashboard estimate) |

---

## 🧪 Tests

```bash
npm install
npm run build
npm test
# 36 tests: normalization, redaction, signature dedup, layered search,
# ranking, feedback, open-problem listing, hook exit codes, JSON output,
# update-signature recompute, save-status persistence, prune safety
```

---

## 📁 Project Structure

```
fixdex/
├── README.md
├── LICENSE
├── plugin.json              ← Claude Code plugin manifest (auto-install)
├── marketplace.json         ← /plugin marketplace listing
├── package.json
├── tsconfig.json
├── tsconfig.test.json
├── .gitignore
├── .claude/settings.json    ← hooks + MCP registration
├── scripts/check-version.cjs ← build-time version consistency gate
├── src/
│   ├── index.ts             ← public API entry (main target)
│   ├── version.ts           ← single source of truth for package version
│   ├── cli.ts               ← CLI: search | get | save | stats | open | prune | seed
│   ├── db.ts                ← SQLite wrapper (schema, search, dedupe, stats)
│   ├── normalize.ts         ← signature normalization + secret redaction
│   ├── schema.ts            ← entries + FTS5 + trigram + activity + config
│   ├── mcp.ts               ← MCP stdio server (5 tools)
│   ├── ui.ts                ← HTTP API + dashboard server (127.0.0.1:4747)
│   ├── seed.ts              ← 10 example entries
│   └── hooks/
│       ├── io.ts            ← sync stdin, safeHook, emitContext
│       ├── fixdex-startup.ts
│       ├── fixdex-pre.ts
│       ├── fixdex-post.ts
│       └── fixdex-stop.ts
├── skills/fixdex.md         ← skill text (search → save → feedback)
├── web/ui.html              ← dashboard (single-file, adhd-style palette)
└── tests/
    ├── normalize.test.ts    ← redaction + signature tests
    ├── db.test.ts           ← dedupe, search, ranking, feedback, update, prune
    └── hooks.test.ts        ← hook exit codes, JSON output, counter cleanup
```

---

## 📦 Development

```bash
npm install
npm run build        # tsc && tests && version-check
npm test
npm run ui           # dashboard → http://127.0.0.1:4747
```

---

## License

MIT — built for the Claude Code ecosystem.

---

### Follow

[![Instagram](https://img.shields.io/badge/Instagram-@shaheer0.0-black?logo=instagram)](https://www.instagram.com/shaheer0.0/)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FF8921?logo=buymeacoffee&logoColor=white)](https://buymeacoffee.com/shaheer0.0)
