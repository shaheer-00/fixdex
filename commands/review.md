---
description: Review a Fixdex entry — full details, symptoms, root cause, solution
argument-hint: [entry-id]
allowed-tools: Read, Bash
---

Run `node "$CLAUDE_PLUGIN_ROOT/dist/cli.js" get $1` and display the full entry: problem title, symptoms, root cause, solution, times seen/used, project, tags, and status. If no id given, run `... cli.js recent --limit 5` and list recent entries for the user to pick from.
