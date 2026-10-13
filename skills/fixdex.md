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
