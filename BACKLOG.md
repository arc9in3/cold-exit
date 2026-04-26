# Cold Exit — backlog

A snapshot of known gaps, deferred work, and candidate next steps. Not
exhaustive; living document.

Last updated: 2026-04-26 (afternoon session: weapon visual identity
overhaul, attachment system rework, equipment thumbnail rewrite).

## Most-recent shipped (this batch)

- [x] **Weapon visual identity pass** — every in-game weapon (53 total)
      now has a side-view PNG render in `Assets/UI/weapon_renders/`
      driving both the inventory icon AND the attachment-screen art.
      `iconForItem` resolves `WEAPON_RENDER_BY_NAME[name]` first, then
      falls back to `WEAPON_ICON_BY_NAME` (curated stock icons), then
      to class default. `layoutForWeapon` embeds the same render PNG
      as an `<image>` in the customize-modal SVG — same silhouette in
      both places. New tool `tools/weapon_assigner.html` (drag-tag
      FBXes, click models for a fullscreen pose modal, bulk-export
      side-view PNGs) was authored in this session.
- [x] **Weapon roster restructure** — applied the user's
      `weapon_assignments.json` export. 19 generic / mythic duplicates
      deleted; 13 weapons renamed to real-world identities (Glock →
      Glock 17, AKS-74U → UMP45, Snub Revolver → Colt Anaconda .44,
      SVD → SVD Dragunov, Tavor → AUG A3-CQC, PKM → Type 80 LMG, etc.);
      19 new weapons added from the lowpolyguns pack (CAR-15, AKS-74,
      AK104, JARD J67, Spectre / Spectre CQB / SPC9, Mossberg 500,
      Remington 870, Sawed-Off, KSG-12, AWP, .338 Lapua, Hunting Rifle,
      4 Colt revolvers, Scimitar). All restatted from real-world specs
      (caliber → damage, cyclic RPM → fireRate, barrel length →
      range/spread, factory mag/reload). CQB/CQC variants follow a
      bumped-RoF / wider-spread / shorter-range rule.
- [x] **Attachment system overhaul** — 50 attachments across 8 slots,
      type-rooted by category. Suppressors (7 variants) carry a new
      `noiseRangeMult` modifier wired into `alertEnemiesFromShot` so
      legendary Osprey drops noise to ~20% of baseline. Lights gained
      `blindSpreadMul` / `dazzleSpreadMul` fields — rarity now scales
      BOTH duration AND magnitude (a legendary tac light blinds longer
      AND wrecks enemy aim harder). `_scaleModifierByRarity` rewritten
      with per-field `GOOD_WHEN` direction so legendary tradeoffs
      soften toward 1.0 (less penalty) instead of amplifying. Every
      attachment has flavor-rich descriptions explaining the trade.
- [x] **Equipment thumbnail rewrite** — pants, chest rigs, gloves,
      boots, backpack, and junk all rebuilt with capsules + tapered
      cylinders + spheres + tori instead of stacked boxes. Pants now
      taper hip-to-ankle with cargo pockets and seat wedge; chest
      rigs show MOLLE pouches + shoulder straps + cummerbund + plate
      (or layered cloak strips for ghillie); gloves have rounded
      palms + 4 finger capsules + thumb + cuff + knuckle plate.
- [x] **Junk overhaul** — generic junk (silver coin, dog tags, copper,
      lighter, watch, drive, monocle, cig case, doc) shares a single
      tinted canvas pouch silhouette; distinctive items get per-id
      custom builders (ring-with-gem, skull, vase, walkie-talkie,
      field radio, car battery, scrap pile, bag of peas, rocket
      ticket, fancy-alcohol bottle, biscuit stack).
- [x] **Pose-tuning modal** — `tools/weapon_assigner.html` opens a
      fullscreen modal on tile click. Three drag markers (red M = main
      hand / trigger, blue S = support hand / foregrip, yellow B =
      shoulder mount / buttstock) gated by weapon class — pistols get
      M+S only, knives get M only, rifles/SMGs/shotguns/snipers/lmgs
      get all three. Attachment-slot squares overlay for in-game
      weapons. Green outline shows the manifest grip-offset. Right-
      click resets, escape closes, export dumps pose JSON for any
      weapon.

## Performance traces processed

- [x] **Trace 1 (88MB)** — fixes shipped: static-obstacle
      `matrixAutoUpdate=false`; `renderer.debug.checkShaderErrors=false`
      after warmup (kills the synchronous `getProgramInfoLog` GPU
      stall); LOS raycast throttled to 20Hz per enemy with
      `_losT`/`_losCached`; per-frame `allHittables()` cache.
- [x] **Trace 2 (5MB)** — fixes shipped: `gunman.hittables()` was
      rebuilding two `Set` objects per gunman per frame to filter the
      right-arm chain on disarmed enemies (~777ms self-time / 7.1% of
      total). Now caches `g._hitMeshes` (full body) on first call and
      lazily builds `g._hitMeshesDisarmed` on disarm transition.
- [x] **`.gitignore` tightened** — `profiling/*.json` and
      `profiling/*.json.gz` excluded so traces don't bloat the repo.

## Web deploy shipping notes

- **Live URL:** `cold-exit.pages.dev` (Cloudflare Pages, git-connected
  to `github.com/arc9in3/cold-exit` — push to `main` auto-deploys.
  `npx wrangler pages deploy . --project-name=cold-exit
  --commit-dirty=true` still works as a manual override).
- **Latest preview:** `28609ed0.cold-exit.pages.dev` (equipment +
  junk thumbnails pass).
- **Assets ignored from deploy:** source-archive `.zip`s in `Assets/`
  (`poly_*`, `style_*`, `lowpolyguns.zip`) — listed in
  `.assetsignore`. Extracted runtime FBX + textures + UI PNGs ship.
- **Git repo:** `github.com/arc9in3/cold-exit` — public, public Pages
  project. Leaderboard Worker is scaffolded in `worker/` but not yet
  deployed; the game's local-first leaderboard works standalone until
  the Worker's URL is pasted into `src/api_config.js:COMPILED_API_BASE`.

## Style / art pass (in-flight)

- [x] Main menu restyled to the `Assets/coldexitmain.png` splash art
      (tech-mono tokens, ice-blue rail divider). Menu rail moved to
      bottom of screen, sitting above the prototype-build status line.
- [x] CSS design tokens (`--ce-*` palette + fonts + `.ce-panel`
      corner-bracket helper) rolled into Esc menu, main menu, settings
      form rows, leaderboard cards, modal bases.
- [x] **Weapon icons + attachment screen** — both now driven by
      side-view PNG renders so the same silhouette reads everywhere.
- [x] **Equipment thumbnails** — pants/chest/gloves/boots/backpack +
      junk overhaul with capsules + spheres + tori instead of boxes.
- [ ] Per-screen rollout remaining: shop grid cells, customize body,
      inventory cells, details panel, HUD bars, damage numbers,
      crosshair.
- [ ] Custom domain — register via Cloudflare Registrar once decided
      on a name variant.

## Recent perf + gameplay fixes

- [x] **Bullet / flash pool** (`src/combat.js`) — pre-allocated
      tracers, flash spheres, and PointLights. Zero per-spawn alloc,
      no shader recompile spikes on shotgun volleys.
- [x] **Loot pool** (`src/loot.js`) — 24 pre-allocated cube slots
      sharing one BoxGeometry. Spawn tints the emissive + redraws a
      pre-allocated nametag canvas. FBX load path removed for common
      drops; ducks/bears keep hand-built primitives. Killed the
      disarm hitch.
- [x] **Particle pool + explosion light pool** — last batch of pool
      work; per-shot allocations now zero across all combat surfaces.
- [x] **LoS mask cost cut** + worker leaderboard live (recent commits).
- [x] **Kawase bloom + shadow-map drop + wall shadows off + tighter
      sense range** — explicit perf-vs-quality dial on the postFX side.
- [x] **Corpse LOD + drop shadow casting on settled bodies**.
- [x] **AI LOD scheduler for late-game perf**.
- [x] **Wall occlusion hardening** (`src/main.js:updateWallOcclusion`)
      — 7-ray fan for player silhouette, 4-ray fan per enemy. Active
      enemies (any non-idle state) have NO range cap for wall fades;
      idle enemies keep the 24m limit to stay cheap.
- [x] **Cursor-to-wall ray** — aim-point is added to the occlusion
      set so "peek around the corner" reveals the obstacle.
- [x] **Crouched gun parallel-to-ground** — zeroed `crouchBias` and
      `tuckBias` on the upper-arm pose so SMGs/rifles stay level in
      crouch instead of tipping muzzle-up.
- [x] **SMG grip offsets** — negative-Z magnitudes (−0.28 to −0.38)
      seat the pistol grip in the hand instead of the buttstock.
- [x] **Ground loot = colored glowing boxes** with proximity-gated
      nametag sprites. Ducks / bears retain custom silhouettes.
- [x] **Per-weapon class range buckets** — shotgun ½ room, smg 0.85
      rooms, rifle 1.5 rooms, lmg 1.2 rooms, pistol/sniper 100m.
      Damage falloff curves: steady (pistol/smg/rifle/lmg), steep
      quadratic (shotgun), none (sniper). Per-pellet ±25% range jitter.
- [x] **ADS rework** — sight-driven push-in factor (iron 1.05× → long
      scope 1.30×), drag distance decoupled and bumped by
      `adsPeekBonus`, edge-pan with 65% inner deadzone, frustum shrinks
      to `1/sightZoom`. Press-time cursor distance capped by class
      budget (sniper 35m / 2.5 rooms, rifle 21m, etc.).

## Live lighting tuning

- [x] `tunables.lighting` block + lil-gui folder (open by default).
- [x] F3 → console dump of current lighting values as a copy-paste
      block. Supports color pickers for every hex field.
- [ ] Same treatment for post-FX (bloom threshold, vignette strength,
      chromatic).

---

## Recently landed (prototype-ship push)

### Shell / meta
- [x] **Main menu on boot** — `ui_main_menu.js`. Four buttons: Play,
      Starting Store, Leaderboard, Settings. Replaces the raw class-
      picker as the first-screen UX. Quit-to-title returns here.
- [x] **Settings UI** — master volume, mute, quality (high/low), player
      name (for leaderboard attribution), dev-tools toggle (shows/hides
      the lil-gui tunables panel). Settings appear in both the main menu
      and the in-run Esc menu.
- [x] **Starting store** — meta-progression screen funded by contract
      chips. Two axes: slots (3 → 9) and rarity tier (0 → 4). Play
      rolls `slots` weapon offers at the current tier; picking one seeds
      the run. State persists in localStorage.
- [x] **Leaderboard** — `src/leaderboard.js`. Per-run stats (credits,
      kills, damage, levels) auto-submitted on death. Runs are
      disqualified if `save`, `load`, or death-restart was used during
      them. Top-10 per category kept in localStorage; backend Worker
      scaffolded in `worker/`.
- [x] **Death flow rewrite** — two-button death screen: Restart Level
      (bumps `restartCount`, taints run, scales chip earnings down by
      up to 67%) or Back to Main Menu (resets meta, returns to menu).

### Rendering / art
- [x] **Procedural primitive rig** (`src/actor_rig.js`) — cylinders +
      joint spheres + sectional gear colouring. Shared by player and
      enemies (no skinned-FBX path live; flagged dormant behind
      `window.__skinnedRig`).
- [x] **Post-FX pipeline** (`src/postfx.js`) — EffectComposer stack with
      Kawase bloom (replacing UnrealBloomPass) + custom finisher
      (vignette + chromatic aberration). Gated on `qualityFlags.postFx`.
- [x] **Bloom-safe art pass** — Great Bear fur cooled off pure white;
      ceiling fixtures removed; spotlight ceiling lamps instead of
      point lights.
- [x] **Darker scene base** — hemisphere 0.06, key light 0.70, fill/rim
      proportionally trimmed. Unlit corners read as proper shadow.
- [x] **Rotation order fix** — hips + chest + stomach use `YXZ` so
      forward-lean pitch stays in the character's local frame
      regardless of aim yaw.
- [x] **Rifle-hold shoulder compensation** — `rightShoulderAnchor` /
      `leftShoulderAnchor` counter-rotate by `-armLeanComp` during the
      rifle pose.

### Audio
- [x] **Ambient bed** — `sfx.ambientStart/Stop`. Low-passed noise HVAC
      hum + two detuned sub drones with slow LFO swell.
- [x] **Footsteps** — distance-accumulator `tickFootsteps` in `main.js`
      picks per-step cadence from horizontal speed.
- [x] **Reverb bus** — synthetic IR ConvolverNode, short-room tail,
      routed as a send from every SFX via `connectToWet`.
- [x] **Per-class firing samples, death, reload, pickup, UI, explode,
      impact** — all WebAudio-synth.

### Combat / AI
- [x] **Boss seal v2** — entry seal restored but gated on the boss
      being physically inside the room. Auto-releases the moment the
      boss leaves the bounds. Hidden ambush rooms (~35%) keep boss +
      minions invisible/deaf until the player crosses the threshold.
- [x] **AI pathing** — `level.steerAround` whisker raycast (probes
      ahead, deflects to closest open whisker at ±30/±60/±90°).
      `level.findCoverNear` returns the safe-side spot behind a prop.
- [x] **Whisper dart deep sleep** — on hit: wipe suspicion, disable
      alert/propagate paths, randomise sleep timer 10s..5min. Tier
      proc: normal 100%, sub-boss 12%, boss 4%.
- [x] **Necromant adds** — flagged `noDrops + noXp`; corpses fade
      after death. Spawn check requires a clear walkable segment.
- [x] **Doorway-choke awareness** — smart variants (dasher / runner /
      coverSeeker / sniper) retreat to the far corner when player
      camps a doorway. 50 wait-out-the-player bark lines. Side-of-door
      suppression hold for camping detection.
- [x] **Shield-bearer melee enemy** — chassis 50hp, slow movement
      (×0.25), slow turning, shield absorbs ranged + breaks on melee.
      Hide-behind-shield + flank-out at close range.
- [x] **Gunman smooth turning + curved shield mesh**.
- [x] **Necromant spawner minion count restored** (4-6 from 2-3).
- [x] **Burn DoT stacks** — `e.burnStacks` × `tunables.burn.dps` × dt.
- [x] **Enemy flash/stun mitigation** — AOE shrunk + falloff; player-
      side duration falls off with distance and (for flash) facing.
- [x] **Gas grenade throwable** — green poison cloud, 5%/s player HP,
      10%/s stamina, 5%/s enemy HP. Player + AI throw.

### Movement / feel
- [x] **Roll disabled** — `startRoll` short-circuits to a no-op.
- [x] **Crouch-sprint pose fix** — `runLean` scaled by `(1 - crouch *
      0.85)`.
- [x] **Melee block pose** — both arms raise the weapon across the
      chest with elbows tight.
- [x] **Ragdoll-lite death bodies** — brief hit-direction drift +
      gravity + ground friction + collision against walls on death.

### Doors / geometry
- [x] **Proper prop collision** — `solidObstacles()` filters out
      nulled / invisible obstacles.
- [x] **Boss-room door-trap fix** — if the player is inside a door
      when it re-solidifies on seal, the seal flow pushes them clear.
- [x] **Fence-pattern fix** — `_sealRoomPerimeters` `checkRadius`
      tightened so adjacent perimeter plugs don't mutually skip.
- [x] **Door overlap repair** — `_repairDoorOverlaps` nulls collision
      on any obstacle whose AABB strictly intersects a door's gap span.
- [x] **Graph connectivity check** — `validateConnectivity` runs at
      level-gen end and warns on any unreachable rooms.

### Input / UI
- [x] **Global context-menu + mouseup capture** — moved to `window`.
- [x] **`input.clearMouseState()`** — called around skill-draft /
      extract / mastery-offer modals.

### Debug surface
- [x] **`__debug.tuneWeapon / inspectWeapon`** — live-tuning for the
      active weapon clone's position + rotation.
- [x] **`__debug.traceShots`** — toggles per-hit logging.
- [x] **`__debug.findBlockedDoors()`** — returns every door whose
      approach strip contains a non-door / non-elevator obstacle.

---

## M1 / M2 foundation — assumed done (verify in playtest)

- [x] Player movement + isometric camera
- [x] Ranged combat with hip/ADS spread, tracers, pellets
- [x] Melee combat with combo chains + close/far variants
- [x] Enemy AI (ranged + dedicated melee) + variants (dasher, runner,
      cover-seeker, tank, shielded pistol, shield-bearer)
- [x] Slot-based anatomical inventory (1×1 cells, drag/drop)
- [x] Loot pickup + backpack + workspace staging
- [x] Shop / merchant with price scaling
- [x] Artifacts (run-long permanent buffs)
- [x] Per-class mastery (5 tiers × 7 classes)
- [x] Gear affix roller + set bonuses
- [x] Skill tree (meta-progression) with required prerequisites
- [x] Extraction → level regen; endless (no final extraction)
- [x] Persistent contract chips
- [x] **53-weapon roster with real-world identities + side-view
      renders + class-tuned stats**
- [x] **50-attachment system with type-rooted bonuses + rarity
      magnitude scaling**

---

## Near-term polish

### Throwables
- [x] Frag, flashbang, stun, gas, smoke, decoy, claymore, elven
      knife, the-gift — all wired.
- [x] **Throwable model overrides** — frag/flash/stun/molotov/
      claymore/elven-knife mapped to user-tagged FBXes.
- [ ] **Molotov landing fire-zone** — DoT source in `combat.js` that
      burns enemies for `fireDuration` seconds after impact.
- [ ] **Loot roll tuning** — make sure throwables surface in
      `buildBodyLoot` at sane rates.

### Leaderboard online sync
- [ ] **Backend endpoint** — `Leaderboard.submitRun` currently only
      writes localStorage. Worker is scaffolded in `worker/`; needs
      its URL pasted into `src/api_config.js:COMPILED_API_BASE` and
      anti-cheat clamps before persisting.
- [ ] **Display toggle** — local vs global top-10 in the menu.

### 3D rendering / models
- [ ] **Per-item ground-loot rotation offsets** — `modelRotation` is
      supported in tunable item defs for in-hand; add the same for
      ground loot in `loot.js`. Some FBX meshes still ship facing the
      wrong way as drops.
- [ ] **Cursor-locked ADS zoom** — current zoom still shifts off-
      center targets slightly because the orthographic scale pivots on
      `lookAt`. Compensate by translating the camera so the world
      point under the cursor stays fixed through the zoom.
- [ ] **Per-weapon attachment slot positions** — class defaults are
      in `weapon_layouts.js`; pose modal exports per-weapon slot
      overrides. Wire `WEAPON_SLOT_OVERRIDES_BY_NAME` consumer in
      `layoutForWeapon`.
- [ ] **Per-weapon hand-pose data** — same exporter dumps
      `WEAPON_POSE_BY_NAME`. Currently empty (class defaults via
      `POSE_BY_CLASS` only).

### Item variety
- [ ] **Bipod crouch-only effect** — currently flat `adsSpreadMult`;
      want `crouchSpreadMult` for "braced" feel.
- [ ] **Save migration for attachment instances** — already-stamped
      attachments in saves keep their pre-rewrite numbers. Want a
      schema-version bump that re-rolls modifiers from the new
      ATTACHMENT_DEFS on load (or leaves them; design call needed).

### Balance
- [ ] Numbers are still first-pass across the new 53-weapon roster.
      Real-world stats are in but feel-tuning needed (real-world
      .50 BMG → 200 damage might overflow; .338 vs .408 spread might
      be too similar).
- [ ] Class mastery XP thresholds untouched since before the weapon
      expansion. Some now have only 2-3 weapons in their class
      (shotguns, exotic).

---

## Larger deferred work

### Melee
- [ ] Wire the rest of the 57-model melee pack — only Combat Knife,
      Hammer, Baseball Bat, Katana, Brass Knuckles, Crowbar, Kukri,
      Tomahawk, Fire Axe, Sledgehammer, Chainsaw, Scimitar mapped (12
      of 57). Bayonet / pocket knife / throwing knife tagged but not
      yet melee-class items.
- [ ] Heavy-weight melee animations (hammer, cleaver, sword variants).

### Enemies
- [ ] More archetypes: big shield ranged, grenade thrower, dedicated
      sniper, dog-like fast melee, armoured tank.
- [ ] Per-map scripted boss — "contract target" framing.

### Levels
- [ ] Multiple biomes / maps. Current proc-gen is single-biome.
- [ ] Interactive elements (destructible cover, traps, climbables).
- [ ] Extraction point variety (timed helipad, chase escape).

### Meta / progression
- [ ] Stash UI for extracted loot (separate from inventory).
- [ ] Contract board — pick your next run with varying risk/reward.
- [ ] Hideout NPCs (quartermaster, doctor, contractor).

### Character & art
- [ ] Skinned character FBX replacing the primitive rig. Gated behind
      `window.__skinnedRig`; blocked on a real retargeter for the
      bone local-axis mismatch. **Profile evidence (this session)
      argues the primitive rig wins on perf for swarm AI counts; reserve
      skinned for cinematic / single-actor moments.**
- [ ] Character customisation kit integration
      (`style_charactercustomizationkit_V2.zip`).

---

## Engineering / infrastructure

- [ ] **Production bundle script** — scan `inventory.js` +
      `model_manifest.js` for referenced PNG/FBX paths, copy only
      those into `dist/`, output an itch.io-ready zip. Currently
      ships the entire `Assets/models/` and `Assets/UI/` trees.
- [ ] **Save schema versioning** — `schemaVersion` field + migration
      table so future changes don't brick old saves. Especially
      relevant after the weapon rename pass — saved Glock items
      should map to Glock 17.
- [ ] **Tests** — fast-follow: pure-function tests for `rollAffixes`,
      `wrapWeapon`, `effectiveWeapon`, `inferRarity`; snapshot tests
      for `iconForItem` / `modelForItem`.

---

## Tooling

### tools/weapon_assigner.html (NEW this session)
- Top panel: every in-game weapon with UI icon + class/rarity/dmg/
  rate/mag, currently-assigned model preview as a side-view orthographic
  render (16:9, no spin), tag input ("redo as real-world weapon").
- Bottom panel: every weapon FBX in the project, tag input ("real-world
  weapon name to map this FBX to"), badges for NEW (lowpolyguns) /
  USED (manifest-assigned).
- `remove` (or `#remove`) clears a tag; `delete` (or `#delete`) marks
  the entity for removal in the export.
- Newest-wins dedupe — saving a tag value that another entry already
  holds drops the older entries and clears their UI.
- Click any model preview opens a fullscreen pose-tuning modal with
  drag markers (main hand / support hand / shoulder mount, gated by
  weapon class) and attachment-slot squares. Right-click resets,
  escape closes.
- Two export buttons: tag JSON (with deletions + revisit list) and
  side-view PNG zip (renders 512×288 PNGs for every in-game weapon's
  model).

### tools/model_viewer.html
- Standalone grid of every extracted .fbx with category filter +
  regex search + per-tile annotation textarea + bulk render-to-PNG
  export. Pre-existing; still useful for FBX reconnaissance.

---

## Known rough edges / minor bugs

- Some FBX files still have unexpected initial orientation in-hand;
  case-by-case via `MODEL_GRIP_OFFSET` / `MODEL_ROTATION_OVERRIDE` in
  `model_manifest.js`.
- Player-restart after death scales chip earnings down (intended), but
  doesn't currently show a HUD indicator reminding the player why the
  chip drop rate has shrunk beyond the transient toast.
- Wall proximity-fade was removed (too many false positives); the two
  camera-to-player raycasts at head-height catch most cases but edge
  geometry can still not-fade.
- Starting-store and leaderboard use separate localStorage keys; a
  "reset progress" button in Settings would be a nice-to-have.
- Post-FX chromatic aberration at screen edges can make small UI text
  read slightly fringed. Reduce `uChroma` further if it becomes a
  complaint.
- Audio context requires a user gesture to start (browser policy) —
  the first click on the main menu unlocks it.

---

## Speculative / design-decision-needed

- [ ] **Co-op play.** Spec says no multiplayer, but couch-co-op split
      would be tractable. Scope creep risk — only worth it once single-
      player core is proven.
- [ ] **Hardcore mode.** Death deletes the character's stash.
- [ ] **Seasonal contracts / daily challenges.** Requires a backend or
      signed deterministic seeds.
- [ ] **Weapon mastery cosmetics** — unique skins at class mastery
      capstone. Easier to author now that every weapon has a render
      PNG (could just swap in a tinted variant).
