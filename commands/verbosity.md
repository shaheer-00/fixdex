---
description: Change Fixdex notice verbosity — quiet | normal | verbose
argument-hint: quiet|normal|verbose
allowed-tools: Bash
---

Run `node "$CLAUDE_PLUGIN_ROOT/dist/cli.js" verbosity $1` to persist the setting to `~/.fixdex/.config.json`. Valid values: `quiet` (cards for captured/match/error only), `normal` (cards + compact lines), `verbose` (everything + timing). Confirm which mode is now active.
