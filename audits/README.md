# Audit reports

Output dir for codebase audits run by Gemini (or any other AI doing
high-recall consistency sweeps).

## Format

One file per audit topic. Filename is the topic slug with `.md`:

- `encounter-ctx.md` — every encounter's ctx helper usage vs what's
  exposed in `_ctxFactory`
- `dispose-guard.md` — every `geometry.dispose()` callsite vs the
  `sharedRigGeom` guard
- `apply-vs-base-stats.md` — artifact `apply()` mutations vs
  declared fields in `BASE_STATS()`
- etc.

## Structure

Each report should include:

1. **One-sentence summary** at the top.
2. **Findings grouped by severity** (`bug` / `inconsistency` /
   `cleanup`). Each finding gets:
   - File path + line number(s)
   - The problem in one line
   - Suggested fix in one line (if obvious; otherwise "needs
     discussion")
3. **What was checked but came back clean** — short list. Helps
   future audits know what's been looked at.

Keep findings actionable. "Function X is too long" is not a
finding; "function X has 4 unreachable branches at lines 100, 142,
178, 201" is.

## When to delete an audit

Once every finding in a report is fixed (or formally rejected), move
the file to `audits/done/` so the open dir stays the live queue.
Don't delete — they're useful for tracking what's been investigated.
