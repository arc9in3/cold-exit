## Director's Office — hideout sketch

### Camera + framing

Single fixed isometric camera, locked angle. NOT player-controllable in this room. Reads as a STAGED SCENE the player observes, not navigates. Player walks IN, the camera locks, the director's chair anchors the composition.

```
   camera at ~30° pitch, looking at the chair from behind-left
   ↘
   ┌─────────────────────────────────────────┐
   │                                         │
   │     [window: rain on city skyline]      │
   │                                         │
   │     ╔══════╗                            │
   │     ║ DESK ║   ← contracts board to     │
   │     ║      ║     director's right       │
   │     ╚══════╝                            │
   │      [chair]   ← high-back, faces away  │
   │      ◢      ◣                          │
   │     /        \                          │
   │    /  rug     \                         │
   │   /            \                        │
   │  filing cabinet                          │
   │     ─ entry door ─                       │
   │                                         │
   └─────────────────────────────────────────┘
```

### Top-down layout (10m × 8m room)

```
   N
   ↑
   ┌──────────────────────────────────────┐ 8m
   │  whiskey   contracts   merc      │
   │   shelf     board      photos    │
   │     │         │           │       │  ← back wall
   │     │      [DESK 2x1]              │
   │     │         │   ↑               │
   │     │      [ chair ] ← faces N    │
   │     │     (player walks up        │
   │     │      and sees the BACK)     │
   │     │                             │
   │     │       [ rug ]               │
   │     │                             │
   │  filing    side       drink       │
   │  cabinet   table      cart        │
   │                                    │
   │              ┌────┐                │  ← entry door, S wall
   └──────────────┤    ├────────────────┘
                  └────┘
       0m ←──── 10m ────→
```

### Composition rules

- **Chair faces NORTH (away from camera + player entry).** Player and camera see the BACK of the chair. The director's identity is a void the player fills.
- **Desk is between chair and back wall.** Has: papers, two screens (one shows the contracts board, one a city map), a whiskey tumbler, an ashtray (smoke particles drifting), a single gold watch.
- **Window behind the desk.** Looking out at a rain-soaked city skyline at night. Distant neon signs. Reads as "you're at the top of an ugly building." Wet glass, occasional lightning flash.
- **Contracts board on the back wall left.** Cork board with pinned papers, red string, photos. THIS is the player's interaction surface — clicking the contracts board opens the contract picker UI.
- **Merc photos on the back wall right.** Polaroids of named cast members (unlocked specials). Greyed out before unlock; full color after. Click to view dossier.
- **Filing cabinet on the west wall.** The agency's records. Click to view past contracts log. Possibly hide unlocks (achievements) here.
- **Drink cart on the east wall.** Visual flair only.
- **Rug center.** Worn, oriental, slightly off-center. Establishes the room is lived-in.

### Lighting

- Single warm desk lamp (~2700K) on the desk = key light.
- Cool city light (~5500K) from the window = rim/back.
- Flickering monitor glow on the desk papers + chair back.
- Distant lightning flash through the window every ~30s, briefly silhouettes the chair occupant — but you only see the SHAPE, never the face.

### Audio

- Distant rain.
- Occasional thunder.
- Slow ticking grandfather clock somewhere off-screen.
- The chair creaks once when the player enters the room ("I see you're back").
- Director's voice plays positionally from the chair when they speak.

### Interaction surfaces

| Surface | Action | Scope |
|---|---|---|
| Contracts board (back wall L) | Open contract picker | Mission select |
| Merc photos (back wall R) | Open named-cast dossier | Meta progression view |
| Filing cabinet (W wall) | Open past-contracts log | History |
| Desk papers (close-up) | Director's notes / journal entries | Narrative beats |
| Whiskey tumbler | Voice line: "Long day." | Flavor |
| The chair itself | NOT interactable. The chair is sacred. | (player can't sit) |

### Why the chair is sacred

The chair faces away. The player never sees what's in it. They project themselves into it — they ARE what's in it. Letting the player rotate the camera or sit in the chair would break the projection. The framing forces the player to be A PERSON STANDING IN THE DIRECTOR'S OFFICE, talking TO the chair, while the director (= them) listens.

This is the trick: in cinema you'd cut to a portrait. In games you let the player BE the director by making the director invisible.

### Implementation notes (Three.js)

- Reuse hideout primitive system — desk, chair, cabinet, rug all box geometries with PBR materials.
- Window = a tall plane with a procedural city texture (fog + dots for windows + occasional moving dots for cars). Or a baked panorama image.
- Smoke particles: a small THREE.Points system from a point above the ashtray, soft additive material, low alpha, 6-8 particles drifting up.
- Rain visible through window: a Points system with vertical streak quads, scrolling y velocity. Can be a low-poly canvas overlay if shader fidelity isn't worth it.
- Voice playback: use existing audio system; positional from chair location (Vector3 fixed).
- Lightning: a screen-flash ColorMaterial overlay triggered every 25-40s on a stochastic timer.

### Scope estimate

- Office room geometry (desk, chair, cabinet, rug, drink cart, side table, walls): ~4h
- Window + procedural skyline / rain: ~3h
- Contracts board + merc-photo wall (interactable): ~3h
- Director voice line plumbing (place + trigger lines): ~2h
- Lighting + ambient (smoke, lightning, audio): ~2h

~half a week of focused work to land it polished. Can stub a placeholder version (chair + desk + walls only) in 30 minutes for blocking.
