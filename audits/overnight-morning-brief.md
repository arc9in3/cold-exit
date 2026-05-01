# Overnight session — morning brief

Live URL: https://cold-exit.pages.dev (latest commit pushed). Worker:
https://tacticalrogue-api.nguyenlandon83.workers.dev (verified live —
`POST /coop/host` returns a fresh code). Build label bottom-right of the
HUD shows the deployed version.

## What landed

### P2P co-op — substantial hardening + feature pass

| Commit | Title |
|---|---|
| `15a3383` | senior network audit fixes + body-loot snapshot/RPC |
| `077893c` | drone snapshot + megaboss snapshot + buffer cleanup |
| `4f7c9b9` | UI polish — hideout tab transitions, contract cards, main menu fade-in |
| `5cd868d` | death-screen polish + body-loot anti-flicker |

**Network-engineer audit findings + fixes:**
1. **Server-side kind authorization** — added per-role allow-lists on the
   Worker (`KIND_ALLOWED_FROM_HOST`, `KIND_ALLOWED_FROM_JOINER`,
   `KIND_ALLOWED_FROM_ANY`). A modified client can no longer send
   `rpc-grant-xp` to themselves; the relay rejects with a `forbidden-kind`
   error.
2. **64KB message size cap** — refuse oversized WS frames with `error:
   too-large`. Was a 1MB JSON-bomb DoS vector.
3. **Per-connection rate limit** — token bucket: 200 cap, 200/s refill.
   Persistent overflow > 50 → kick. Was a flood-DoS vector.
4. **Reconnect peerId leak** — on WS close, clear peerId/hostId/peers/rtt.
   Brief reconnect window no longer routes against stale ids.
5. **Fake host-migration replaced** — server now broadcasts `host-lost`
   and tears the room down cleanly. Previously promoted a peerId without
   transferring authoritative state, causing silent desync.
6. **Snapshot interpolation** (Quake/Source pattern) — buffer ~6 frames
   of history, render at `T-100ms` between two known-good frames at the
   right alpha. Smoother than chasing a moving target with per-frame lerp.

**Co-op feature additions:**
- Drone snapshot: position + HP synced; AI gated on joiner side
  (joiners no longer see frozen drones).
- Megaboss snapshot: position + HP + phase. Hazards (fires, bullets,
  gas) NOT yet synced — joiner sees the boss move but its attacks
  render on host only. Tagged in code as v1 partial.
- Body-loot snapshot: dead enemy `loot` arrays inlined per-tick.
  Joiner can search corpses their teammate killed and pull items
  into their inventory via `rpc-body-take`.
- Body-loot anti-flicker: 220ms cooldown after take — corpse-section
  apply skips entities with active cooldown so the just-taken item
  can't briefly re-appear before the host's RPC reflects.

### UI / animations

- **Hideout tab transitions**: every tab body fades + slide-up on
  render (220ms). Section heads stagger 60ms behind.
- **Contract cards**: redesigned entrance — staggered "deal" animation
  (drop + rotate + bounce, 80ms apart). Hover bumps to translateY(-6)
  scale(1.04) with a brighter outer glow. Per-rarity outer glow
  scales with rarity. Legendary cards pulse every 2.4s.
- **Contracts heading**: pulse animation on the "SELECT A CONTRACT"
  glow + diamond brackets `◆ … ◆`.
- **Main menu**: 600ms fade-in. Buttons stagger up (80ms steps) so
  the rail builds rather than snapping.
- **Coop lobby modal**: backdrop fades + 2px blur, card enters with
  280ms slide-up + scale. Friendlier copy on Hide vs Disconnect
  buttons (titles tell the user what each one does).
- **Death screen**: vignette ramps in over 1.2s, card rises with blur
  unblur + scale, title breathes (letter-spacing + glow pulse), stat
  rows stagger in 100ms apart. Reads as a "you died" moment.

### Code audit (no behavior change)

- `_coopJoiner` IIFE replaced with inline read of the transport
  singleton — saves 60 closure allocs/sec at 60Hz tick rate.
- `clearSnapshotBuffer()` exposed; main.js wires it on transport
  close + host-lost so a stale frame can't drive the next session's
  apply path.

## Where co-op stands

| Milestone | Status |
|---|---|
| Server transport + lobby | ✅ |
| Level seed sync | ✅ |
| Enemy snapshot (20Hz) + interpolation | ✅ |
| Multi-target AI | ✅ |
| Joiner→host damage RPC | ✅ |
| Host→joiner damage RPC (bullet/flame/melee) | ✅ |
| Loot visual sync (instanced) | ✅ |
| Loot pickup RPC | ✅ |
| Joiner inventory drops | ✅ |
| **Body-loot search + take** | ✅ |
| **Drone snapshot** | ✅ |
| **Megaboss position + HP snapshot** | ✅ (hazards still host-only) |
| Joiner enemy death animation | ✅ |
| XP attribution | ✅ |
| **Server-side kind auth + rate limit + size cap** | ✅ |
| **Host-lost teardown** | ✅ |

## Known limits / next-session work

1. **Megaboss hazards**: joiner sees the boss but doesn't take damage
   from its fires / bullets / gas. Need to snapshot the hazard list
   (positions, damage, lifetime) or route hazard hits through
   `rpc-player-damage`.
2. **Container chests**: chest-loot opens a shared modal locally per
   side; isn't synced. Same pattern as body-loot — would inline the
   container's contents in a snapshot section.
3. **Snapshot bandwidth**: client→DO→peers double JSON cycle. The DO
   could pass-through bytes and just stamp `from`. Not a real cost
   yet at our message rates but worth doing before scale.
4. **Joiner credit / skill-point attribution**: joiner kills give
   joiner XP correctly now, but credits and skill-points still
   accumulate on host. Need an `rpc-grant-rewards` carrying the
   bundle.
5. **Per-peer death/extract overlays**: when a joiner dies, host
   keeps playing. When host dies, the run-end flow should respect
   joiners somehow — currently the room just ends.

## What I deliberately didn't touch

- Shop NPC portraits — they already use 3D-rendered avatars
  (`keeperPortrait`) consistent with in-world rigs. Generating new
  static images risked off-style art; left alone.
- Balance numbers — without playtest signal, blind balance changes
  are higher-risk than higher-value.
- Refactoring main.js (14k lines).

## How to verify in the morning

1. Open `https://cold-exit.pages.dev/?coop=1` in two browsers.
2. Tab A: Shift+C → Host new room → click Hide → start a run.
3. Tab B: paste shared URL → click Join → click Hide → start a run.
4. Both should land in the same level (same seed). Cyan beam shows
   the other player.
5. Run together: kill enemies, search corpses, pick up loot. The
   instanced rules:
   - Joiner kills → joiner-only loot (host doesn't see the cube)
   - Host kills → shared loot (both see, first claims)
   - Either drops from inventory → shared loot
   - Joiner gets XP for their kills (HP bar advances on their side)

If anything is broken, paste the dev console — every coop event has
a `[coop] …` log prefix and the build label in the bottom-right of
each HUD shows which version is running.
