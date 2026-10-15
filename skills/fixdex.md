---
name: fixdex
description: Claude Code's local error/fix memory — search saves, record solutions
---

On any error or when stuck:

1. `fixdex_search` the error text first
2. If a known fix appears, apply it, then `fixdex_feedback(id, true)`
3. If no fix found, solve it, then `fixdex_save(title, symptoms, root_cause, solution, tags)`
4. After using an entry, `fixdex_feedback(id, helped)` so good fixes rank up

One-line rule: **search before you debug, save after you fix.**

## Notice system

Every Fixdex notice is rendered by one module (`src/hooks/renderer.ts`):

- **Cards** — framed boxes for important events (mistake captured, past
  solution found, solution saved, warning, error). Actions appear in the
  footer as `1 review · 2 save · 0 dismiss`.
- **Compact lines** — `✻ fixdex · …` one-liners for routine events.

Colors adapt: full ANSI 256 rendering when the terminal supports it, plain
framed text otherwise, layout identical in both. Width detects the terminal
(full / fit / number), wraps between 52 and 140 columns.

### Acting on a card footer

Hooks cannot read a keypress, so footer numbers map to slash commands:

- `1 review` → `/fixdex:review [id]`
- `2 save` → `/fixdex:save "<problem> -> <solution>"`
- `0 dismiss` → `/fixdex:dismiss [id]`

Typed digits as the next message (`1`, `2`, `0`) also work when Claude sees
the card in context — mention the entry id with the digit if several cards
are recent.

### Verbosity

`/fixdex:verbosity quiet|normal|verbose` — default `normal`:

- `quiet` — cards for captured / match / error only
- `normal` — cards + compact lines
- `verbose` — everything plus timing (e.g. "checked in 38ms")

### Preview all notices

`/fixdex:notices [width]` or `fixdex notices` — render every kind in both
color and plain mode at the chosen width (80/120/160).
