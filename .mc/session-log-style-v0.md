**Commit:** 5775f7a — `hideout: STYLE.md v0 + contractor-screen conformance pass`

**What landed**
- New `STYLE.md` v0 at repo root — palette tokens, type scale, surface tiers, button language, motion, acceptance checklist.
- Contractor screen in `src/ui_hideout.js` (~lines 3456–3650) brought into conformance:
  - Border colors: `rgba(90,138,207,*)` (saturated info-blue) → `rgba(42,47,58,0.9)` (`--border-soft` desaturated steel) on topbar / tabs / panel / feed / board.
  - Border-radius normalized to `2px` everywhere (spec allows only 0 / 2 / 999).
  - Borders dropped to 1px on host-portrait + CTA.
  - Lift drop-shadows removed from topbar / tabs / CTA.
  - Text-shadow removed from `.host-glyph` (panel rarity glow retained).
  - CTA hover `scale(1.04)` → flat brighten on `--accent-gold`; gradient flattened; mono font swapped to Inter; weight 900 → 700.

**User calls confirmed**
- Glow as a *rarity signal* is allowed (kept inset purple glow on contract preview).
- Glow as a *call-to-action* is allowed (kept gold halo on START NEW RUN).

**Followups queued**
- Sage #2033 — `audit-style-sweep-hideout`: per-surface checklist of remaining violations (stash, garage, armory, black market, trader, rooms, boards, modals, wanted-cards, mission-prep + index.html). Output → `audits/audit-style-sweep-hideout.md`.
- Wrenchy #2035 — `refactor-style-sweep-hideout`: mechanical sweep draft for the same surfaces. Output → `audits/refactor-style-sweep-hideout.md` for review.
