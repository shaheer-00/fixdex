---
description: Preview every Fixdex notice kind at once
argument-hint: [width]
allowed-tools: Bash
---

Run `node "$CLAUDE_PLUGIN_ROOT/dist/cli.js" notices ${1:-80}` to render sample output for every notice kind (captured, match, saved, warning, error) in both color and NO_COLOR mode at the given width (80/120/160). Report which rendering mode is active and why.
