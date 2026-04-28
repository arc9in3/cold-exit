# Migrating mission-control out of cold-exit

Mission Control was originally built inside `tools/mission-control/`
in the cold-exit repo for convenience. It's actually a project-
agnostic tool that should manage MULTIPLE projects, so we're moving
it to a peer location.

**Old:** `C:\work\Personal\tacticalrogue\tools\mission-control\`
**New:** `C:\work\mission-control\`

## What changes after the move

- mission-control gets its own git repo
- The active project (cold-exit) is referenced by absolute path via
  the `MC_PROJECT_ROOT` env var instead of relative-path traversal
- `audits/<slug>.md` reports still land at
  `C:\work\Personal\tacticalrogue\audits\` (in the cold-exit repo,
  next to the source) — that's what `MC_PROJECT_ROOT` controls
- Switching projects becomes: change `MC_PROJECT_ROOT` in `.env`,
  restart bot. Mission Control is the same; the codebase it works
  on changes.

## Steps the user runs

1. **Stop the bot** and any running dashboard.
   - In each PowerShell window running mission-control: Ctrl+C

2. **Move the directory.** In any PowerShell window:
   ```powershell
   Move-Item C:\work\Personal\tacticalrogue\tools\mission-control C:\work\mission-control
   ```

3. **Initialize the new repo.**
   ```powershell
   cd C:\work\mission-control
   git init
   git add .
   git commit -m "extract mission-control to its own repo"
   ```

4. **Verify .env still points at the right project.** Open
   `C:\work\mission-control\.env` and confirm:
   ```
   MC_PROJECT_ROOT=C:/work/Personal/tacticalrogue
   ```
   (forward slashes are fine on Windows in env vars)

5. **Restart the bot from the new location.**
   ```powershell
   cd C:\work\mission-control
   node src/bot.mjs
   ```
   (and `node dashboard/server.mjs` in another window if you want
   the dashboard up)

6. **Smoke test.** In Discord, fire a small audit:
   ```
   /audit slug:test-after-move prompt:"one paragraph what does src/scene.js do" files:src/scene.js
   ```
   Watch for the result to land at
   `C:\work\Personal\tacticalrogue\audits\test-after-move.md`.

## What we leave behind in cold-exit

After the move succeeds and you've verified the bot runs from the
new location, remove the old directory from the cold-exit repo:

```powershell
cd C:\work\Personal\tacticalrogue
git rm -r tools/mission-control
git commit -m "extracted mission-control to ../../mission-control"
```

`audits/` stays in the cold-exit repo — those reports belong to the
project, not to mission-control.

## node_modules + data

- `node_modules/` was already gitignored. Run `npm install` once at
  the new location.
- `data/mc.db` (the SQLite db with all task history) was gitignored
  so it just travels with the directory move. Your queue, ideas,
  and memory survive.
