# File-area locks

Crude coordination so two AIs don't trample each other's edits to a
hot file.

## How

Before a long-running edit (more than a minute) to a hot area,
`touch` a lock file named after the area:

```
encounters.lock        # any work in src/encounters.js
combat.lock            # combat.js, projectiles.js
main.lock              # src/main.js
level.lock             # level.js, level generation
inventory.lock         # inventory.js, attachments.js, gear / loot
rig.lock               # actor_rig.js, rig_instancer.js, gunman.js, melee_enemy.js
ui.lock                # ui_*.js
```

Lock content is plain text — one line:

```
<branch-name>:<one-line description of the work>
```

Example:

```
$ echo "codex/spatial-hash:adding gunman proximity grid" > .locks/main.lock
```

Release by deleting the file once you commit:

```
$ rm .locks/main.lock
```

## When to skip

- Single-file fixes that take less than a minute — just go.
- Pure-read audits (Gemini sweeps) — locks are for writers.
- The active interactive session driving from the user — assume the
  user knows what they're touching and won't conflict with itself.

## Stale locks

If a lock is older than 24h, it's stale. Assume the previous agent
crashed mid-task. Reclaim it by overwriting with your own
`<branch>:<task>` line. Mention in your first commit on the new
branch that you took over a stale lock so the original agent's user
can find the work later if needed.

## Why locks per-area instead of per-file

Most "stepping on each other" cases happen because two agents both
touch related files in the same edit (e.g. a refactor that hits both
gunman.js and rig_instancer.js). Per-area locks catch those without
needing a graph of which files touch which.

If two areas need to change together (a relic that needs both
artifacts.js and main.js + recomputeStats), claim BOTH locks before
starting:

```
$ echo "claude/new-relic-x:Bloody Mag" > .locks/main.lock
$ echo "claude/new-relic-x:Bloody Mag" > .locks/inventory.lock
```
