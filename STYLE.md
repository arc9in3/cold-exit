# Cold Exit — UI Style Spec v0

This file is the single source of truth for menu / HUD aesthetics. Every
new UI surface and every facelift cites it. Violations are review
blockers.

This is **v0**. Edit freely — once you've redlined and we agree on v1,
the spec locks and surfaces conform.

---

## Tone

Cold Exit is **mid-budget extraction work in a near-future grim
contractor world**. The UI should feel like:

- A *case officer's terminal*, not a videogame menu
- Warm cream text on cold dark steel — the operator's notes pinned to
  a metal locker
- Confident gold/amber accents — used sparingly so they actually mean
  something
- Industrial, not military (no chevrons, no rank stripes, no flag
  iconography). Think "freelance contractor" not "soldier"
- A menu the player should be able to imagine *existing diegetically*
  — printed on a clipboard, taped to a wall, glowing on a CRT

**What it is NOT:**

- Sci-fi clean (Mass Effect, Destiny, Helldivers HUD): too polished,
  too futuristic
- High-fantasy ornate (Diablo, PoE): too decorated, wrong era
- Modern flat (Apex Legends menus): too sterile
- Generic dark UI (most indie roguelikes): no attitude

Closest reference points: Tarkov hideout interface, Hunt Showdown
bounty board, Death Stranding terminal screens, Zero Sievert pause
menus.

---

## Palette (locked)

```css
/* Backgrounds — cold, dark, slightly desaturated blue-black */
--bg-deep:        #0c0e14;   /* deepest panel, modal backdrop */
--bg-panel:       #131720;   /* primary panel surface */
--bg-panel-2:     #1a1d24;   /* nested panel / list row */
--bg-panel-hover: #1f2530;   /* row / button hover */

/* Borders — desaturated steel */
--border-soft:    #2a2f3a;   /* default panel border */
--border-mid:     #3a3f4a;   /* divider, focused border */
--border-warm:    #6f6754;   /* warm-tinted divider on important panels */

/* Text — warm cream parchment, four steps */
--text-strong:    #e8dfc8;   /* headlines, primary readable text */
--text-body:      #c9a87a;   /* body copy, labels */
--text-muted:     #9b8b6a;   /* secondary info, timestamps */
--text-faint:     #6f6754;   /* disabled, placeholder */

/* Accent — gold/amber for action, used sparingly */
--accent-gold:    #f2c060;   /* primary CTA, selected state */
--accent-amber:   #c98a3a;   /* secondary highlight */
--accent-warm:    #f2a040;   /* warning / costly action */

/* Status — for damage / status effects only, not chrome */
--ok:             #6abf78;   /* success, online, completed */
--info:           #5a8acf;   /* informational */
--warn:           #f2a040;   /* warning */
--bad:            #d24868;   /* error, danger, lost */
--rare:           #b870e0;   /* high rarity */
```

**Rule:** if a color you want isn't in this list, propose adding it
before using it. No one-off hex codes inline.

---

## Typography

**Primary font: `Inter` (already in repo via system fallback).** Switch
to a more atmospheric face later — `IBM Plex Mono` for terminal-feel
copy is the leading candidate. Headlines may eventually use a custom
display face (e.g. `Space Grotesk`, `JetBrains Mono`) — TBD.

```css
--font-body:      'Inter', system-ui, -apple-system, sans-serif;
--font-mono:      'IBM Plex Mono', 'Consolas', monospace;
--font-display:   'Inter', sans-serif;   /* same as body until display face lands */
```

### Scale (locked)

```
display     32px / 36px / weight 700 / tracking +0.02em / uppercase
title       22px / 28px / weight 700
heading     16px / 22px / weight 600
body        13px / 18px / weight 400
label       11px / 14px / weight 500 / tracking +0.06em / uppercase
micro       10px / 12px / weight 500 / tracking +0.08em / uppercase
```

**Rules:**
- Numbers (currency, stats, timers) use `--font-mono` — gives the
  contractor-spreadsheet feel and avoids width jitter
- All-caps is a *signal* — use it for labels, section titles, and
  status pills. Body copy is sentence case
- Default tracking is 0; only the cases above add tracking. Wider
  tracking = more "official document" feel; reserve for emphasis

---

## Surface system

Every panel obeys this hierarchy. Don't invent new tiers.

| Tier | bg | border | shadow | use |
|---|---|---|---|---|
| **Modal backdrop** | rgba(8, 10, 16, 0.78) blur(8px) | — | — | full-screen veil behind a panel |
| **Primary panel** | `--bg-panel` | 1px `--border-soft` | `0 12px 32px rgba(0,0,0,0.6)` | the main panel of a screen |
| **Section** | `--bg-panel-2` | 1px `--border-soft` | none | grouped content within a panel |
| **Row / item** | transparent → `--bg-panel-hover` on hover | top-only `1px --border-soft` | none | list rows |
| **Inline pill** | `--bg-panel-2` | 1px `--border-soft` | none | status / tag chip |

**Corner radius:** `2px` for cards/panels, `0` for rows, `999px` for
status pills only. **No `border-radius: 8px+` anywhere.** Soft corners
read as web-app, not contractor-terminal.

**Shadows:** modals get one. Inline panels do not. Buttons get none —
they signal interactivity through border + hover, not lift.

---

## Spacing & rhythm

```css
--sp-1: 4px;
--sp-2: 8px;
--sp-3: 12px;
--sp-4: 16px;
--sp-5: 24px;
--sp-6: 32px;
--sp-7: 48px;
```

**Default panel padding: `--sp-5` (24px).** Section gaps inside a panel:
`--sp-4`. Row internal padding: `--sp-3` vertical, `--sp-4` horizontal.

**Rule:** every gap, padding, and margin uses one of these tokens. No
inline `padding: 14px;` etc.

---

## Button language

Three tiers, no more:

```
primary    bg --accent-gold,  text --bg-deep,    border none
secondary  bg transparent,    text --text-strong, border 1px --border-mid
ghost      bg transparent,    text --text-body,   border none, underline on hover
```

**Hover:** primary brightens to `#ffd070`. Secondary fills to
`--bg-panel-hover`. Ghost reveals underline.

**Disabled:** opacity 0.4, no pointer events, no hover.

**Rule:** *one* primary button per screen. If two things look equally
important, one of them isn't.

---

## Icon / chrome rules

- **No drop shadows on text.** Ever. They flatten contrast and read
  cheap. Use weight + color, not shadow, for hierarchy.
- **No gradients on chrome.** Gradients on backgrounds are okay (subtle
  vertical fade, max 4% lightness delta). On buttons / borders / icons:
  flat only.
- **Borders are 1px.** Always 1px. Never 2px outline as a "highlight" —
  use color shift instead.
- **Glow effects** are reserved for *gameplay-meaningful* state
  (low-HP HUD, mythic-tier loot, active buff). Menus do not glow.
- **Stroke-only icons** at 16/20/24px, 1.5px stroke. No filled icons in
  menu chrome.

---

## Motion

Default transitions:
```css
transition: background-color 120ms ease-out,
            border-color 120ms ease-out,
            color 120ms ease-out,
            opacity 120ms ease-out;
```

**Don't animate:**
- Layout (width / height / padding) — causes paint storms and reads
  juddery
- Transforms on hover unless very subtle (≤ `translateY(-1px)`)

**Modal enter:** 160ms fade + 4px translateY. No bounce, no scale.

---

## Sound (anchor for later)

- Hover: brief soft click (~50ms, low-mid)
- Confirm: heavier mechanical *thunk* — locker latch energy
- Cancel / back: shorter hollow tap
- Tab switch: a paper-slide rustle

Currently no menu SFX in the build. Adding a minimal set is a separate
pass once the visual spec settles.

---

## Acceptance checklist for a new menu

Before declaring a menu surface "done," it must answer yes to:

- [ ] All colors come from the palette tokens above
- [ ] All spacing comes from the `--sp-*` scale
- [ ] Typography uses one of the six steps in the scale
- [ ] One primary CTA, no more
- [ ] Border-radius is 0, 2, or 999 — nothing else
- [ ] No drop shadows on text, no gradients on chrome
- [ ] Hover states defined for every interactive element
- [ ] Disabled states defined where applicable
- [ ] Reads cleanly at the in-game default zoom (1080p / 1440p tested)

---

## Open questions for v1

Things I want your call on before locking:

1. **Display font.** Stick with Inter, or invest in a custom face? My
   pick: keep Inter for now, revisit when we do the hideout vibe pass.
2. **Mono font.** IBM Plex Mono is my pick — free, atmospheric. Open
   to JetBrains Mono or Berkeley Mono if you have a preference.
3. **Accent color.** Current gold (`#f2c060`) leans warm. Should we
   pull it slightly more amber/orange to differentiate from the cream
   text? Or keep it where it is for the parchment feel?
4. **Border style.** Pure 1px solid only, or do we allow a 1px
   *dotted* / *dashed* variant for "in progress" or "expired" panels?
   I lean solid-only.
5. **Diegetic flourishes.** Do we want the occasional *worn-edge*
   asset (printed-paper texture on the contracts panel, taped corners
   on the stash, CRT scanlines on dialog windows)? Powerful when used
   sparingly, terrible if overused. Default: no, reserve for a later
   "vibe pass."
