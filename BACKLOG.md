# Cold Exit — backlog

A snapshot of known gaps, deferred work, and candidate next steps. Not
exhaustive; living document.

Last updated: 2026-04-25 (Pages git-connected for auto-deploy).

## Web deploy shipping notes

- **Live URL:** `cold-exit.pages.dev` (Cloudflare Pages, git-connected
  to `github.com/arc9in3/cold-exit` — push to `main` auto-deploys.
  `npx wrangler pages deploy .` still works as a manual override).
- **Assets ignored from deploy:** source-archive `.zip`s in `Assets/`
  (`poly_*`, `style_*`) — listed in `.assetsignore`. Extracted runtime
  FBX + textures ship fine.
- **Git repo:** `github.com/arc9in3/cold-exit` — public, public Pages
  project. Leaderboard Worker is scaffolded in `worker/` but not yet
  deployed; the game's local-first leaderboard works standalone until
  the Worker's URL is pasted into `src/api_config.js:COMPILED_API_BASE`.

## Style / art pass (in-flight)

- [x] Main menu restyled to the `Assets/coldexitmain.png` splash art
      (tech-mono tokens, ice-blue rail divider).
- [x] CSS design tokens (`--ce-*` palette + fonts + `.ce-panel`
      corner-bracket helper) rolled into Esc menu, main menu, settings
      form rows, leaderboard cards, modal bases.
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
      them. Top-10 per category kept in localStorage; backend sync
      stubbed behind `Leaderboard.submitRun` for a later hookup.
- [x] **Death flow rewrite** — two-button death screen: Restart Level
      (bumps `restartCount`, taints run, scales chip earnings down by
      up to 67%) or Back to Main Menu (resets meta, returns to menu).
      Previous single-button restart-from-snapshot still works.

### Rendering / art
- [x] **Procedural primitive rig** (`src/actor_rig.js`) — cylinders +
      joint spheres + sectional gear colouring. Shared by player and
      enemies (no skinned-FBX path live; flagged dormant behind
      `window.__skinnedRig`).
- [x] **Post-FX pipeline** (`src/postfx.js`) — EffectComposer stack with
      UnrealBloomPass + custom finisher (vignette + chromatic
      aberration, grain currently disabled). Gated on
      `qualityFlags.postFx`, off in low mode.
- [x] **Bloom-safe art pass** — Great Bear fur cooled off pure white so
      it doesn't overpower the bloom threshold; ceiling fixtures
      removed; spotlight ceiling lamps instead of point lights for
      clearer lit/unlit contrast.
- [x] **Darker scene base** — hemisphere 0.25 → 0.06, key light 1.25 →
      0.70, fill/rim proportionally trimmed. Unlit corners read as
      proper shadow without washing the key surfaces out.
- [x] **Rotation order fix** — hips + chest + stomach now use `YXZ`
      so forward-lean pitch stays in the character's local frame
      regardless of aim yaw. Fixes the "muzzle only points down when
      facing forward" bug.
- [x] **Rifle-hold shoulder compensation** — `rightShoulderAnchor` /
      `leftShoulderAnchor` counter-rotate by `-armLeanComp` during the
      rifle pose, so shouldered long guns stay level through crouch /
      run / dash instead of drooping with the chest.

### Audio
- [x] **Ambient bed** — `sfx.ambientStart/Stop`. Low-passed noise HVAC
      hum + two detuned sub drones with slow LFO swell. Starts on run
      begin, stops on menu/quit.
- [x] **Footsteps** — distance-accumulator `tickFootsteps` in
      `main.js` picks per-step cadence from horizontal speed; run
      steps louder than walk.
- [x] **Reverb bus** — synthetic IR ConvolverNode, short-room tail,
      routed as a send from every SFX via `connectToWet`.
- [x] **Per-class firing samples, death, reload, pickup, UI, explode,
      impact** — all WebAudio-synth, no asset files.

### Combat / AI
- [x] **Boss seal fixed** — `tryBossSeal` checks the boss is physically
      inside the room before locking doors. Previously sealed with the
      boss stranded outside, trapping the player.
- [x] **Boss containment** — gunman + melee bosses clamp to their room
      bounds, can't wander into adjacent corridors.
- [x] **Gunman door-cross fix** — AI now pushes through doorways
      instead of stalling at a 0.6 m threshold; squads no longer pile
      up at the first choke point.
- [x] **Flanking against crouched-in-cover** — cover-flanking triggers
      at 0.6 s of no-LoS (half the usual) with a wider flank angle
      when the player is crouched, so cover isn't a free safe space.
- [x] **Rear blindspot widened** — `facingDot < -0.4` (~115° rear arc).
      Melee enemies got a matching check so stealth works against both.
- [x] **Proximity override** — gunmen + melee now auto-detect a player
      within 3 m with line of sight regardless of stealth multiplier
      / cone (but still respect rear blindspot).
- [x] **Shot-noise room-gated** — a fired shot only alerts enemies in
      the same room or an adjacent room through an open door, with a
      3 m same-room LoS-bypass radius. Previous 22 m radius + 6 m
      LoS-skip was waking half the level per volley.
- [x] **Silent executions** — `onEnemyKilled({ silent: true })` skips
      `alertWitnesses` and the death SFX. Execute takedowns no longer
      reveal the player to roommates.
- [x] **Disarm resistance** — arm-hit disarm roll multiplied by 0.10
      for bosses, 0.20 for sub-bosses; grunts unchanged.
- [x] **New variant: runner** — mid-speed mobile rusher with dash +
      strafe + no settle pause. Mag-dump cadence.
- [x] **LMG class heavy-only** — `pickWeaponForAI(variant)` only surfaces
      an LMG when the spawn's variant is `tank`.
- [x] **Bosses fire / swing faster** — ranged bosses `fireT *= 0.55`,
      melee bosses `cooldownMult 0.55 → 0.40`. Sub-bosses eased in
      between.
- [x] **Enemy bunching at spawn fixed** — `pickOpen` soft-fallback no
      longer snaps every enemy to "first door"; relaxed reachability
      retries first, then distributes across all doors.

### Weapons / VFX
- [x] **Flamethrower primitives** — replaced flat cone mesh with
      additive-blended transparent spheres per tick. Particles AABB-
      collide with `level.solidObstacles()` and stop on wall contact;
      cover now actually protects against the flamethrower cone.
- [x] **One-flash-per-volley** — `combat.spawnShot({ flash: false })` +
      new `spawnFlash` so pellet weapons (Dragonbreath, shotguns) emit
      a single muzzle flash per trigger pull instead of N stacked
      flashes with optional PointLights. Resolved the Dragonbreath
      frame-drop.
- [x] **AoE self-damage** — player's own grenades/rockets/frag rounds
      now deal damage with full blast falloff (scaled to 60%) so
      point-blank detonations cost HP.
- [x] **Mythic quarantine** — all non-boss pools filter out mythics
      explicitly (starter, merchant stock, AI weapon rolls, enemy loot).
      Only `rollMythicDrop` surfaces them, and only from major bosses
      at 3%.
- [x] **Rarity redistribution** — regular enemies common/uncommon only;
      rare/epic/legendary concentrate on sub-bosses and bosses, with a
      second-gear bonus roll on boss drops.
- [x] **LMG balance** — +20% hip + ADS spread, +20% damage across all
      four LMGs so they read as "heavy hitter with less pinpoint
      accuracy".

### Movement / feel
- [x] **Roll disabled** — `startRoll` short-circuits to a no-op. The
      hip-pivot math was launching the player across the map in edge
      cases; leaving the entry point wired so inputs compile until it's
      redesigned.
- [x] **Crouch-sprint pose fix** — `runLean` scaled by `(1 - crouch *
      0.85)` so the crouch-sprint reads as a steady low jog instead of
      a forward-pitched dash.
- [x] **Melee block pose** — both arms raise the weapon across the
      chest with elbows tight and a small forward chest crunch. Only
      fires when blocking with a melee weapon equipped.
- [x] **ADS camera rework (v3)** — half zoom (`ADS_ZOOM_STRENGTH =
      0.275`), half peek (`PEEK_STRENGTH = 0.5`), cursor-distance
      smoothstep gate (no ADS influence within 2.5 m of the player).
      Trades the old whiplash for a subtle scoped-in cue.
- [x] **Ragdoll-lite death bodies** — brief hit-direction drift +
      gravity + ground friction + collision against walls on death.
      Settles after ~0.15 s and freezes into a final flat pose. Death
      tilt uses proper axis-angle so diagonal hits land the body flat
      instead of in a 45° twist.

### Doors / geometry
- [x] **Proper prop collision** — `solidObstacles()` filters out
      nulled / invisible obstacles; fixes bullets and LoS being
      absorbed by invisible prop proxies cleared by
      `_clearDoorCorridors`.
- [x] **Boss-room door-trap fix** — if the player is inside a door
      when it re-solidifies on seal, the seal flow pushes them a
      player-radius + margin into the boss room along the door→room
      axis.
- [x] **Fence-pattern fix** — `_sealRoomPerimeters` `checkRadius` 0.9
      → 0.35 so adjacent perimeter plugs stop mutually skipping (the
      picket-fence pattern with walkable gaps).
- [x] **Door overlap repair** — final `_repairDoorOverlaps` pass nulls
      collision on any obstacle whose AABB strictly intersects a door's
      gap span, catching the "door spawns but a wall is still there"
      case the heuristic flanker-preserve rule missed.
- [x] **Graph connectivity check** — `validateConnectivity` runs at
      level-gen end and warns on any unreachable rooms.

### Input / UI
- [x] **Global context-menu + mouseup capture** — moved to `window` so
      right-click can't open the browser menu anywhere in the tab and
      button releases over modals don't leak stuck-held state.
- [x] **`input.clearMouseState()`** — called around skill-draft /
      extract / mastery-offer modals to guarantee no held button
      leaks into the next gameplay frame.

### Debug surface
- [x] **`__debug.tuneWeapon / inspectWeapon`** — live-tuning for the
      active weapon clone's position + rotation, plus a dump of
      bbox/scale/mesh-count for diagnosing invisible models.
- [x] **`__debug.traceShots`** — toggles per-hit logging to identify
      which mesh absorbs a shot (used to track the prop-proxy blocker
      bug).
- [x] **`__debug.findBlockedDoors()`** — returns every door whose
      approach strip contains a non-door / non-elevator obstacle with
      live collision, with pos / size / colour / name / mesh ref.

---

## M1 / M2 foundation — assumed done (verify in playtest)

- [x] Player movement + isometric camera
- [x] Ranged combat with hip/ADS spread, tracers, pellets
- [x] Melee combat with combo chains + close/far variants
- [x] Enemy AI (ranged + dedicated melee) + variants (dasher, runner,
      cover-seeker, tank, shielded pistol)
- [x] Slot-based anatomical inventory (1×1 cells, drag/drop)
- [x] Loot pickup + backpack + workspace staging
- [x] Shop / merchant with price scaling
- [x] Artifacts (run-long permanent buffs)
- [x] Per-class mastery (5 tiers × 7 classes)
- [x] Gear affix roller + set bonuses
- [x] Skill tree (meta-progression) with required prerequisites
      enforced at mastery-offer time
- [x] Extraction → level regen; endless (no final extraction)
- [x] Persistent contract chips

---

## Near-term polish

### Throwables (scaffold landed, behaviour pending)
- [ ] **Molotov landing effect** — `THROWABLE_DEFS.molotov` exists
      (aoeRadius + fireTickDps + fireDuration) but no fire-zone
      spawner wired. Needs a per-tile DoT source in `combat.js` that
      burns enemies for `fireDuration` seconds after impact.
- [ ] **Flashbang blind pulse** — flashes enemies inside `aoeRadius`
      with `blindDuration`. `blindT` per-enemy field already exists;
      just needs a radial pulse on throw impact.
- [ ] **Stun grenade dazzle** — same pattern as flashbang but using
      `dazzleT` with a `stunDuration` value.
- [ ] **Throw input path** — no binding yet. Needs action-bar slot
      integration (inventory has `type: 'throwable'` now) and a
      projectile spawn through `ProjectileManager`.
- [ ] **Loot roll** — throwables aren't in `buildBodyLoot` yet.

### Leaderboard online sync
- [ ] **Backend endpoint** — `Leaderboard.submitRun` currently only
      writes localStorage. Pick hosting (Netlify fn / Firebase free
      tier / tiny express on a VPS) and add a POST call behind a flag.
- [ ] **Anti-cheat floor** — some sanity clamps on submitted scores
      before persisting to the server.
- [ ] **Display toggle** — local vs global top-10 in the menu.

### 3D rendering / models
- [ ] **Per-item model rotation offsets** — `modelRotation` field
      supported in tunable item defs for in-hand; add the same for
      ground loot in `loot.js`. Some FBX meshes still ship facing the
      wrong way.
- [ ] **Ensure atlas-only models look right** — periodic audit in the
      model viewer for any blank/missing UVs.
- [ ] **SMG grip offsets** — per-model table populated with negative
      Z offsets for each SMG FBX. Fine-tune values from playtest.
- [ ] **Cursor-locked zoom for ADS** — current zoom still shifts
      off-center targets slightly because the orthographic scale
      pivots on lookAt. Compensate by translating the camera so the
      world point under the cursor stays fixed through the zoom.

### Item variety not yet wired
- [ ] **Bipod crouch-only effect** — currently flat `adsSpreadMult`;
      want `crouchSpreadMult` for "braced" feel.
- [ ] **Shield bearer melee full-block** — already rendered (curved
      ballistic panel), but the bullet block-front behaviour hasn't
      been re-verified after the rig rework.

### Balance
- [ ] Numbers are still first-pass across a lot of the weapon /
      class / artifact / skill-tree surface. Needs proper
      playtest-tuning sessions, not math.
- [ ] Class mastery XP thresholds untouched since before the weapon
      expansion.

---

## Larger deferred work

### Melee
- [ ] Wire the 57-model melee pack beyond the 4 currently mapped.
- [ ] Heavy-weight melee animations (hammer, cleaver, sword variants).

### Enemies
- [ ] More archetypes: shield carrier (variant exists; ranged AI could
      use its own "big shield" version), grenade thrower, sniper,
      dog-like fast melee, armoured tank.
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
      `window.__skinnedRig` today; blocked on a real retargeter for the
      bone local-axis mismatch.
- [ ] Character customisation kit integration (`style_charactercustomizationkit_V2.zip`).

---

## Engineering / infrastructure

- [ ] **Production bundle script** — scan `inventory.js` +
      `model_manifest.js` for referenced PNG/FBX paths, copy only
      those into `dist/`, output an itch.io-ready zip.
- [ ] **Save schema versioning** — `schemaVersion` field + migration
      table so future changes don't brick old saves.
- [ ] **Tests** — fast-follow: pure-function tests for `rollAffixes`,
      `wrapWeapon`, `effectiveWeapon`, `inferRarity`; snapshot tests
      for `iconForItem` / `modelForItem`.

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
  the first click on the main menu unlocks it; everything before that
  click is silent.

---

## Speculative / design-decision-needed

- [ ] **Co-op play.** Spec says no multiplayer, but couch-co-op split
      would be tractable. Scope creep risk — only worth it once single-
      player core is proven.
- [ ] **Hardcore mode.** Death deletes the character's stash.
- [ ] **Seasonal contracts / daily challenges.** Requires a backend or
      signed deterministic seeds.
- [ ] **Weapon mastery cosmetics** — unique skins at class mastery
      capstone.
