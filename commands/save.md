---
description: Save a fix to Fixdex — "problem -> solution" format
argument-hint: "<problem> -> <solution>"
allowed-tools: Bash
---

Run `node "$CLAUDE_PLUGIN_ROOT/dist/cli.js" save "<problem> -> <solution>"` with the user's arguments parsed as `<problem> -> <solution>`. Confirm the saved entry id. This is the action behind the `save` number in card footers — the card shows "1 save", the user types `/fixdex:save` or just `2` as the next message.
