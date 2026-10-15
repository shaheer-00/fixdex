---
description: Dismiss a Fixdex notice or entry (down-ranks, never deletes)
argument-hint: [entry-id]
allowed-tools: Bash
---

Dismissing means: don't re-surface this match soon. Run `node "$CLAUDE_PLUGIN_ROOT/dist/cli.js" feedback $1 down` to down-rank the entry (safe — one downvote cannot trigger prune). If no id, acknowledge dismissal of the last shown notice only. This is the action behind the `dismiss` number in card footers ("0 dismiss" → type `/fixdex:dismiss` or `0`).
