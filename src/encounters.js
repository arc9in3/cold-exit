// Random encounters — rare special rooms placed by the level generator.
// Each encounter is a small narrative / secret. Most are one-shot per
// save (tracked via prefs.getCompletedEncounters), so finding all of
// them takes multiple runs.
//
// Each ENCOUNTER_DEFS entry shape:
//   id            string — stable identifier persisted in prefs
//   name          short label shown above the NPC / object
//   floorColor    hex — distinct floor tint so the room reads as special
//   oncePerSave   bool — true if the encounter should NOT re-appear
//                 once completed. False = repeatable across runs.
//   condition(state) — runtime gate. state = { completed: Set,
//                 levelIndex: int }. Return true to allow this
//                 encounter to be the picked one for a level.
//   spawn(scene, room, ctx) — build the visuals + return a state
//                 object the tick() and onItemDropped() will receive
//                 as `state` (mutable across frames).
//   tick(dt, ctx) — per-frame update for animations / hover prompts
//   onItemDropped(item, ctx) — called when player drops an item in
//                 the encounter room. Return one of:
//                   { consume: false } → ignore (item stays on the floor)
//                   { consume: true, complete?: true } → item is removed,
//                       optionally mark the encounter complete
//
// The runtime sits in main.js: pickEncounterForLevel() fills a room's
// `encounter` slot at gen time, an EncounterRuntime instance walks
// every frame to tick each active encounter and route dropped items
// through it.

import * as THREE from 'three';

// Shared frozen empty list — every hittables() call that has nothing
// to expose returns this reference instead of allocating [] per frame.
// allHittables() runs at 60Hz and was creating one short-lived array
// per encounter even when the encounter had no live targets.
const EMPTY_ARR = Object.freeze([]);

// Hex floor-disc helper used by every encounter spawn. Adds a flat
// glowing ring at the room centre so the room reads as "special" from
// the doorway. Returns the mesh so callers can add additional props
// on top.
function _spawnFloorDisc(scene, room, color) {
  // Prefer the validated walkable spawn point stamped at level-gen
  // time (level._pickAndMarkEncounterRoom). Falls back to the
  // bounds-centre for any code path that constructs an encounter
  // outside the normal pipeline.
  const cx = room._encounterSpawn?.x ?? (room.bounds.minX + room.bounds.maxX) / 2;
  const cz = room._encounterSpawn?.z ?? (room.bounds.minZ + room.bounds.maxZ) / 2;
  const geom = new THREE.CircleGeometry(3.6, 36);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.55,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(cx, 0.03, cz);
  scene.add(mesh);
  // Soft point light overhead — colour matches the floor for a cozy
  // pool of light readable from across the room.
  const light = new THREE.PointLight(color, 0.9, 9);
  light.position.set(cx, 3.2, cz);
  scene.add(light);
  return { disc: mesh, light, cx, cz };
}

// Floating speech-bubble helper — the level builds a sprite-style
// label above the NPC. Caller supplies a parent group (kiosk root)
// and the text. Sprite is shared across encounter ticks; replace
// `texture.image` text via canvas for prompt updates.
function _makeLabelSprite(text, color = '#e8dfc8') {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  const draw = (str) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = 'bold 36px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(0, 24, canvas.width, 56);
    ctx.fillStyle = color;
    ctx.fillText(str, canvas.width / 2, canvas.height / 2);
  };
  draw(text);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false,
  }));
  sprite.scale.set(4.2, 0.78, 1);
  sprite.userData.setText = (str) => { draw(str); tex.needsUpdate = true; };
  return sprite;
}

// Build a primitive-styled NPC body — same cylinder + sphere stack the
// shopkeeper/Bear use, but tinted per encounter and stripped down to
// a single static pose (no animation needed).
function _buildSimpleNpc({ bodyColor = 0x4a5060, headColor = 0xd8c8a8,
                          accentColor = 0xc9a87a, height = 1.8 } = {}) {
  // Three meshes total — single tapered body (torso + legs combined),
  // head sphere, optional thin accent ring at chest height. Cuts from
  // 5 meshes → 3 and drops separate leg geometries entirely. Encounter
  // NPCs aren't rigged; they're stationary props that just need to
  // read as "person" at iso distance.
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.85 });
  const headMat = new THREE.MeshStandardMaterial({ color: headColor, roughness: 0.7 });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accentColor, roughness: 0.5, metalness: 0.3,
    emissive: accentColor, emissiveIntensity: 0.18,
  });
  // Body — tapered cylinder from boots up to shoulders.
  const bodyHeight = height * 0.85;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.22, bodyHeight, 8),
    bodyMat,
  );
  body.position.y = bodyHeight / 2;
  body.castShadow = true;
  group.add(body);
  // Head — single sphere on top.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), headMat);
  head.position.y = bodyHeight + 0.16;
  head.castShadow = true;
  group.add(head);
  // Accent ring — thin band that picks up the role colour.
  const accent = new THREE.Mesh(
    new THREE.CylinderGeometry(0.21, 0.21, 0.05, 8),
    accentMat,
  );
  accent.position.y = bodyHeight * 0.78;
  group.add(accent);
  return group;
}

// Build a duck — yellow oblong body, smaller head sphere, tiny dark
// eyes, orange beak. Sits centred at origin.
function _buildDuck() {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf0d840, roughness: 0.7 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xd87a20, roughness: 0.6 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.35, 14, 10), bodyMat);
  body.scale.set(1, 0.7, 1.4);
  body.position.y = 0.30;
  body.castShadow = true;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.20, 12, 10), bodyMat);
  head.position.set(0, 0.55, -0.30);
  head.castShadow = true;
  group.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 8), accentMat);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.52, -0.50);
  group.add(beak);
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), eyeMat);
  const eyeR = eyeL.clone();
  eyeL.position.set(-0.10, 0.60, -0.36);
  eyeR.position.set( 0.10, 0.60, -0.36);
  group.add(eyeL, eyeR);
  return group;
}

// Build a confession booth — tall narrow wooden box with a curtain
// arch on the front and a small grille on the side. Reads as a small
// religious confessional from a few metres away.
function _buildConfessionBooth() {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a2e1a, roughness: 0.85 });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0xc9a050, roughness: 0.4, metalness: 0.4,
    emissive: 0x6a4810, emissiveIntensity: 0.35,
  });
  const curtainMat = new THREE.MeshStandardMaterial({ color: 0x682018, roughness: 0.9 });
  // Booth shell.
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 0.10), woodMat);
  back.position.set(0, 1.20, -0.50);
  back.castShadow = true;
  group.add(back);
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.10, 2.4, 1.0), woodMat);
  left.position.set(-0.65, 1.20, 0);
  group.add(left);
  const right = left.clone();
  right.position.set(0.65, 1.20, 0);
  group.add(right);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.10, 1.2), woodMat);
  roof.position.set(0, 2.50, -0.05);
  group.add(roof);
  // Curtain arch — slight forward bulge using two stacked tilted boxes.
  const curtain = new THREE.Mesh(new THREE.BoxGeometry(1.20, 1.6, 0.06), curtainMat);
  curtain.position.set(0, 1.0, 0.50);
  group.add(curtain);
  // Gold trim cross above the curtain.
  const cv = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.45, 0.06), trimMat);
  cv.position.set(0, 2.30, 0.52);
  group.add(cv);
  const ch = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.10, 0.06), trimMat);
  ch.position.set(0, 2.32, 0.52);
  group.add(ch);
  return group;
}

// Build a small skull for the cairn. Returns a Mesh.
function _buildSkull() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xe8dfc8, roughness: 0.6,
    emissive: 0x402010, emissiveIntensity: 0.10,
  });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x080406 });
  const group = new THREE.Group();
  const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mat);
  cranium.castShadow = true;
  group.add(cranium);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.18), mat);
  jaw.position.set(0, -0.16, 0.04);
  group.add(jaw);
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), eyeMat);
  const eyeR = eyeL.clone();
  eyeL.position.set(-0.06, 0.02, 0.13);
  eyeR.position.set( 0.06, 0.02, 0.13);
  group.add(eyeL, eyeR);
  return group;
}

// Build a cairn — pyramid stack of `count` skulls roughly 1m wide,
// 0.8m tall. Returns a parent group with `dispose()` already wired
// for the collapse animation (rotation per skull).
function _buildSkullCairn(count = 9) {
  const cairn = new THREE.Group();
  let placed = 0;
  for (let layer = 0; placed < count; layer++) {
    const radius = 0.40 - layer * 0.10;
    const ringCount = layer === 0 ? 5 : Math.max(1, 4 - layer);
    for (let i = 0; i < ringCount && placed < count; i++) {
      const a = (i / ringCount) * Math.PI * 2 + (layer * 0.25);
      const skull = _buildSkull();
      skull.position.set(
        Math.cos(a) * radius,
        0.18 + layer * 0.30,
        Math.sin(a) * radius,
      );
      skull.rotation.y = a + Math.PI;
      cairn.add(skull);
      placed++;
    }
  }
  return cairn;
}

// Build a glass display case — pedestal + four glass walls + roof.
// Inner mesh shows a glowing stand-in for the legendary weapon.
// Returns the group plus references to the glass meshes (for breaking)
// and the inner item slot.
function _buildGlassCase(itemTint = 0xffffff) {
  const group = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x383d48, roughness: 0.55, metalness: 0.4 });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0xc8a868, roughness: 0.4, metalness: 0.7,
    emissive: 0x402a10, emissiveIntensity: 0.25,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xa8c8d8, roughness: 0.05, metalness: 0.0,
    transparent: true, opacity: 0.30,
    emissive: 0x103040, emissiveIntensity: 0.18,
  });
  // Pedestal.
  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.55, 0.95), baseMat);
  pedestal.position.y = 0.275;
  pedestal.castShadow = true;
  group.add(pedestal);
  const pedTop = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.05, 1.05), trimMat);
  pedTop.position.y = 0.575;
  group.add(pedTop);
  // Four glass walls.
  const glassRefs = [];
  const wall = (x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.4, d), glassMat);
    m.position.set(x, 1.30, z);
    group.add(m);
    glassRefs.push(m);
    return m;
  };
  wall(0,  0.45, 0.95, 0.04);
  wall(0, -0.45, 0.95, 0.04);
  wall( 0.45, 0, 0.04, 0.95);
  wall(-0.45, 0, 0.04, 0.95);
  // Roof.
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 1.0), trimMat);
  roof.position.y = 2.05;
  group.add(roof);
  // Inner item — a glowing rectangle tinted by the legendary's color.
  const itemMat = new THREE.MeshStandardMaterial({
    color: itemTint, roughness: 0.3, metalness: 0.6,
    emissive: itemTint, emissiveIntensity: 0.55,
  });
  const innerItem = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.10, 0.18), itemMat);
  innerItem.position.set(0, 1.10, 0);
  group.add(innerItem);
  // Small point light inside to make the item read.
  const light = new THREE.PointLight(itemTint, 0.7, 3.5);
  light.position.set(0, 1.20, 0);
  group.add(light);
  return { group, glassRefs, innerItem, glassMat, light };
}

// Build a free-standing whispering door — heavy stone arch with the
// door slab inside it. Decorative; no walls behind it.
function _buildWhisperingDoor() {
  const group = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6a7080, roughness: 0.85 });
  const doorMat = new THREE.MeshStandardMaterial({
    color: 0x2a2226, roughness: 0.55, metalness: 0.4,
    emissive: 0x101020, emissiveIntensity: 0.25,
  });
  // Side jambs.
  const jL = new THREE.Mesh(new THREE.BoxGeometry(0.30, 2.6, 0.50), stoneMat);
  jL.position.set(-0.65, 1.30, 0);
  jL.castShadow = true;
  group.add(jL);
  const jR = jL.clone();
  jR.position.set(0.65, 1.30, 0);
  group.add(jR);
  // Lintel + cap.
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.28, 0.55), stoneMat);
  lintel.position.set(0, 2.74, 0);
  group.add(lintel);
  // Door slab.
  const slab = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.30, 0.10), doorMat);
  slab.position.set(0, 1.15, 0.05);
  group.add(slab);
  // Brass handle.
  const handleMat = new THREE.MeshStandardMaterial({
    color: 0xc8a060, roughness: 0.4, metalness: 0.7,
    emissive: 0x402a10, emissiveIntensity: 0.3,
  });
  const handle = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), handleMat);
  handle.position.set(0.32, 1.10, 0.16);
  group.add(handle);
  return group;
}

// Build a small fountain — circular stone basin + central spout +
// a faint upward-shimmer cone. Read as inviting from any angle.
function _buildFountain() {
  const group = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xa0a8b0, roughness: 0.85 });
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x5090c0, roughness: 0.15, metalness: 0.0,
    transparent: true, opacity: 0.78,
    emissive: 0x103060, emissiveIntensity: 0.4,
  });
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 0.55, 24), stoneMat);
  basin.position.y = 0.275;
  basin.castShadow = true;
  group.add(basin);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.06, 22), waterMat);
  water.position.y = 0.55;
  group.add(water);
  // Central pillar with spout.
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.95, 12), stoneMat);
  pillar.position.y = 1.02;
  group.add(pillar);
  const spoutCap = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), stoneMat);
  spoutCap.position.y = 1.55;
  group.add(spoutCap);
  // Shimmer cone of water rising from spout.
  const stream = new THREE.Mesh(
    new THREE.ConeGeometry(0.08, 0.40, 8),
    waterMat,
  );
  stream.position.y = 1.78;
  group.add(stream);
  return { group, water, stream };
}

// Build a smashed cart for the broken-vendor encounter — a couple of
// tilted plank rectangles + a fallen wheel. Reads as wreckage from a
// few metres away.
function _buildSmashedCart() {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6a4828, roughness: 0.85 });
  const wood2 = new THREE.MeshStandardMaterial({ color: 0x9c7444, roughness: 0.85 });
  const plank = (x, y, z, w, h, d, rotZ = 0, rotY = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), woodMat);
    m.position.set(x, y, z);
    m.rotation.z = rotZ;
    m.rotation.y = rotY;
    m.castShadow = true;
    group.add(m);
    return m;
  };
  plank(0, 0.10, 0, 1.6, 0.12, 0.9);
  plank(-0.45, 0.30, 0.30, 1.0, 0.10, 0.20, 0.4, 0.3);
  plank(0.50, 0.20, -0.25, 0.9, 0.10, 0.15, -0.2, -0.4);
  // Fallen wheel.
  const wheel = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.06, 6, 16),
    wood2,
  );
  wheel.position.set(0.85, 0.05, 0.40);
  wheel.rotation.x = Math.PI / 2;
  wheel.rotation.z = 0.3;
  group.add(wheel);
  return group;
}

export const ENCOUNTER_DEFS = {
  // -----------------------------------------------------------------
  // Royal Emissary — drop the King's Signet to receive a masterwork
  // chest. Without the signet he just barks lines.
  royal_emissary: {
    id: 'royal_emissary',
    name: 'Royal Emissary',
    floorColor: 0xa080d0,            // regal purple
    oncePerSave: true,
    condition: (state) => state.levelIndex >= 2,
    barks: [
      'I deal only with those tied to the royal family.',
      'Begone, commoner — the Crown has no business with you.',
      'Show me the seal. Until then I have nothing for you.',
      'No seal, no audience. Move along.',
    ],
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      const npc = _buildSimpleNpc({
        bodyColor: 0x3a2a55, headColor: 0xd0b890,
        accentColor: 0xd0b040, height: 1.9,
      });
      npc.position.set(disc.cx, 0, disc.cz);
      scene.add(npc);
      // Floating label above his head.
      const label = _makeLabelSprite('ROYAL EMISSARY', '#e8d090');
      label.position.set(disc.cx, 2.6, disc.cz);
      scene.add(label);
      return {
        npc, label, disc,
        barkT: 0,
        nextBark: 0,
        complete: false,
        // Reused so we don't allocate a Vector3 per frame.
        _tmp: new THREE.Vector3(),
      };
    },
    tick(dt, ctx) {
      const s = ctx.state;
      if (!s.npc) return;
      // Bobbing "alive" idle.
      s.npc.position.y = Math.sin(performance.now() * 0.001) * 0.04;
      // Barks: only when player is close.
      const px = ctx.playerPos.x - s.disc.cx;
      const pz = ctx.playerPos.z - s.disc.cz;
      const d2 = px * px + pz * pz;
      if (d2 < 36 && s.barkT <= 0 && !s.complete) {
        s.barkT = 4.0 + Math.random() * 2;
        const def = ENCOUNTER_DEFS.royal_emissary;
        const line = def.barks[s.nextBark % def.barks.length];
        s.nextBark++;
        ctx.spawnSpeech(s.npc.position.clone().setY(2.4), line, 3.5);
      }
      s.barkT = Math.max(0, s.barkT - dt);
    },
    onItemDropped(item, ctx) {
      const s = ctx.state;
      if (s.complete) return { consume: false };
      // Match by id OR name so a King's Signet from the rare-junk
      // pool still triggers regardless of which path produced it.
      const isSignet = item && (item.id === 'junk_kingring'
                             || item.name === "King's Signet");
      if (!isSignet) return { consume: false };
      s.complete = true;
      ctx.spawnSpeech(s.npc.position.clone().setY(2.4),
        'The Crown thanks you. A token, in kind.', 4.0);
      // Spawn a masterwork container next to the emissary.
      const ox = s.disc.cx + 1.6;
      const oz = s.disc.cz;
      ctx.spawnMasterworkChest(ox, oz);
      return { consume: true, complete: true };
    },
  },

  // -----------------------------------------------------------------
  // The Duck — quacks until the player drops a Bag of Peas. Then
  // shouts in caps and spawns a random toy. Pure comedic beat.
  duck: {
    id: 'duck',
    name: 'The Duck',
    floorColor: 0xfff080,             // sunny yellow
    // Two-shot per run so the player can get BOTH rewards (Innocent
    // Heart relic + Unused Rocket Ticket → Rocket Shoes via the
    // Bear Merchant). pickEncounterForLevel still filters out the
    // encounter once `_completionsThisRun >= 2` via the condition
    // check below — we mark it run-complete inside onItemDropped at
    // that point so the level-gen filter respects the cap.
    oncePerSave: false,
    _completionsThisRun: 0,
    condition: (state) => state.levelIndex >= 1
      && (ENCOUNTER_DEFS?.duck?._completionsThisRun ?? 0) < 2,
    quacks: ['Quack.', 'Quack quack.', 'Quack?', 'QUACK.'],
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      const duck = _buildDuck();
      duck.position.set(disc.cx, 0, disc.cz);
      scene.add(duck);
      const label = _makeLabelSprite('A DUCK', '#ffe070');
      label.position.set(disc.cx, 1.3, disc.cz);
      scene.add(label);
      return {
        duck, label, disc,
        barkT: 0,
        nextBark: 0,
        complete: false,
        wobbleT: 0,
      };
    },
    tick(dt, ctx) {
      const s = ctx.state;
      if (!s.duck) return;
      s.wobbleT += dt;
      // Subtle waddle — body bob plus head sway.
      s.duck.position.y = Math.abs(Math.sin(s.wobbleT * 3)) * 0.04;
      s.duck.rotation.y = Math.sin(s.wobbleT * 1.6) * 0.18;
      if (s.complete) return;
      const px = ctx.playerPos.x - s.disc.cx;
      const pz = ctx.playerPos.z - s.disc.cz;
      if (px * px + pz * pz < 36 && s.barkT <= 0) {
        s.barkT = 3.5 + Math.random() * 2;
        const def = ENCOUNTER_DEFS.duck;
        const line = def.quacks[s.nextBark % def.quacks.length];
        s.nextBark++;
        ctx.spawnSpeech(s.duck.position.clone().setY(1.2), line, 2.8);
      }
      s.barkT = Math.max(0, s.barkT - dt);
    },
    onItemDropped(item, ctx) {
      const s = ctx.state;
      if (s.complete) return { consume: false };
      const isPeas = item && (item.id === 'junk_peas'
                           || item.name === 'Bag of Peas');
      if (!isPeas) return { consume: false };
      s.complete = true;
      ctx.spawnSpeech(s.duck.position.clone().setY(1.4),
        'DID SOMEONE SAY PEAS?!', 7.0);
      // Reward: 50/50 between the Innocent Heart relic (auto-
      // grants on pickup) and the Unused Rocket Ticket — which is now
      // a piece of junk. Selling the ticket to the Bear Merchant
      // converts it into the Rocket Shoes relic. Innocent Heart is
      // skipped if the player already owns it (it's a one-shot
      // artifact) so re-running the trick still rewards.
      const dropTicket = !ctx.filterUnownedArtifactIds
        || !ctx.filterUnownedArtifactIds(['innocent_heart']).length
        || Math.random() < 0.5;
      if (dropTicket && ctx.spawnRocketTicketJunk) {
        ctx.spawnRocketTicketJunk(s.disc.cx + 0.8, s.disc.cz);
      } else {
        const relic = ctx.relicFor && ctx.relicFor('innocent_heart');
        if (relic) ctx.spawnLoot(s.disc.cx + 0.8, s.disc.cz, relic);
      }
      // Bump the per-run completion counter. Only mark the encounter
      // run-complete after the SECOND successful peas-drop so the
      // duck can re-roll on a later level for the other reward.
      const def = ENCOUNTER_DEFS.duck;
      def._completionsThisRun = (def._completionsThisRun || 0) + 1;
      const exhausted = def._completionsThisRun >= 2;
      if (exhausted && ctx.markEncounterComplete) ctx.markEncounterComplete('duck');
      return { consume: true, complete: exhausted };
    },
  },

  // -----------------------------------------------------------------
  // Wounded Soldier — slumped against the wall, begs for medkits.
  // Drop ANY heal-kind consumable → he gasps thanks, hands you a
  // rare gear piece, then collapses dead.
  wounded_soldier: {
    id: 'wounded_soldier',
    name: 'Wounded Soldier',
    floorColor: 0x803030,             // blood red
    oncePerSave: true,
    condition: (state) => state.levelIndex >= 1,
    pleas: [
      'Help me... please...',
      'I can\'t feel my legs.',
      'A medkit. Anything. I\'m begging.',
      'Don\'t leave me here.',
    ],
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      const npc = _buildSimpleNpc({
        bodyColor: 0x445060, headColor: 0xc8b090,
        accentColor: 0xa84030, height: 1.85,
      });
      // Slumped pose — leans back ~25°.
      npc.rotation.x = -0.45;
      npc.position.set(disc.cx, 0.10, disc.cz);
      scene.add(npc);
      const label = _makeLabelSprite('WOUNDED SOLDIER', '#e8a8a8');
      label.position.set(disc.cx, 2.4, disc.cz);
      scene.add(label);
      return {
        npc, label, disc,
        barkT: 0,
        nextBark: 0,
        complete: false,
        dead: false,
      };
    },
    tick(dt, ctx) {
      const s = ctx.state;
      if (!s.npc) return;
      if (s.dead) return;
      // Shallow chest-rise idle while alive.
      s.npc.position.y = 0.10 + Math.abs(Math.sin(performance.now() * 0.0015)) * 0.02;
      if (s.complete) return;
      const px = ctx.playerPos.x - s.disc.cx;
      const pz = ctx.playerPos.z - s.disc.cz;
      if (px * px + pz * pz < 36 && s.barkT <= 0) {
        s.barkT = 4.0 + Math.random() * 2;
        const def = ENCOUNTER_DEFS.wounded_soldier;
        const line = def.pleas[s.nextBark % def.pleas.length];
        s.nextBark++;
        ctx.spawnSpeech(s.npc.position.clone().setY(2.2), line, 3.5);
      }
      s.barkT = Math.max(0, s.barkT - dt);
    },
    onItemDropped(item, ctx) {
      const s = ctx.state;
      if (s.complete) return { consume: false };
      // Any heal-kind consumable counts (bandage, medkit, surgical kit).
      const isHeal = item && item.useEffect && item.useEffect.kind === 'heal';
      if (!isHeal) return { consume: false };
      s.complete = true;
      ctx.spawnSpeech(s.npc.position.clone().setY(2.2),
        'You... saved me. Take this — it is yours.', 4.5);
      // Spawn a rare-tier gear piece next to him.
      const reward = ctx.rollRareGear && ctx.rollRareGear();
      if (reward) ctx.spawnLoot(s.disc.cx + 1.2, s.disc.cz, reward);
      // Collapse dead after a beat.
      setTimeout(() => {
        if (!s.npc) return;
        s.dead = true;
        s.npc.rotation.x = -1.45;
        s.npc.position.y = 0.05;
      }, 1500);
      return { consume: true, complete: true };
    },
  },

  // -----------------------------------------------------------------
  // Broken Vendor — sitting next to a smashed cart. Re-enterable
  // until the player drops a junk piece worth >100c, at which point
  // he stands up and gifts a low-tier weapon.
  broken_vendor: {
    id: 'broken_vendor',
    name: 'Broken Vendor',
    floorColor: 0xa88a5a,             // dusty tan
    oncePerSave: true,
    condition: (state) => state.levelIndex >= 1,
    woes: [
      'Thieves. They took everything. Even my coin.',
      'My cart... fifteen years on the road, gone.',
      'I have nothing left to trade. Pity an old vendor.',
      'A trinket. Anything of value. I beg you.',
    ],
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      const cart = _buildSmashedCart();
      cart.position.set(disc.cx + 1.0, 0, disc.cz);
      scene.add(cart);
      const npc = _buildSimpleNpc({
        bodyColor: 0x5a4a3a, headColor: 0xc8a880,
        accentColor: 0x8a6a3c, height: 1.65,
      });
      // Sitting cross-legged — scaled down + lowered.
      npc.scale.set(1, 0.55, 1);
      npc.position.set(disc.cx - 0.6, 0, disc.cz);
      scene.add(npc);
      const label = _makeLabelSprite('BROKEN VENDOR', '#d8b88a');
      label.position.set(disc.cx, 1.8, disc.cz);
      scene.add(label);
      return {
        npc, label, disc, cart,
        barkT: 0,
        nextBark: 0,
        complete: false,
      };
    },
    tick(dt, ctx) {
      const s = ctx.state;
      if (!s.npc || s.complete) return;
      const px = ctx.playerPos.x - s.disc.cx;
      const pz = ctx.playerPos.z - s.disc.cz;
      if (px * px + pz * pz < 36 && s.barkT <= 0) {
        s.barkT = 4.5 + Math.random() * 2;
        const def = ENCOUNTER_DEFS.broken_vendor;
        const line = def.woes[s.nextBark % def.woes.length];
        s.nextBark++;
        ctx.spawnSpeech(s.npc.position.clone().setY(1.2), line, 3.5);
      }
      s.barkT = Math.max(0, s.barkT - dt);
    },
    onItemDropped(item, ctx) {
      const s = ctx.state;
      if (s.complete) return { consume: false };
      const ok = item && item.type === 'junk'
                 && typeof item.sellValue === 'number'
                 && item.sellValue > 100;
      if (!ok) return { consume: false };
      s.complete = true;
      // Stand him back up.
      s.npc.scale.set(1, 1, 1);
      ctx.spawnSpeech(s.npc.position.clone().setY(2.0),
        'Bless you, traveler. Take this — it served me well.', 4.5);
      const reward = ctx.rollLowTierWeapon && ctx.rollLowTierWeapon();
      if (reward) ctx.spawnLoot(s.disc.cx - 1.4, s.disc.cz, reward);
      return { consume: true, complete: true };
    },
  },

  // -----------------------------------------------------------------
  // Confession Booth — drop ANY weapon (ranged or melee, equipped
  // OR backpack) and the booth absorbs it; a random unowned
  // relic appears in its place. One-shot per save.
  confession_booth: {
    id: 'confession_booth',
    name: 'Confession Booth',
    floorColor: 0xe6c060,             // ecclesiastical gold
    oncePerSave: true,
    condition: (state) => state.levelIndex >= 2,
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      const booth = _buildConfessionBooth();
      booth.position.set(disc.cx, 0, disc.cz);
      scene.add(booth);
      const label = _makeLabelSprite('CONFESSION BOOTH', '#f0d488');
      label.position.set(disc.cx, 3.2, disc.cz);
      scene.add(label);
      return { booth, label, disc, complete: false };
    },
    tick(dt, ctx) {
      // No idle barks — booth is silent. Could add a faint glow pulse
      // on the cross above the curtain, but skipping for perf.
    },
    onItemDropped(item, ctx) {
      const s = ctx.state;
      if (s.complete) return { consume: false };
      const isWeapon = item && (item.type === 'ranged' || item.type === 'melee');
      if (!isWeapon) return { consume: false };
      s.complete = true;
      ctx.spawnSpeech(s.booth.position.clone().setY(2.6),
        '...your offering is heard.', 4.0);
      // Roll an unowned artifact; if everything's owned bail without
      // marking complete so the player gets their weapon back.
      const relic = ctx.rollUnownedRelic && ctx.rollUnownedRelic();
      if (!relic) {
        s.complete = false;
        return { consume: false };
      }
      ctx.spawnLoot(s.disc.cx, s.disc.cz + 1.0, relic);
      // Hide the hint sprite — completed.
      if (s.hint) s.hint.visible = false;
      return { consume: true, complete: true };
    },
  },

  // -----------------------------------------------------------------
  // Skull Pile — cairn of skulls. Need 25+ kills across the run.
  // If the threshold's already met when the room is generated the
  // cairn shows up pre-collapsed with the epic weapon already on
  // the floor; otherwise it stands intact and barks a warning.
  skull_pile: {
    id: 'skull_pile',
    name: 'Skull Pile',
    floorColor: 0xeae0d0,             // bone white
    oncePerSave: true,
    condition: (state) => state.levelIndex >= 2,
    THRESHOLD: 25,
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      const cairn = _buildSkullCairn(11);
      cairn.position.set(disc.cx, 0, disc.cz);
      scene.add(cairn);
      const label = _makeLabelSprite('SKULL PILE', '#e8dfc8');
      label.position.set(disc.cx, 1.8, disc.cz);
      scene.add(label);
      // Already collapsed if the player has hit the kill threshold
      // on the run by the time they enter. Don't spawn the reward
      // yet — wait for first room entry so the player witnesses the
      // collapse animation.
      const killsAtGen = ctx.getKillCount ? ctx.getKillCount() : 0;
      const preCollapsed = killsAtGen >= this.THRESHOLD;
      return {
        cairn, label, disc,
        complete: false,
        preCollapsed,
        triggeredEntry: false,
        barkT: 0,
        nextBark: 0,
        wobbleT: 0,
        playerWasNear: false,
      };
    },
    tick(dt, ctx) {
      const s = ctx.state;
      if (!s.cairn) return;
      const px = ctx.playerPos.x - s.disc.cx;
      const pz = ctx.playerPos.z - s.disc.cz;
      const d2 = px * px + pz * pz;
      const near = d2 < 36;
      // First entry — fire the collapse if pre-collapsed, else bark
      // the warning line.
      if (near && !s.triggeredEntry) {
        s.triggeredEntry = true;
        if (s.preCollapsed) {
          // Collapse animation runs in tick (see below). Spawn the
          // reward immediately on the floor.
          ctx.spawnSpeech(s.cairn.position.clone().setY(1.5),
            'They... knew you were coming.', 4.0);
          const reward = ctx.rollEpicWeapon && ctx.rollEpicWeapon();
          if (reward) ctx.spawnLoot(s.disc.cx, s.disc.cz, reward);
          s.collapseT = 1.4;
          s.complete = true;
        } else {
          ctx.spawnSpeech(s.cairn.position.clone().setY(1.5),
            'You sense them watching.', 3.5);
        }
      }
      // Collapse animation — drop each skull with a wobble. While
      // collapsing the encounter must keep ticking; once the timer
      // hits zero the framework early-out can skip us.
      if (s.collapseT > 0) {
        s.collapseT = Math.max(0, s.collapseT - dt);
        s.needsTick = true;
        const k = 1 - (s.collapseT / 1.4);
        for (const child of s.cairn.children) {
          child.position.y = Math.max(0.10, child.position.y - dt * 1.6);
          child.rotation.z += dt * (Math.random() - 0.5) * 4;
        }
        if (s.collapseT <= 0) s.needsTick = false;
      }
      // Idle bark while alive + uncollapsed.
      if (!s.preCollapsed && !s.complete && near && s.barkT <= 0) {
        s.barkT = 6.0 + Math.random() * 3;
        const lines = [
          'You sense them watching.',
          'A breath of cold air. Behind you.',
          'The skulls shift, just a little.',
        ];
        ctx.spawnSpeech(s.cairn.position.clone().setY(1.5),
          lines[s.nextBark % lines.length], 3.5);
        s.nextBark++;
      }
      s.barkT = Math.max(0, s.barkT - dt);
      // While not pre-collapsed: every frame check kill count; once
      // it crosses the threshold AND the player is in the room,
      // trigger the collapse.
      if (!s.complete && !s.preCollapsed && near && ctx.getKillCount) {
        if (ctx.getKillCount() >= ENCOUNTER_DEFS.skull_pile.THRESHOLD) {
          ctx.spawnSpeech(s.cairn.position.clone().setY(1.5),
            'The cairn... it shifts. Something gives way.', 4.0);
          const reward = ctx.rollEpicWeapon && ctx.rollEpicWeapon();
          if (reward) ctx.spawnLoot(s.disc.cx, s.disc.cz, reward);
          s.collapseT = 1.4;
          s.complete = true;
          if (ctx.markEncounterComplete) ctx.markEncounterComplete('skull_pile');
        }
      }
      s.playerWasNear = near;
    },
    onItemDropped(item, ctx) {
      return { consume: false };     // not item-driven
    },
  },

  // -----------------------------------------------------------------
  // Glass Case — visible legendary inside a fragile glass box. Any
  // damage breaks the glass; the weapon drops to the floor and 4
  // elite gunmen spawn at the room corners after a brief telegraph
  // (puff of smoke). The case meshes are registered as hittables
  // so the player's bullet pipeline triggers it through the normal
  // raycast. Once broken, no take-backs.
  glass_case: {
    id: 'glass_case',
    name: 'Glass Case',
    floorColor: 0x70c8e0,             // cold cyan
    oncePerSave: true,
    condition: (state) => state.levelIndex >= 2,
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      // Roll the legendary weapon NOW so the inner glow tints to its
      // tracer color and the same item drops on break.
      const reward = ctx.rollLegendaryWeapon && ctx.rollLegendaryWeapon();
      const tint = reward?.tint ?? 0xffd060;
      const built = _buildGlassCase(tint);
      built.group.position.set(disc.cx, 0, disc.cz);
      scene.add(built.group);
      const label = _makeLabelSprite('GLASS CASE', '#a8e0f0');
      label.position.set(disc.cx, 2.7, disc.cz);
      scene.add(label);
      // Register glass meshes as hittable targets — the bullet
      // pipeline will hand them to the encounter via owner.manager.
      const target = {
        encounterId: 'glass_case',
        room, disc,
        broken: false,
      };
      const manager = {
        applyHit: (tgt, dmg) => {
          if (tgt.broken) return { drops: [], blocked: false };
          tgt.broken = true;
          // Fire the break sequence next encounter tick — the bullet
          // pipeline doesn't have ctx access.
          tgt._pendingBreak = true;
          return { drops: [], blocked: false };
        },
      };
      target.manager = manager;
      for (const mesh of built.glassRefs) {
        mesh.userData.zone = 'glass';
        mesh.userData.owner = target;
      }
      return {
        built, label, disc, reward,
        target,
        // Telegraph state machine: 'idle' → 'telegraph' (~0.8s of
        // smoke puffs) → 'spawn' (instantly drops in 4 elites) →
        // 'done'.
        phase: 'idle',
        telegraphT: 0,
        complete: false,
      };
    },
    tick(dt, ctx) {
      const s = ctx.state;
      if (!s.built) return;
      // Detect the break via target flag.
      if (s.target._pendingBreak && s.phase === 'idle') {
        s.target._pendingBreak = false;
        s.phase = 'telegraph';
        s.telegraphT = 0.8;
        // Drop the weapon onto the floor.
        if (s.reward) ctx.spawnLoot(s.disc.cx, s.disc.cz, s.reward);
        // Hide the glass walls + inner item — they "shatter".
        for (const mesh of s.built.glassRefs) mesh.visible = false;
        s.built.innerItem.visible = false;
        if (s.built.light) s.built.light.intensity = 0;
        // Puff smoke at the four room corners (where the elites will
        // appear).
        const b = s.disc; // disc carries cx/cz; use the room bounds
        if (ctx.spawnPuffAt && ctx.room && ctx.room.bounds) {
          const rb = ctx.room.bounds;
          const inset = 2.4;
          ctx.spawnPuffAt(rb.minX + inset, rb.minZ + inset);
          ctx.spawnPuffAt(rb.maxX - inset, rb.minZ + inset);
          ctx.spawnPuffAt(rb.minX + inset, rb.maxZ - inset);
          ctx.spawnPuffAt(rb.maxX - inset, rb.maxZ - inset);
        }
        ctx.spawnSpeech(new THREE.Vector3(s.disc.cx, 1.6, s.disc.cz), 'AMBUSH', 2.0);
      }
      if (s.phase === 'telegraph') {
        s.telegraphT = Math.max(0, s.telegraphT - dt);
        if (s.telegraphT <= 0) {
          s.phase = 'spawn';
          if (ctx.spawnEliteAt && ctx.room && ctx.room.bounds) {
            const rb = ctx.room.bounds;
            const inset = 2.4;
            ctx.spawnEliteAt(rb.minX + inset, rb.minZ + inset, ctx.room);
            ctx.spawnEliteAt(rb.maxX - inset, rb.minZ + inset, ctx.room);
            ctx.spawnEliteAt(rb.minX + inset, rb.maxZ - inset, ctx.room);
            ctx.spawnEliteAt(rb.maxX - inset, rb.maxZ - inset, ctx.room);
          }
          s.phase = 'done';
          s.complete = true;
          if (ctx.markEncounterComplete) ctx.markEncounterComplete('glass_case');
        }
      }
    },
    onItemDropped(item, ctx) {
      return { consume: false };     // glass case is shoot-to-trigger
    },
    // The encounter exposes hittable meshes so combat.raycast picks
    // them up. main.js folds these into allHittables() each frame.
    // Returns the same cached array reference whenever possible to
    // avoid building a new list per frame.
    hittables(state) {
      if (!state || !state.built) return EMPTY_ARR;
      if (state.target && state.target.broken) return EMPTY_ARR;
      return state.built.glassRefs;
    },
  },

  // -----------------------------------------------------------------
  // Fortune Teller — pay 500c for a single random buff that lasts
  // 15 minutes. One-shot per save (one purchase total across runs).
  fortune_teller: {
    id: 'fortune_teller',
    name: 'Fortune Teller',
    floorColor: 0xb050a8,             // deep magenta
    oncePerSave: true,
    condition: (state) => state.levelIndex >= 1,
    BUFF_OPTIONS: [
      { id: 'fortune_dmg',   text: '+25% damage',
        mods: { damageMult: 1.25 } },
      { id: 'fortune_speed', text: '+50% move speed',
        mods: { moveSpeedMult: 1.50 } },
      { id: 'fortune_loot',  text: '+30% loot drops (credits)',
        mods: { creditDropMult: 1.30 } },
      { id: 'fortune_reroll', text: '+1 free shop reroll (next visit)',
        special: 'reroll' },
    ],
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      // Robed figure NPC.
      const npc = _buildSimpleNpc({
        bodyColor: 0x6a2a8a, headColor: 0xc8a890,
        accentColor: 0xe0a850, height: 1.7,
      });
      npc.position.set(disc.cx, 0, disc.cz);
      scene.add(npc);
      // Small table prop in front of her.
      const tableMat = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.85 });
      const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 14), tableMat);
      tableTop.position.set(disc.cx, 0.7, disc.cz - 0.7);
      tableTop.castShadow = true;
      scene.add(tableTop);
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 14, 12),
        new THREE.MeshStandardMaterial({
          color: 0xc880ff, emissive: 0x8040c0, emissiveIntensity: 0.5,
          roughness: 0.2,
        }),
      );
      orb.position.set(disc.cx, 0.92, disc.cz - 0.7);
      scene.add(orb);
      const label = _makeLabelSprite('FORTUNE TELLER', '#e8a8e8');
      label.position.set(disc.cx, 2.4, disc.cz);
      scene.add(label);
      return { npc, label, orb, disc, complete: false, wobbleT: 0 };
    },
    tick(dt, ctx) {
      const s = ctx.state;
      if (!s.orb) return;
      s.wobbleT += dt;
      s.orb.position.y = 0.92 + Math.sin(s.wobbleT * 1.4) * 0.04;
      s.orb.rotation.y = s.wobbleT * 0.7;
    },
    interact(ctx) {
      const s = ctx.state;
      if (s.complete) {
        ctx.spawnSpeech(s.npc.position.clone().setY(2.0),
          'I have read your fate already.', 3.0);
        return;
      }
      const def = ENCOUNTER_DEFS.fortune_teller;
      const PRICE = 500;
      const credits = ctx.getPlayerCredits ? ctx.getPlayerCredits() : 0;
      const opts = def.BUFF_OPTIONS.map((b) => ({
        text: b.text,
        enabled: credits >= PRICE,
        onPick: () => {
          if (!ctx.spendPlayerCredits || !ctx.spendPlayerCredits(PRICE)) return;
          if (b.special === 'reroll') {
            if (ctx.grantPendingShopReroll) ctx.grantPendingShopReroll();
          } else {
            // 15 minutes = 900 seconds.
            ctx.grantBuff(b.id, b.mods, 900);
          }
          s.complete = true;
          if (ctx.markEncounterComplete) ctx.markEncounterComplete('fortune_teller');
          if (s.hint) s.hint.visible = false;
          ctx.spawnSpeech(s.npc.position.clone().setY(2.0),
            'It is done. Walk in fortune.', 3.5);
        },
      }));
      opts.push({ text: 'Leave', onPick: () => {} });
      ctx.showPrompt({
        title: 'Fortune Teller',
        body: credits < PRICE
          ? `Cost: 500c · You have ${credits}c.`
          : `Cost: 500c · Lasts 15 minutes.`,
        options: opts,
      });
    },
    onItemDropped(item, ctx) { return { consume: false }; },
  },

  // -----------------------------------------------------------------
  // The Shrine — three independent tier purchases, each one-shot
  // per save. The room re-appears until ALL three tiers have been
  // claimed across runs.
  shrine: {
    id: 'shrine',
    name: 'The Shrine',
    floorColor: 0xf0e6c0,             // warm temple cream
    // Custom oncePerSave handling: complete only when all 3 tiers claimed.
    oncePerSave: false,
    condition: (state) => {
      if (state.levelIndex < 1) return false;
      // Only show if at least one tier remains. main.js wires
      // ctx.getShrineTiers as a Set of purchased tier numbers.
      // Without ctx in condition, fall back to true and let interact
      // handle the "all sold out" case.
      return true;
    },
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      // Stone altar — small pedestal with a low brazier on top.
      const stoneMat = new THREE.MeshStandardMaterial({ color: 0x9a8a78, roughness: 0.85 });
      const trim = new THREE.MeshStandardMaterial({
        color: 0xe0c060, roughness: 0.4, metalness: 0.6,
        emissive: 0x6a4a10, emissiveIntensity: 0.3,
      });
      const altar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.9), stoneMat);
      altar.position.set(disc.cx, 0.45, disc.cz);
      altar.castShadow = true;
      scene.add(altar);
      const brazier = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.45, 0.18, 14),
        trim,
      );
      brazier.position.set(disc.cx, 0.99, disc.cz);
      scene.add(brazier);
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.20, 0.55, 8),
        new THREE.MeshBasicMaterial({
          color: 0xffc060, transparent: true, opacity: 0.85,
          depthWrite: false, blending: THREE.AdditiveBlending,
        }),
      );
      flame.position.set(disc.cx, 1.45, disc.cz);
      scene.add(flame);
      const label = _makeLabelSprite('THE SHRINE', '#f0d480');
      label.position.set(disc.cx, 2.4, disc.cz);
      scene.add(label);
      return { altar, brazier, flame, label, disc, wobbleT: 0 };
    },
    tick(dt, ctx) {
      const s = ctx.state;
      if (!s.flame) return;
      s.wobbleT += dt;
      s.flame.scale.y = 1 + Math.sin(s.wobbleT * 5) * 0.10;
      s.flame.material.opacity = 0.78 + Math.sin(s.wobbleT * 7) * 0.12;
    },
    interact(ctx) {
      const s = ctx.state;
      const tiers = ctx.getShrineTiers ? ctx.getShrineTiers() : new Set();
      const credits = ctx.getPlayerCredits ? ctx.getPlayerCredits() : 0;
      const tierDefs = [
        { tier: 1, price: 500,    text: '+5 max HP (rest of run)' },
        { tier: 2, price: 5000,   text: 'Random unowned artifact' },
        { tier: 3, price: 50000,  text: 'Guaranteed mythic weapon' },
      ];
      const opts = tierDefs.map((t) => {
        const owned = tiers.has(t.tier);
        return {
          text: owned ? `${t.text} — claimed`
                      : `${t.price}c · ${t.text}`,
          enabled: !owned && credits >= t.price,
          onPick: () => {
            if (owned) return;
            if (!ctx.spendPlayerCredits(t.price)) return;
            if (ctx.setShrineTier) ctx.setShrineTier(t.tier);
            if (t.tier === 1) {
              ctx.addShrineMaxHpBonus(5);
              ctx.spawnSpeech(s.altar.position.clone().setY(2.0),
                'Your vessel grows.', 3.5);
            } else if (t.tier === 2) {
              const relic = ctx.rollUnownedRelic && ctx.rollUnownedRelic();
              if (relic) {
                ctx.spawnLoot(s.disc.cx, s.disc.cz + 1.2, relic);
                ctx.spawnSpeech(s.altar.position.clone().setY(2.0),
                  'A boon for the bold.', 3.5);
              } else {
                ctx.spawnSpeech(s.altar.position.clone().setY(2.0),
                  'You hold them all already.', 3.5);
              }
            } else if (t.tier === 3) {
              const mythic = ctx.rollMythicWeapon && ctx.rollMythicWeapon();
              if (mythic) {
                ctx.spawnLoot(s.disc.cx, s.disc.cz + 1.2, mythic);
                ctx.spawnSpeech(s.altar.position.clone().setY(2.0),
                  'A blade fit for legend.', 3.5);
              }
            }
            // Re-open the prompt to show updated state, unless every
            // tier is now claimed.
            const next = ctx.getShrineTiers ? ctx.getShrineTiers() : new Set();
            if (next.size >= 3) {
              if (ctx.markEncounterComplete) ctx.markEncounterComplete('shrine');
              if (s.hint) s.hint.visible = false;
            } else {
              ENCOUNTER_DEFS.shrine.interact(ctx);
            }
          },
        };
      });
      opts.push({ text: 'Leave', onPick: () => {} });
      ctx.showPrompt({
        title: 'The Shrine',
        body: `Three offerings remain. You have ${credits}c.`,
        options: opts,
      });
    },
    onItemDropped(item, ctx) { return { consume: false }; },
  },

  // -----------------------------------------------------------------
  // Whispering Door — afk-listen for 25 seconds (no movement) and
  // the door whispers a way forward. Modal offers 3 skip tiers
  // (Small +1, Medium +3, Large +5). Picking one auto-extracts to
  // the new floor. Movement during the listen resets the timer
  // entirely. One-shot per save.
  whispering_door: {
    id: 'whispering_door',
    name: 'Whispering Door',
    floorColor: 0xb0d4e0,             // pale ghost-blue
    oncePerSave: true,
    condition: (state) => state.levelIndex >= 2,
    LISTEN_TIME: 20,
    MOVE_THRESHOLD: 0.20,             // metres of drift considered "movement"
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      const door = _buildWhisperingDoor();
      door.position.set(disc.cx, 0, disc.cz);
      scene.add(door);
      const label = _makeLabelSprite('WHISPERING DOOR', '#c8e0f0');
      label.position.set(disc.cx, 3.2, disc.cz);
      scene.add(label);
      // Progress sprite — text fills in when listening.
      const progress = _makeLabelSprite('', '#c8e0f0');
      progress.scale.set(3.6, 0.65, 1);
      progress.position.set(disc.cx, 1.0, disc.cz + 1.6);
      progress.visible = false;
      scene.add(progress);
      return {
        door, label, progress, disc,
        listenT: 0,
        lastX: null, lastZ: null,
        complete: false,
        prompted: false,
      };
    },
    tick(dt, ctx) {
      const s = ctx.state;
      if (!s.door || s.complete) return;
      const px = ctx.playerPos.x, pz = ctx.playerPos.z;
      const inRoom = ctx.room && ctx.room.bounds
        && px >= ctx.room.bounds.minX && px <= ctx.room.bounds.maxX
        && pz >= ctx.room.bounds.minZ && pz <= ctx.room.bounds.maxZ;
      if (!inRoom) {
        // Player left the room — reset progress.
        s.listenT = 0;
        s.lastX = null;
        s.lastZ = null;
        if (s.progress) s.progress.visible = false;
        s._lastSec = -1;        // invalidate cached label so re-entry re-renders
        return;
      }
      // First in-room frame this visit — calibrate baseline position.
      if (s.lastX === null) {
        s.lastX = px;
        s.lastZ = pz;
      }
      const dx = px - s.lastX, dz = pz - s.lastZ;
      const drift = Math.hypot(dx, dz);
      const def = ENCOUNTER_DEFS.whispering_door;
      if (drift > def.MOVE_THRESHOLD) {
        // Movement detected — full reset.
        s.listenT = 0;
        s.lastX = px;
        s.lastZ = pz;
      } else {
        s.listenT += dt;
      }
      // Update progress sprite — only when the displayed second
      // changes. Previously redrew the canvas + reuploaded the
      // texture every frame the player was standing still (60×/sec
      // for 25s straight = 1500 redundant uploads).
      if (s.progress) {
        s.progress.visible = true;
        const pct = Math.min(1, s.listenT / def.LISTEN_TIME);
        const sec = Math.max(0, Math.ceil(def.LISTEN_TIME - s.listenT));
        const tag = pct >= 1 ? -1 : sec;     // -1 sentinel for the "PRESS E" state
        if (tag !== s._lastSec) {
          s._lastSec = tag;
          s.progress.userData.setText(
            pct >= 1 ? 'PRESS E TO CHOOSE A PATH'
                     : `Listening... ${sec}s`,
          );
        }
      }
      if (s.listenT >= def.LISTEN_TIME && !s.prompted) {
        // Auto-prompt only the first frame past the threshold; the
        // player can re-trigger the prompt by pressing E afterward.
        s.prompted = true;
      }
    },
    interact(ctx) {
      const s = ctx.state;
      if (s.complete) return;
      const def = ENCOUNTER_DEFS.whispering_door;
      if (s.listenT < def.LISTEN_TIME) {
        ctx.spawnSpeech(s.door.position.clone().setY(2.6),
          'You hear nothing. Yet.', 3.0);
        return;
      }
      const tiers = [
        { skip: 1, text: 'Small Skip · +1 floor' },
        { skip: 3, text: 'Medium Skip · +3 floors' },
        { skip: 5, text: 'Large Skip · +5 floors' },
      ];
      const opts = tiers.map((t) => ({
        text: t.text,
        enabled: true,
        onPick: () => {
          s.complete = true;
          if (ctx.markEncounterComplete) ctx.markEncounterComplete('whispering_door');
          if (ctx.advanceLevels) ctx.advanceLevels(t.skip);
        },
      }));
      opts.push({ text: 'Step away', onPick: () => {} });
      ctx.showPrompt({
        title: 'Whispering Door',
        body: 'The door whispers a way forward. Choose your skip.',
        options: opts,
      });
    },
    onItemDropped(item, ctx) { return { consume: false }; },
  },

  // -----------------------------------------------------------------
  // Fountain — press E next to it to throw 100c. Once cumulative
  // throws hit 1000c, a chest containing a King's Signet pops out
  // beside the basin. One-shot per save.
  fountain: {
    id: 'fountain',
    name: 'Fountain',
    floorColor: 0x60c0d0,             // cool aqua
    oncePerSave: true,
    condition: (state) => state.levelIndex >= 2,
    THRESHOLD: 1000,
    PER_THROW: 100,
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      const built = _buildFountain();
      built.group.position.set(disc.cx, 0, disc.cz);
      scene.add(built.group);
      const label = _makeLabelSprite('FOUNTAIN', '#a0e0f0');
      label.position.set(disc.cx, 2.6, disc.cz);
      scene.add(label);
      const progress = _makeLabelSprite('', '#a0e0f0');
      progress.scale.set(3.6, 0.65, 1);
      progress.position.set(disc.cx, 1.0, disc.cz + 1.8);
      progress.visible = false;
      scene.add(progress);
      return {
        built, label, progress, disc,
        thrown: 0,
        complete: false,
        wobbleT: 0,
      };
    },
    tick(dt, ctx) {
      const s = ctx.state;
      if (!s.built) return;
      s.wobbleT += dt;
      if (s.built.stream) {
        s.built.stream.scale.y = 1 + Math.sin(s.wobbleT * 6) * 0.15;
      }
    },
    interact(ctx) {
      const s = ctx.state;
      if (s.complete) {
        ctx.spawnSpeech(new THREE.Vector3(s.disc.cx, 1.8, s.disc.cz),
          'The fountain has given what it will.', 3.0);
        return;
      }
      const def = ENCOUNTER_DEFS.fountain;
      const credits = ctx.getPlayerCredits ? ctx.getPlayerCredits() : 0;
      if (credits < def.PER_THROW) {
        ctx.spawnSpeech(new THREE.Vector3(s.disc.cx, 1.8, s.disc.cz),
          `Not enough coin. Need ${def.PER_THROW}c.`, 3.0);
        return;
      }
      if (!ctx.spendPlayerCredits(def.PER_THROW)) return;
      s.thrown += def.PER_THROW;
      if (s.progress) {
        s.progress.visible = true;
        s.progress.userData.setText(`${s.thrown} / ${def.THRESHOLD}c offered`);
      }
      // Tiny audio + visual: spawn a coin-splash speech bubble.
      ctx.spawnSpeech(new THREE.Vector3(s.disc.cx, 1.8, s.disc.cz),
        '*splash*', 1.4);
      // Threshold reached — spawn the chest immediately.
      if (s.thrown >= def.THRESHOLD) {
        s.complete = true;
        if (ctx.markEncounterComplete) ctx.markEncounterComplete('fountain');
        if (s.hint) s.hint.visible = false;
        if (s.progress) s.progress.userData.setText('The fountain accepts your offering.');
        // Spawn a single-item chest holding the King's Signet.
        if (ctx.spawnSignetChest) {
          // Push the chest further out (was 1.8m, fountain mesh
          // bounds extend ~1.5m so the player couldn't get within
          // 1.8m of the chest center without bumping the fountain).
          ctx.spawnSignetChest(s.disc.cx + 3.6, s.disc.cz);
        }
        ctx.spawnSpeech(new THREE.Vector3(s.disc.cx, 2.4, s.disc.cz),
          'A glint stirs in the depths.', 4.0);
      }
    },
    onItemDropped(item, ctx) { return { consume: false }; },
  },

  // -----------------------------------------------------------------
  // The Mirror — standing in front of the mirror for 10 seconds
  // spawns a clone of the player with their exact equipped loadout.
  // Killing the clone drops a guaranteed mastercraft of the
  // player's current weapon. One-shot per save.
  mirror: {
    id: 'mirror',
    name: 'The Mirror',
    floorColor: 0xc8d0d8,             // silver
    oncePerSave: true,
    condition: (state) => state.levelIndex >= 2,
    GAZE_TIME: 6,
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      // Mirror prop — tall ornate frame + reflective slab.
      const group = new THREE.Group();
      const frameMat = new THREE.MeshStandardMaterial({
        color: 0xc8a868, roughness: 0.4, metalness: 0.7,
        emissive: 0x402a10, emissiveIntensity: 0.25,
      });
      const glassMat = new THREE.MeshStandardMaterial({
        color: 0xe8f0f8, roughness: 0.05, metalness: 1.0,
        emissive: 0x405068, emissiveIntensity: 0.20,
      });
      const left = new THREE.Mesh(new THREE.BoxGeometry(0.10, 2.6, 0.18), frameMat);
      left.position.set(-0.65, 1.30, 0); group.add(left);
      const right = left.clone(); right.position.set(0.65, 1.30, 0); group.add(right);
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.50, 0.18, 0.18), frameMat);
      top.position.set(0, 2.55, 0); group.add(top);
      const bot = top.clone(); bot.position.set(0, 0.10, 0); group.add(bot);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(1.20, 2.30, 0.06), glassMat);
      glass.position.set(0, 1.30, 0.02);
      glass.castShadow = true;
      group.add(glass);
      group.position.set(disc.cx, 0, disc.cz);
      scene.add(group);
      const label = _makeLabelSprite('THE MIRROR', '#d8e0e8');
      label.position.set(disc.cx, 3.2, disc.cz);
      scene.add(label);
      const progress = _makeLabelSprite('', '#d8e0e8');
      progress.scale.set(3.6, 0.65, 1);
      progress.position.set(disc.cx, 1.0, disc.cz + 1.6);
      progress.visible = false;
      scene.add(progress);
      return {
        group, glass, label, progress, disc,
        gazeT: 0,
        cloneSpawned: false,
        clone: null,
        complete: false,
        lastX: null, lastZ: null,
      };
    },
    tick(dt, ctx) {
      const s = ctx.state;
      if (!s.group || s.complete) return;
      const px = ctx.playerPos.x, pz = ctx.playerPos.z;
      const inRoom = ctx.room && ctx.room.bounds
        && px >= ctx.room.bounds.minX && px <= ctx.room.bounds.maxX
        && pz >= ctx.room.bounds.minZ && pz <= ctx.room.bounds.maxZ;
      if (!s.cloneSpawned) {
        if (!inRoom) {
          s.gazeT = 0;
          s.lastX = null; s.lastZ = null;
          if (s.progress) s.progress.visible = false;
          s._lastSec = -1;     // invalidate cached label so re-entry re-renders
          return;
        }
        if (s.lastX === null) { s.lastX = px; s.lastZ = pz; }
        const drift = Math.hypot(px - s.lastX, pz - s.lastZ);
        const def = ENCOUNTER_DEFS.mirror;
        if (drift > 0.20) {
          s.gazeT = 0;
          s.lastX = px; s.lastZ = pz;
        } else {
          s.gazeT += dt;
        }
        if (s.progress) {
          s.progress.visible = true;
          // Only redraw the canvas + reupload the texture when the
          // displayed second actually changes. The setText path was
          // re-rendering 60×/sec while standing still — visible cost
          // on the GPU upload alone.
          const sec = Math.max(0, Math.ceil(def.GAZE_TIME - s.gazeT));
          if (sec !== s._lastSec) {
            s._lastSec = sec;
            s.progress.userData.setText(s.gazeT >= def.GAZE_TIME
              ? '...something stirs in the glass'
              : `Gazing... ${sec}s`);
          }
        }
        if (s.gazeT >= def.GAZE_TIME) {
          s.cloneSpawned = true;
          // Spawn clone in front of the mirror.
          const cloneX = s.disc.cx;
          const cloneZ = s.disc.cz + 1.4;
          s.clone = ctx.spawnMirrorClone && ctx.spawnMirrorClone(cloneX, cloneZ, ctx.room);
          ctx.spawnSpeech(new THREE.Vector3(s.disc.cx, 2.2, s.disc.cz),
            'Look upon yourself.', 4.0);
          if (s.hint) s.hint.visible = false;
          if (s.progress) s.progress.userData.setText('Defeat your reflection.');
          // Defensive: if the clone failed to spawn (e.g. the player
          // had no equipped weapon at the moment of the gaze trigger),
          // mark the encounter complete instead of leaving it stuck
          // waiting for a clone that will never die.
          if (!s.clone) {
            ctx.spawnSpeech(new THREE.Vector3(s.disc.cx, 2.2, s.disc.cz),
              'Nothing answers. The glass is silent.', 4.0);
            s.complete = true;
            if (ctx.markEncounterComplete) ctx.markEncounterComplete('mirror');
            if (s.progress) s.progress.visible = false;
          }
        }
      } else {
        // Clone spawned — wait for its kill.
        if (s.clone && !s.clone.alive) {
          s.complete = true;
          if (ctx.markEncounterComplete) ctx.markEncounterComplete('mirror');
          if (s.progress) s.progress.visible = false;
        }
      }
    },
    onItemDropped(item, ctx) { return { consume: false }; },
  },

  // -----------------------------------------------------------------
  // Sleeping Boss — non-aggro boss snoring on the floor + a chest
  // of sub-boss-tier loot in the corner. Walking past peacefully
  // (don't attack) lets the player grab the chest and leave.
  // Damaging the boss wakes him at 1.5× HP/dmg for a real fight.
  // Either branch is one-shot per save.
  sleeping_boss: {
    id: 'sleeping_boss',
    name: 'Sleeping Boss',
    floorColor: 0x4a5260,             // deep slate
    oncePerSave: true,
    condition: (state) => state.levelIndex >= 3,
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      // Big slumped figure in the centre.
      const npc = _buildSimpleNpc({
        bodyColor: 0x60404a, headColor: 0xc8a880,
        accentColor: 0x806040, height: 2.2,
      });
      // Lay him on his side — rotate 90° around X.
      npc.rotation.x = -Math.PI / 2;
      npc.position.set(disc.cx, 0.18, disc.cz);
      scene.add(npc);
      const label = _makeLabelSprite('SLEEPING BOSS', '#a0a8b0');
      label.position.set(disc.cx, 1.6, disc.cz);
      scene.add(label);
      // Sub-boss loot pile in a corner.
      const cb = ctx.room.bounds;
      const chestX = cb.minX + 2.4;
      const chestZ = cb.minZ + 2.4;
      const items = ctx.rollSubBossLootPile ? ctx.rollSubBossLootPile() : [];
      if (ctx.spawnEncounterChest) ctx.spawnEncounterChest(chestX, chestZ, items);
      // Hittable target — bullets / melee that hit the NPC mesh route
      // through this manager.applyHit, which flips the wake flag.
      // The encounter tick reads the flag next frame and replaces the
      // slumbering NPC with a real elite spawn.
      const wakeTarget = {
        alive: true, hp: 1, maxHp: 1, tier: 'subBoss',
        group: { position: { x: disc.cx, y: 1.0, z: disc.cz } },
        manager: {
          applyHit: (_owner, _dmg) => {
            wakeTarget._pendingWake = true;
            return { drops: [], blocked: false };
          },
        },
      };
      // Walk every mesh in the NPC group and tag it as a hittable
      // body. Zone tag stays 'torso' for the kill / hit FX pipeline.
      const hitMeshes = [];
      npc.traverse?.((obj) => {
        if (obj.isMesh) {
          obj.userData.zone = 'torso';
          obj.userData.owner = wakeTarget;
          hitMeshes.push(obj);
        }
      });
      return {
        npc, label, disc,
        wakeTarget, hitMeshes,
        woke: false,
        complete: false,
        snoreT: 0,
        wakeRadius: 2.5,    // running this close also wakes him
      };
    },
    tick(dt, ctx) {
      const s = ctx.state;
      if (!s.npc) return;
      // Snoring jitter while asleep.
      if (!s.woke) {
        s.snoreT += dt;
        s.npc.position.y = 0.18 + Math.abs(Math.sin(s.snoreT * 1.4)) * 0.04;
      }
      const px = ctx.playerPos.x, pz = ctx.playerPos.z;
      const inRoom = ctx.room && ctx.room.bounds
        && px >= ctx.room.bounds.minX && px <= ctx.room.bounds.maxX
        && pz >= ctx.room.bounds.minZ && pz <= ctx.room.bounds.maxZ;
      if (inRoom) s.everEntered = true;
      // Wake conditions — bullet/melee hit on the NPC, OR running
      // within the wake radius. Stealth-walking players keep the
      // peaceful path open.
      if (!s.woke) {
        const dx = px - s.disc.cx, dz = pz - s.disc.cz;
        const closeBy = (dx * dx + dz * dz) <= s.wakeRadius * s.wakeRadius;
        const playerSpeed = ctx.playerSpeed || 0;
        const isRunning = playerSpeed > 4.5;
        if (s.wakeTarget._pendingWake || (closeBy && isRunning)) {
          s.woke = true;
          s.wakeTarget._pendingWake = false;
          // Hide the slumbering NPC mesh + clear its hit-test owner
          // so subsequent shots route to the real spawned enemy.
          s.npc.visible = false;
          for (const m of s.hitMeshes) {
            m.userData.owner = null;
            m.userData.zone = null;
          }
          // Spawn the actual fight — sub-boss-tier gunman armed by
          // the standard pool, dropped at the slumber position.
          if (ctx.spawnEliteAt) ctx.spawnEliteAt(s.disc.cx, s.disc.cz, ctx.room);
          ctx.spawnSpeech(new THREE.Vector3(s.disc.cx, 2.4, s.disc.cz),
            'WHO DARES?!', 4.0);
          s.complete = true;
          if (ctx.markEncounterComplete) ctx.markEncounterComplete('sleeping_boss');
        }
      }
      // Peaceful exit — if the player leaves the room without ever
      // waking him, lock the encounter as a sneak success.
      if (!s.complete && s.everEntered && !inRoom && !s.woke) {
        s.complete = true;
        if (ctx.markEncounterComplete) ctx.markEncounterComplete('sleeping_boss');
      }
    },
    onItemDropped(_item, _ctx) { return { consume: false }; },
    hittables(state) {
      if (!state || !state.hitMeshes || state.woke) return EMPTY_ARR;
      return state.hitMeshes;
    },
  },

  // -----------------------------------------------------------------
  // Choices and Consequences — gunman + kneeling man standoff. Damage
  // either to lock that choice; the other becomes invulnerable +
  // delivers their line. Reward depends on who you killed:
  //   gunman dies      → kneeler gives you 5000c
  //   kneeler dies     → gunman drops a random legendary weapon
  // Leave the room and return: both bodies on the ground + the
  // Indecision relic spawns in the centre. Re-enterable until pickup
  // (item-drop check on Indecision marks the encounter complete).
  choices_and_consequences: {
    id: 'choices_and_consequences',
    name: 'Choices and Consequences',
    floorColor: 0x707888,             // ambiguous grey-blue
    oncePerSave: true,
    condition: (state) => state.levelIndex >= 3,
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      // Spawn the standoff pair via main.js helper (uses dummies).
      const pair = ctx.spawnCnCPair && ctx.spawnCnCPair(disc.cx, disc.cz, ctx.room);
      const label = _makeLabelSprite('CHOICES AND CONSEQUENCES', '#c0c8d8');
      label.position.set(disc.cx, 2.8, disc.cz);
      scene.add(label);
      return {
        pair, label, disc,
        phase: 'standoff',          // 'standoff' → 'aftermath' → 'returned'
        chosenDead: null,
        chosenSurvivor: null,
        leftRoomAfterChoice: false,
        relicSpawned: false,
        complete: false,
        barkT: 0,
        nextBark: 0,
      };
    },
    tick(dt, ctx) {
      const s = ctx.state;
      if (!s.pair) return;
      const px = ctx.playerPos.x, pz = ctx.playerPos.z;
      const inRoom = ctx.room && ctx.room.bounds
        && px >= ctx.room.bounds.minX && px <= ctx.room.bounds.maxX
        && pz >= ctx.room.bounds.minZ && pz <= ctx.room.bounds.maxZ;

      if (s.phase === 'standoff') {
        // Bark dialog when player is close. Skip if the speaker is
        // already dead (otherwise corpses keep arguing for a frame
        // or two between the kill and the phase advance below).
        const dx = px - s.disc.cx, dz = pz - s.disc.cz;
        if (dx * dx + dz * dz < 36 && s.barkT <= 0) {
          s.barkT = 4.0 + Math.random() * 2;
          const lines = [
            { who: 'gunman',  text: 'Stay back. This is between us.' },
            { who: 'kneeler', text: 'It was an accident! I swear it!' },
            { who: 'gunman',  text: 'You took everything from me.' },
            { who: 'kneeler', text: 'Please. I have a family.' },
          ];
          const line = lines[s.nextBark % lines.length];
          s.nextBark++;
          const target = (line.who === 'gunman') ? s.pair.gunman : s.pair.kneeler;
          if (target && target.group && target.alive) {
            ctx.spawnSpeech(target.group.position.clone().setY(2.0), line.text, 3.5);
          }
        }
        s.barkT = Math.max(0, s.barkT - dt);
        // Detect first kill.
        const gAlive = s.pair.gunman && s.pair.gunman.alive;
        const kAlive = s.pair.kneeler && s.pair.kneeler.alive;
        if (!gAlive && kAlive) {
          // Player shot the gunman first.
          s.phase = 'aftermath';
          s.chosenDead = 'gunman';
          s.chosenSurvivor = s.pair.kneeler;
          // Kneeler invulnerable + reward.
          if (s.pair.kneeler) {
            s.pair.kneeler.hp = 99999;
            s.pair.kneeler.maxHp = 99999;
          }
          ctx.spawnSpeech(s.pair.kneeler.group.position.clone().setY(2.0),
            'Bless you. Take this — every coin I have.', 4.5);
          if (ctx.awardPlayerCredits) ctx.awardPlayerCredits(5000);
          if (s.hint) s.hint.userData.setText('Leave the room and return...');
        } else if (gAlive && !kAlive) {
          // Player shot the kneeling man first.
          s.phase = 'aftermath';
          s.chosenDead = 'kneeler';
          s.chosenSurvivor = s.pair.gunman;
          if (s.pair.gunman) {
            s.pair.gunman.hp = 99999;
            s.pair.gunman.maxHp = 99999;
          }
          ctx.spawnSpeech(s.pair.gunman.group.position.clone().setY(2.0),
            'It is finished. I won\'t need this anymore.', 4.5);
          // Drop a random legendary weapon.
          const legendary = ctx.rollLegendaryWeapon && ctx.rollLegendaryWeapon();
          if (legendary) ctx.spawnLoot(s.disc.cx + 0.6, s.disc.cz, legendary);
          if (s.hint) s.hint.userData.setText('Leave the room and return...');
        } else if (!gAlive && !kAlive) {
          // Both fell to a single volley — gunman died first by
          // narrative convention. Treat as gunman-first kill.
          s.phase = 'aftermath';
          s.chosenDead = 'gunman';
          s.chosenSurvivor = null;
          if (ctx.awardPlayerCredits) ctx.awardPlayerCredits(5000);
          if (s.hint) s.hint.userData.setText('You spared neither. The room is silent.');
        }
      }

      if (s.phase === 'aftermath') {
        if (!inRoom) s.leftRoomAfterChoice = true;
        if (s.leftRoomAfterChoice && inRoom && !s.relicSpawned) {
          // Player returned. Spawn the Indecision relic in the centre
          // and tear down the surviving NPC (now a corpse pose).
          s.relicSpawned = true;
          if (s.chosenSurvivor && s.chosenSurvivor.group) {
            // Lay them down via a quick rotate.
            s.chosenSurvivor.group.rotation.x = -Math.PI / 2;
            s.chosenSurvivor.alive = false;
          }
          if (s.hint) s.hint.visible = false;
          ctx.spawnSpeech(new THREE.Vector3(s.disc.cx, 2.2, s.disc.cz),
            'Indecision lies between them.', 4.0);
          const relic = ctx.relicFor && ctx.relicFor('indecision');
          if (relic) ctx.spawnLoot(s.disc.cx, s.disc.cz, relic);
          s.phase = 'returned';
          s.complete = true;
          // Terminal phase — framework early-out skips ticking from
          // this frame onward.
          s.needsTick = false;
          if (ctx.markEncounterComplete) ctx.markEncounterComplete('choices_and_consequences');
        }
      }
    },
    onItemDropped(item, ctx) { return { consume: false }; },
  },

  // -----------------------------------------------------------------
  // Circle of Candles — drop ANY item in the centre to transform it.
  //   non-legendary  → legendary version (5% chance also mastercraft)
  //   legendary      → random non-Jessica's-Rage mythic
  //   Jessica's Rage → spawns The Gift (one-shot lock)
  // Re-enterable per item exchange until the Jessica's Rage → Gift
  // conversion fires.
  circle_of_candles: {
    id: 'circle_of_candles',
    name: 'Circle of Candles',
    floorColor: 0xa060d0,             // violet ritual
    oncePerSave: false,               // re-enterable; locks on Gift conversion
    condition: (state) => state.levelIndex >= 3,
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      // Ring of 8 candles around the centre.
      const group = new THREE.Group();
      const waxMat = new THREE.MeshStandardMaterial({ color: 0xeae0c8, roughness: 0.7 });
      const flameMat = new THREE.MeshBasicMaterial({
        color: 0xffc060, transparent: true, opacity: 0.85,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const flames = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = 1.6;
        const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.45, 8), waxMat);
        candle.position.set(Math.cos(a) * r, 0.225, Math.sin(a) * r);
        candle.castShadow = true;
        group.add(candle);
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 6), flameMat);
        flame.position.set(Math.cos(a) * r, 0.55, Math.sin(a) * r);
        group.add(flame);
        flames.push(flame);
      }
      group.position.set(disc.cx, 0, disc.cz);
      scene.add(group);
      const label = _makeLabelSprite('CIRCLE OF CANDLES', '#d8a0f0');
      label.position.set(disc.cx, 2.4, disc.cz);
      scene.add(label);
      return {
        group, flames, label, disc,
        wobbleT: 0,
        complete: false,
      };
    },
    tick(dt, ctx) {
      const s = ctx.state;
      if (!s.flames) return;
      s.wobbleT += dt;
      for (let i = 0; i < s.flames.length; i++) {
        const f = s.flames[i];
        f.scale.y = 1 + Math.sin(s.wobbleT * 6 + i) * 0.15;
        f.material.opacity = 0.78 + Math.sin(s.wobbleT * 9 + i * 0.7) * 0.12;
      }
    },
    onItemDropped(item, ctx) {
      const s = ctx.state;
      if (s.complete) return { consume: false };
      if (!item) return { consume: false };
      // Jessica's Rage → The Gift (one-shot lock).
      if (item.name === "Jessica's Rage") {
        ctx.spawnSpeech(new THREE.Vector3(s.disc.cx, 1.8, s.disc.cz),
          'Something old answers.', 4.5);
        const gift = ctx.spawnTheGift && ctx.spawnTheGift(s.disc.cx, s.disc.cz);
        if (gift === false) return { consume: false };
        s.complete = true;
        if (ctx.markEncounterComplete) ctx.markEncounterComplete('circle_of_candles');
        if (s.hint) s.hint.userData.setText('The circle has spoken.');
        return { consume: true, complete: true };
      }
      // Legendary in → random non-Jessica's-Rage mythic. ONE conversion
      // per run total — completes the encounter so subsequent drops
      // don't re-trigger.
      if (item.rarity === 'legendary' && (item.type === 'ranged' || item.type === 'melee')) {
        const mythic = ctx.rollMythicWeapon && ctx.rollMythicWeapon();
        if (!mythic) return { consume: false };
        ctx.spawnSpeech(new THREE.Vector3(s.disc.cx, 1.8, s.disc.cz),
          'A greater shape emerges.', 4.0);
        ctx.spawnLoot(s.disc.cx, s.disc.cz + 0.6, mythic);
        s.complete = true;
        if (ctx.markEncounterComplete) ctx.markEncounterComplete('circle_of_candles');
        if (s.hint) s.hint.userData.setText('The circle has spoken.');
        return { consume: true, complete: true };
      }
      // Non-legendary → legendary version (5% mastercraft on top).
      // Only meaningful for items with a rarity ladder (weapons,
      // armor, gear, attachments, throwables). Junk + consumables
      // don't have rarity tiers worth bumping. Same one-per-run gate
      // as the legendary path above.
      const ladderTypes = new Set(['ranged', 'melee', 'armor', 'gear', 'attachment', 'throwable']);
      if (ladderTypes.has(item.type) && item.rarity !== 'mythic') {
        const out = JSON.parse(JSON.stringify(item));
        out.rarity = 'legendary';
        if (Math.random() < 0.05) out.mastercraft = true;
        ctx.spawnSpeech(new THREE.Vector3(s.disc.cx, 1.8, s.disc.cz),
          'The flames purify.', 4.0);
        ctx.spawnLoot(s.disc.cx, s.disc.cz + 0.6, out);
        s.complete = true;
        if (ctx.markEncounterComplete) ctx.markEncounterComplete('circle_of_candles');
        if (s.hint) s.hint.userData.setText('The circle has spoken.');
        return { consume: true, complete: true };
      }
      // Anything else (junk, consumable, etc.): refuse loudly so the
      // player gets clear feedback that the item was rejected and
      // didn't disappear into the candles.
      ctx.spawnSpeech(new THREE.Vector3(s.disc.cx, 1.8, s.disc.cz),
        'The flames reject it.', 3.0);
      return { consume: false };
    },
  },

  // -----------------------------------------------------------------
  // The Button — small console with a single red button. Pressing it
  // rolls a 1-in-3 outcome:
  //   1) Nothing happens
  //   2) Alarm — summons necromant-style minions from the room corners
  //      every few seconds, capped at 10 alive at a time, until the
  //      player extracts (encounter dies with the level on regen).
  //   3) Spawns 3 random containers near the console.
  // One-shot per save — the press is a commitment, can't re-roll later.
  the_button: {
    id: 'the_button',
    name: 'The Button',
    floorColor: 0x802020,                   // ominous red
    oncePerSave: true,
    condition: (state) => state.levelIndex >= 1,
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      // Console — a low metal box with a sloped top so the button reads
      // as "press me" from across the room.
      const consoleMat = new THREE.MeshStandardMaterial({
        color: 0x2a2e36, roughness: 0.7, metalness: 0.4,
      });
      const consoleGroup = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.8), consoleMat);
      base.position.y = 0.4;
      base.castShadow = true;
      consoleGroup.add(base);
      const slope = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.05, 0.8),
        new THREE.MeshStandardMaterial({ color: 0x1a1d23, roughness: 0.6 }),
      );
      slope.position.y = 0.82;
      slope.rotation.x = -0.18;
      consoleGroup.add(slope);
      // Big red dome button — emissive so it reads "powered on".
      const button = new THREE.Mesh(
        new THREE.SphereGeometry(0.20, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({
          color: 0xc62020, emissive: 0x802020, emissiveIntensity: 0.9,
          roughness: 0.4, metalness: 0.2,
        }),
      );
      button.position.set(0, 0.92, 0.04);
      consoleGroup.add(button);
      // Subtle pulsing red light over the button.
      const light = new THREE.PointLight(0xff4040, 0.8, 4);
      light.position.set(0, 1.4, 0);
      consoleGroup.add(light);
      consoleGroup.position.set(disc.cx, 0, disc.cz);
      scene.add(consoleGroup);
      const label = _makeLabelSprite('THE BUTTON', '#ff8080');
      label.position.set(disc.cx, 2.4, disc.cz);
      scene.add(label);
      return {
        consoleGroup, button, light, label, disc,
        // Per-frame state.
        wobbleT: 0,
        outcome: null,             // null | 'nothing' | 'alarm' | 'chests'
        complete: false,
        // Alarm bookkeeping — cap at 10 alive minions, respawn every
        // ~3.5s while alive count is below the cap. Indices stored so
        // we can prune dead and refill.
        alarmT: 0,
        alarmInterval: 3.5,
        alarmCap: 10,
        alarmMinions: [],
      };
    },
    tick(dt, ctx) {
      const s = ctx.state;
      if (!s.button) return;
      s.wobbleT += dt;
      // Idle pulse on the button so it reads as live.
      const pulse = 0.7 + 0.3 * Math.sin(s.wobbleT * 3.5);
      s.button.material.emissiveIntensity = 0.5 + 0.5 * pulse;
      s.light.intensity = 0.4 + 0.6 * pulse;
      // Alarm tick — runs forever once triggered. Encounter cleans up
      // naturally on level regen (the room + its _encounter ref are
      // discarded with the old level).
      if (s.outcome !== 'alarm') return;
      // Prune dead minions so the cap reflects live count.
      s.alarmMinions = s.alarmMinions.filter(m => m && m.alive);
      s.alarmT -= dt;
      if (s.alarmT > 0) return;
      s.alarmT = s.alarmInterval;
      if (s.alarmMinions.length >= s.alarmCap) return;
      if (!ctx.spawnSummonedMinion || !ctx.room) return;
      // Pick a random room corner (insetted), retry until we find one
      // not blocked by props/walls.
      const b = ctx.room.bounds;
      const corners = [
        [b.minX + 1.5, b.minZ + 1.5],
        [b.maxX - 1.5, b.minZ + 1.5],
        [b.minX + 1.5, b.maxZ - 1.5],
        [b.maxX - 1.5, b.maxZ - 1.5],
      ];
      // Shuffle so spawn doesn't always favour the same corner.
      for (let i = corners.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [corners[i], corners[j]] = [corners[j], corners[i]];
      }
      for (const [cx, cz] of corners) {
        if (ctx.level && ctx.level._collidesAt && ctx.level._collidesAt(cx, cz, 0.5)) continue;
        const m = ctx.spawnSummonedMinion(cx, cz, ctx.room);
        if (m) s.alarmMinions.push(m);
        return;
      }
    },
    interact(ctx) {
      const s = ctx.state;
      if (s.complete) return;
      const opts = [
        {
          text: 'PUSH THE BUTTON',
          enabled: true,
          onPick: () => {
            s.complete = true;
            // 1-in-3 outcome.
            const r = Math.random();
            const outcome = r < 1 / 3 ? 'nothing'
                          : r < 2 / 3 ? 'alarm'
                          :             'chests';
            s.outcome = outcome;
            // Power down the hint label so the prompt doesn't re-arm.
            if (s.hint) s.hint.visible = false;
            if (ctx.markEncounterComplete) ctx.markEncounterComplete('the_button');
            const speakAt = new THREE.Vector3(s.disc.cx, 1.6, s.disc.cz);
            if (outcome === 'nothing') {
              ctx.spawnSpeech(speakAt, 'A faint click. Nothing else.', 3.5);
            } else if (outcome === 'alarm') {
              // Visual: shift the disc + light to a deeper red and
              // start the alarm pulse. Minions will spawn from the
              // tick() block on the alarmInterval cadence.
              s.disc.disc.material.color.setHex(0xff2020);
              s.light.color.setHex(0xff2020);
              ctx.spawnSpeech(speakAt, 'ALARM. INTRUDERS DETECTED.', 4.5);
              s.alarmT = 0.5;     // first wave fast so the threat reads
            } else {
              // Three random containers in a small arc in front of
              // the console. Step around slightly so they don't
              // overlap each other.
              const offsets = [
                [-1.6,  1.6],
                [ 0.0,  2.0],
                [ 1.6,  1.6],
              ];
              let placed = 0;
              for (const [dx, dz] of offsets) {
                const cx = s.disc.cx + dx;
                const cz = s.disc.cz + dz;
                // Skip the spot if walls/props are in the way.
                if (ctx.level && ctx.level._collidesAt && ctx.level._collidesAt(cx, cz, 0.6)) continue;
                if (ctx.spawnRandomContainerAt) {
                  ctx.spawnRandomContainerAt(cx, cz);
                  placed += 1;
                }
              }
              ctx.spawnSpeech(speakAt,
                placed > 0 ? 'Compartments unsealed.' : 'A heavy clunk. Nothing visible.', 3.5);
            }
          },
        },
        { text: 'Walk away', onPick: () => {} },
      ];
      ctx.showPrompt({
        title: 'The Button',
        body: 'A single red button. No labels, no warnings.',
        options: opts,
      });
    },
    onItemDropped(_item, _ctx) { return { consume: false }; },
  },

  // -----------------------------------------------------------------
  // They Do Exist — three tiny gabled houses on a soft mossy disc.
  // Each house is roughly half a player tall. Drop "Fancy Alcohol"
  // or "Yummy Biscuits" on the disc and the elves slide an Elven
  // Knife (encounter-only legendary throwable) under the door. The
  // hint label is the Iceland tip — the trade itself is discovery.
  they_do_exist: {
    id: 'they_do_exist',
    name: 'They Do Exist',
    floorColor: 0x6cb070,             // mossy green
    oncePerSave: true,
    condition: (state) => state.levelIndex >= 2,
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      // Three small houses arranged in a shallow arc around the disc
      // centre. Each house is a stack: low boxy body + steeply pitched
      // gable roof + a tiny dark door. Half-player scale (~0.9m tall).
      const houseGroup = new THREE.Group();
      const wallMat = new THREE.MeshStandardMaterial({ color: 0xc8a070, roughness: 0.85 });
      const roofMat = new THREE.MeshStandardMaterial({ color: 0x6a3020, roughness: 0.7 });
      const doorMat = new THREE.MeshStandardMaterial({ color: 0x3a2010, roughness: 0.6 });
      const winMat  = new THREE.MeshBasicMaterial({ color: 0xffe8a0, transparent: true, opacity: 0.9 });
      const buildHouse = (offsetX, offsetZ, faceAng) => {
        const h = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.55), wallMat);
        body.position.y = 0.225;
        body.castShadow = true;
        h.add(body);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.40, 4), roofMat);
        roof.position.y = 0.65;
        roof.rotation.y = Math.PI / 4;       // square-base cone reads as gable
        h.add(roof);
        const door = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.22, 0.04), doorMat);
        door.position.set(0, 0.13, 0.29);
        h.add(door);
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.10, 0.02), winMat);
        win.position.set(0.16, 0.30, 0.28);
        h.add(win);
        h.position.set(offsetX, 0, offsetZ);
        h.rotation.y = faceAng;
        return h;
      };
      houseGroup.add(buildHouse(-0.85, 0.20,  0.35));
      houseGroup.add(buildHouse( 0.00, 0.55,  0.00));
      houseGroup.add(buildHouse( 0.85, 0.20, -0.35));
      houseGroup.position.set(disc.cx, 0, disc.cz);
      scene.add(houseGroup);
      const label = _makeLabelSprite('SETTLEMENT', '#c8e8c0');
      label.position.set(disc.cx, 1.8, disc.cz);
      scene.add(label);
      // Iceland hint — the user explicitly asked for this line.
      const hint = _makeLabelSprite('these little houses look like they\'re from Iceland', '#a8c8a0');
      hint.scale.set(4.6, 0.65, 1);
      hint.position.set(disc.cx, 0.55, disc.cz + 1.8);
      scene.add(hint);
      return { houseGroup, label, hint, disc, complete: false };
    },
    tick(_dt, _ctx) { /* purely decorative; no per-frame state */ },
    onItemDropped(item, ctx) {
      const s = ctx.state;
      if (s.complete) return { consume: false };
      const isOffering = item && (
        item.id === 'junk_fancy_alcohol' || item.name === 'Fancy Alcohol'
        || item.id === 'junk_yummy_biscuits' || item.name === 'Yummy Biscuits'
      );
      if (!isOffering) return { consume: false };
      s.complete = true;
      ctx.spawnSpeech(new THREE.Vector3(s.disc.cx, 1.6, s.disc.cz),
        'A small thank-you slides under a door.', 4.5);
      if (ctx.spawnElvenKnife) ctx.spawnElvenKnife(s.disc.cx, s.disc.cz + 1.4);
      if (ctx.markEncounterComplete) ctx.markEncounterComplete('they_do_exist');
      return { consume: true, complete: true };
    },
  },

  // -----------------------------------------------------------------
  // Wishing Well — toss any throwable into the well, get Tim's Bag
  // (−50% throwable cooldown). Detection scans active projectiles
  // each tick for one within 0.7m XZ of the well. One-shot per save.
  wishing_well: {
    id: 'wishing_well',
    name: 'The Wishing Well',
    floorColor: 0x4ab8c0,
    oncePerSave: true,
    condition: (state) => state.levelIndex >= 1,
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      const wellGroup = new THREE.Group();
      const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6a6e75, roughness: 0.85 });
      const waterMat = new THREE.MeshBasicMaterial({ color: 0x103848, transparent: true, opacity: 0.85 });
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 0.75, 0.8, 22, 1, true),
        stoneMat,
      );
      ring.position.y = 0.4;
      wellGroup.add(ring);
      const rim = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.78, 22), stoneMat);
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = 0.81;
      wellGroup.add(rim);
      const water = new THREE.Mesh(new THREE.CircleGeometry(0.55, 22), waterMat);
      water.rotation.x = -Math.PI / 2;
      water.position.y = 0.05;
      wellGroup.add(water);
      wellGroup.position.set(disc.cx, 0, disc.cz);
      scene.add(wellGroup);
      const label = _makeLabelSprite('THE WISHING WELL', '#a8e0e8');
      label.position.set(disc.cx, 2.2, disc.cz);
      scene.add(label);
      return { wellGroup, label, disc, complete: false };
    },
    tick(_dt, ctx) {
      const s = ctx.state;
      if (s.complete || !ctx.getProjectiles) return;
      const list = ctx.getProjectiles();
      if (!list || !list.length) return;
      const RADIUS = 0.7;
      for (const p of list) {
        if (p.dead || p.owner !== 'player') continue;
        const dx = p.pos.x - s.disc.cx;
        const dz = p.pos.z - s.disc.cz;
        if (dx * dx + dz * dz > RADIUS * RADIUS) continue;
        // Caught! Consume the projectile so it doesn't go off in the well.
        p.dead = true;
        if (p.body) ctx.scene.remove(p.body);
        if (p.trail) ctx.scene.remove(p.trail);
        s.complete = true;
        ctx.spawnSpeech(new THREE.Vector3(s.disc.cx, 1.4, s.disc.cz),
          'A coin-bright clatter answers from the dark.', 4.5);
        const relic = ctx.relicFor && ctx.relicFor('tims_bag');
        if (relic) ctx.spawnLoot(s.disc.cx, s.disc.cz + 1.4, relic);
        if (ctx.markEncounterComplete) ctx.markEncounterComplete('wishing_well');
        return;
      }
    },
    onItemDropped(_item, _ctx) { return { consume: false }; },
  },

  // -----------------------------------------------------------------
  // Target Practice — wooden dummy. 10 headshots in a row drops a
  // random weapon. Body shots reset. Repeatable across levels.
  target_practice: {
    id: 'target_practice',
    name: 'Target Practice',
    floorColor: 0x9a6a40,
    oncePerSave: false,
    condition: (state) => state.levelIndex >= 1,
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a5a30, roughness: 0.9 });
      const headMat = new THREE.MeshStandardMaterial({ color: 0x6a4020, roughness: 0.9 });
      const dummy = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.12, 1.6, 10), woodMat);
      post.position.y = 0.8;
      dummy.add(post);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.30), woodMat);
      body.position.y = 1.2;
      body.castShadow = true;
      dummy.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.20, 14, 10), headMat);
      head.position.y = 1.75;
      head.castShadow = true;
      dummy.add(head);
      dummy.position.set(disc.cx, 0, disc.cz);
      scene.add(dummy);
      const target = {
        alive: true, hp: 9999, maxHp: 9999, tier: 'normal',
        group: { position: { x: disc.cx, y: 1.2, z: disc.cz } },
        manager: {
          applyHit: (_owner, _dmg, zone) => {
            target._lastZone = zone;
            return { drops: [], blocked: false };
          },
        },
      };
      head.userData.zone = 'head';
      head.userData.owner = target;
      body.userData.zone = 'torso';
      body.userData.owner = target;
      const label = _makeLabelSprite('TARGET PRACTICE', '#e8c890');
      label.position.set(disc.cx, 2.6, disc.cz);
      scene.add(label);
      const streak = _makeLabelSprite('0 / 10', '#e8c890');
      streak.scale.set(2.4, 0.55, 1);
      streak.position.set(disc.cx, 2.2, disc.cz);
      scene.add(streak);
      return {
        dummy, head, body, target, label, streak, disc,
        hitMeshes: [head, body],
        streakCount: 0, complete: false,
      };
    },
    tick(_dt, ctx) {
      const s = ctx.state;
      if (!s.target || s.complete) return;
      const z = s.target._lastZone;
      if (!z) return;
      s.target._lastZone = null;
      if (z === 'head') s.streakCount += 1;
      else s.streakCount = 0;
      s.streak.userData.setText(`${s.streakCount} / 10`);
      if (s.streakCount >= 10) {
        s.complete = true;
        const wpn = ctx.rollRandomWeapon && ctx.rollRandomWeapon();
        if (wpn) ctx.spawnLoot(s.disc.cx, s.disc.cz + 1.4, wpn);
        ctx.spawnSpeech(new THREE.Vector3(s.disc.cx, 2.4, s.disc.cz),
          'NICE GROUPING.', 4.0);
        s.streak.userData.setText('CLEARED');
      }
    },
    onItemDropped(_item, _ctx) { return { consume: false }; },
    hittables(state) {
      if (!state || !state.hitMeshes) return EMPTY_ARR;
      return state.hitMeshes;
    },
  },

  // -----------------------------------------------------------------
  // Path of Fire — unlit brazier. Throw a Molotov INTO the bowl
  // (projectile lands within 0.6m XZ) → ignites + drops Undying
  // Embers. One-shot per save.
  path_of_fire: {
    id: 'path_of_fire',
    name: 'Path of Fire',
    floorColor: 0x802818,
    oncePerSave: true,
    condition: (state) => state.levelIndex >= 1,
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a4248, roughness: 0.9 });
      const ironMat = new THREE.MeshStandardMaterial({ color: 0x2a2628, roughness: 0.6, metalness: 0.5 });
      const brazier = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.18, 16), stoneMat);
      base.position.y = 0.09;
      brazier.add(base);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.12, 0.85, 10), ironMat);
      post.position.y = 0.6;
      brazier.add(post);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.50, 0.30, 0.30, 18), ironMat);
      bowl.position.y = 1.15;
      brazier.add(bowl);
      brazier.position.set(disc.cx, 0, disc.cz);
      scene.add(brazier);
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.30, 0.85, 10),
        new THREE.MeshBasicMaterial({
          color: 0xff8030, transparent: true, opacity: 0.9,
          depthWrite: false, blending: THREE.AdditiveBlending,
        }),
      );
      flame.position.set(disc.cx, 1.7, disc.cz);
      flame.visible = false;
      scene.add(flame);
      const flameLight = new THREE.PointLight(0xff7030, 0, 6);
      flameLight.position.set(disc.cx, 1.7, disc.cz);
      scene.add(flameLight);
      const label = _makeLabelSprite('PATH OF FIRE', '#ffa080');
      label.position.set(disc.cx, 2.6, disc.cz);
      scene.add(label);
      return { brazier, flame, flameLight, label, disc, lit: false, wobbleT: 0, complete: false };
    },
    tick(dt, ctx) {
      const s = ctx.state;
      if (!s.brazier) return;
      if (s.lit) {
        s.wobbleT += dt;
        s.flame.scale.y = 1 + Math.sin(s.wobbleT * 5) * 0.15;
        s.flame.material.opacity = 0.78 + Math.sin(s.wobbleT * 7) * 0.12;
      }
      if (s.complete || !ctx.getProjectiles) return;
      const list = ctx.getProjectiles();
      if (!list || !list.length) return;
      const RADIUS = 0.6;
      for (const p of list) {
        if (p.dead || p.owner !== 'player') continue;
        if (p.throwKind !== 'molotov') continue;
        const dx = p.pos.x - s.disc.cx;
        const dz = p.pos.z - s.disc.cz;
        if (dx * dx + dz * dz > RADIUS * RADIUS) continue;
        p.dead = true;
        if (p.body) ctx.scene.remove(p.body);
        if (p.trail) ctx.scene.remove(p.trail);
        s.lit = true;
        s.complete = true;
        s.flame.visible = true;
        s.flameLight.intensity = 2.2;
        ctx.spawnSpeech(new THREE.Vector3(s.disc.cx, 2.0, s.disc.cz),
          'The bowl drinks the fire.', 4.5);
        const relic = ctx.relicFor && ctx.relicFor('undying_embers');
        if (relic) ctx.spawnLoot(s.disc.cx, s.disc.cz + 1.6, relic);
        if (ctx.markEncounterComplete) ctx.markEncounterComplete('path_of_fire');
        return;
      }
    },
    onItemDropped(_item, _ctx) { return { consume: false }; },
  },

  // -----------------------------------------------------------------
  // The Tome — large open book on a pedestal. Press E to gain a
  // skill point. One-shot per save.
  the_tome: {
    id: 'the_tome',
    name: 'The Tome',
    floorColor: 0x40508a,
    oncePerSave: true,
    condition: (state) => state.levelIndex >= 1,
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a3018, roughness: 0.9 });
      const pageMat = new THREE.MeshStandardMaterial({ color: 0xe8d8a8, roughness: 0.85 });
      const coverMat = new THREE.MeshStandardMaterial({ color: 0x603030, roughness: 0.8, metalness: 0.1 });
      const group = new THREE.Group();
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.85, 16), woodMat);
      pedestal.position.y = 0.425;
      pedestal.castShadow = true;
      group.add(pedestal);
      const leftCover = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.05, 0.75), coverMat);
      leftCover.position.set(-0.28, 0.92, 0);
      leftCover.rotation.z = 0.10;
      group.add(leftCover);
      const rightCover = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.05, 0.75), coverMat);
      rightCover.position.set(0.28, 0.92, 0);
      rightCover.rotation.z = -0.10;
      group.add(rightCover);
      const pages = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.04, 0.70), pageMat);
      pages.position.y = 0.94;
      group.add(pages);
      const glow = new THREE.PointLight(0xffe0a0, 1.4, 4);
      glow.position.y = 1.3;
      group.add(glow);
      group.position.set(disc.cx, 0, disc.cz);
      scene.add(group);
      const label = _makeLabelSprite('THE TOME', '#c8b8ff');
      label.position.set(disc.cx, 2.4, disc.cz);
      scene.add(label);
      return { group, label, disc, complete: false };
    },
    tick(_dt, _ctx) { /* purely interactive */ },
    interact(ctx) {
      const s = ctx.state;
      if (s.complete) return;
      ctx.showPrompt({
        title: 'The Tome',
        body: 'The page in front of you turns on its own.',
        options: [
          { text: 'Read', enabled: true, onPick: () => {
              if (s.complete) return;
              s.complete = true;
              if (ctx.grantSkillPoint) ctx.grantSkillPoint(1);
              ctx.spawnSpeech(new THREE.Vector3(s.disc.cx, 2.0, s.disc.cz),
                '+1 SKILL POINT', 4.0);
              if (ctx.markEncounterComplete) ctx.markEncounterComplete('the_tome');
            } },
          { text: 'Walk away', onPick: () => {} },
        ],
      });
    },
    onItemDropped(_item, _ctx) { return { consume: false }; },
  },

  // -----------------------------------------------------------------
  // The Quiet Man — fedora-clad NPC stands silently in the centre.
  // Press E to demand answers (random player bark each press). After
  // 10s the man "explodes" cosmetically and the player gets 100c per
  // press. One-shot per save.
  quiet_man: {
    id: 'quiet_man',
    name: 'The Quiet Man',
    floorColor: 0x383844,
    oncePerSave: true,
    condition: (state) => state.levelIndex >= 1,
    BARKS: [
      'WHAT IS THAT?',
      'WHAT ARE YOU DOING?',
      'WHERE ARE YOU?',
      'I WANT TO KNOW RIGHT NOW!',
    ],
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      const npc = _buildSimpleNpc({
        bodyColor: 0xf0eadc, headColor: 0xc8a880,
        accentColor: 0x6a6a72, height: 1.85,
      });
      npc.position.set(disc.cx, 0, disc.cz);
      scene.add(npc);
      const hatMat = new THREE.MeshStandardMaterial({ color: 0x18181c, roughness: 0.7 });
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.18, 14), hatMat);
      crown.position.set(disc.cx, 1.78, disc.cz);
      scene.add(crown);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.30, 0.03, 18), hatMat);
      brim.position.set(disc.cx, 1.69, disc.cz);
      scene.add(brim);
      const label = _makeLabelSprite('THE QUIET MAN', '#c8c8d8');
      label.position.set(disc.cx, 2.4, disc.cz);
      scene.add(label);
      return {
        npc, crown, brim, label, disc,
        engaged: false, timer: 10, presses: 0, complete: false,
      };
    },
    tick(dt, ctx) {
      const s = ctx.state;
      if (!s.engaged || s.complete) return;
      s.timer -= dt;
      if (s.timer <= 0) {
        s.complete = true;
        if (ctx.spawnPuffAt) ctx.spawnPuffAt(s.disc.cx, s.disc.cz);
        if (s.npc) s.npc.visible = false;
        if (s.crown) s.crown.visible = false;
        if (s.brim) s.brim.visible = false;
        const earnings = s.presses * 100;
        if (earnings > 0 && ctx.awardPlayerCredits) {
          ctx.awardPlayerCredits(earnings);
        }
        ctx.spawnSpeech(new THREE.Vector3(s.disc.cx, 2.0, s.disc.cz),
          earnings > 0
            ? `The Quiet Man bursts. +${earnings}c found in the dust.`
            : 'The Quiet Man bursts. Nothing remains.',
          5.5);
        if (ctx.markEncounterComplete) ctx.markEncounterComplete('quiet_man');
      }
    },
    interact(ctx) {
      const s = ctx.state;
      if (s.complete) return;
      s.engaged = true;
      s.presses += 1;
      const def = ENCOUNTER_DEFS.quiet_man;
      const line = def.BARKS[Math.floor(Math.random() * def.BARKS.length)];
      ctx.spawnSpeech(new THREE.Vector3(ctx.playerPos.x, 2.0, ctx.playerPos.z),
        line, 1.8);
    },
    onItemDropped(_item, _ctx) { return { consume: false }; },
  },

  // -----------------------------------------------------------------
  // Sleepy Beauty — A girl asleep in the centre of the room. The only
  // thing that wakes her is the smell of cheesecake; drop one (the
  // cons_cheesecake consumable) anywhere in the room and she stirs,
  // then drops a random reward as a thank-you. Walking past, shooting,
  // or any other interaction does nothing.
  // -----------------------------------------------------------------
  sleepy_beauty: {
    id: 'sleepy_beauty',
    name: 'Sleepy Beauty',
    floorColor: 0xf2c8d8,             // soft pink dais
    oncePerSave: true,
    condition: (state) => state.levelIndex >= 2,
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      // Lay her on her side on the disc.
      const npc = _buildSimpleNpc({
        bodyColor: 0xb060a0, headColor: 0xe8c8a8,
        accentColor: 0xf0a0c0, height: 1.7,
      });
      npc.rotation.x = -Math.PI / 2;
      npc.position.set(disc.cx, 0.20, disc.cz);
      scene.add(npc);
      const label = _makeLabelSprite('SLEEPY BEAUTY', '#f0c8d8');
      label.position.set(disc.cx, 1.6, disc.cz);
      scene.add(label);
      return {
        npc, label, disc,
        snoreT: Math.random() * Math.PI * 2,
        awake: false,
        complete: false,
      };
    },
    tick(dt, ctx) {
      const s = ctx.state;
      if (!s.npc || s.awake) return;
      // Gentle breathing while asleep — same trick as sleeping_boss.
      s.snoreT += dt;
      s.npc.position.y = 0.20 + Math.abs(Math.sin(s.snoreT * 1.1)) * 0.03;
    },
    onItemDropped(item, ctx) {
      const s = ctx.state;
      if (s.complete || !item) return { consume: false };
      // Two valid wake triggers — cheesecake (the canonical one) or
      // the Demon Bear toy (she falls for him on sight). Anything
      // else bounces to the floor as normal loot.
      const isCheesecake = item.id === 'cons_cheesecake';
      const isDemonBear  = item.id === 'toy_demon_bear';
      if (!isCheesecake && !isDemonBear) return { consume: false };
      s.awake = true;
      s.complete = true;
      // Sit her upright as the wake-up animation.
      s.npc.rotation.x = 0;
      s.npc.position.y = 0;
      let reward = null;
      if (isDemonBear) {
        // Demon Bear path — she's smitten. Always drops a random
        // toy, never the bear itself (randomToy filters _encounter
        // items so the demon bear can't dupe).
        ctx.spawnSpeech(s.npc.position.clone().setY(2.0),
          'I love him!!!', 5.0);
        reward = ctx.rollRandomToy && ctx.rollRandomToy();
      } else {
        // Cheesecake path — random reward from the standard mix.
        ctx.spawnSpeech(s.npc.position.clone().setY(2.0),
          'Mmm... cheesecake! Take this — I owe you one.', 5.0);
        const rolls = [
          () => ctx.rollEpicWeapon && ctx.rollEpicWeapon(),
          () => ctx.rollLowTierWeapon && ctx.rollLowTierWeapon(),
          () => ctx.rollRareGear && ctx.rollRareGear(),
          () => ctx.rollRandomToy && ctx.rollRandomToy(),
        ];
        const pickReward = rolls[Math.floor(Math.random() * rolls.length)];
        reward = pickReward && pickReward();
      }
      if (reward) ctx.spawnLoot(s.disc.cx + 1.0, s.disc.cz, reward);
      if (ctx.markEncounterComplete) ctx.markEncounterComplete('sleepy_beauty');
      return { consume: true, complete: true };
    },
  },

  // -----------------------------------------------------------------
  // Hoop Dreams — basketball net + backboard at one end of the room,
  // a glowing "shoot here" disc at the opposite edge. Player must
  // stand on the disc and lob TWO frag grenades through the rim.
  // Two scores → airhorn, screen flooded with MVP! speech bubbles
  // for ~3s, +2 persistent chips. Repeatable across runs (mythic
  // achievement that always feels good to revisit).
  // -----------------------------------------------------------------
  hoop_dreams: {
    id: 'hoop_dreams',
    name: 'Hoop Dreams',
    floorColor: 0xb05030,             // hardwood orange
    oncePerSave: false,
    condition: (state) => state.levelIndex >= 1,
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      const cb = ctx.room.bounds;
      // Backboard / rim against the +Z wall, "stand here" disc at the
      // -Z edge — gives the player a clear cross-room throw lane.
      const hoopX = (cb.minX + cb.maxX) / 2;
      const hoopZ = cb.maxZ - 0.3;
      const hoopY = 1.55;             // grenade-arcable height
      const standX = hoopX;
      const standZ = cb.minZ + 1.4;
      // Backboard — flat slab.
      const backboard = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 1.0, 0.06),
        new THREE.MeshStandardMaterial({ color: 0xeeeeee }),
      );
      backboard.position.set(hoopX, hoopY + 0.5, hoopZ + 0.04);
      scene.add(backboard);
      // Rim — orange torus. Inner radius ~0.40, tube 0.04.
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.40, 0.04, 8, 24),
        new THREE.MeshStandardMaterial({ color: 0xff7020 }),
      );
      rim.rotation.x = Math.PI / 2;   // lay flat (axis vertical)
      rim.position.set(hoopX, hoopY, hoopZ - 0.40);
      scene.add(rim);
      // Net — short tapered cone of dim mesh.
      const net = new THREE.Mesh(
        new THREE.ConeGeometry(0.40, 0.45, 12, 1, true),
        new THREE.MeshStandardMaterial({
          color: 0xeeeeee, transparent: true, opacity: 0.55,
          wireframe: true,
        }),
      );
      net.position.set(hoopX, hoopY - 0.22, hoopZ - 0.40);
      net.rotation.x = Math.PI;       // tip down
      scene.add(net);
      // Stand-here disc — small glowing pad, gold tint.
      const standGeom = new THREE.CircleGeometry(0.55, 24);
      standGeom.rotateX(-Math.PI / 2);
      const standDisc = new THREE.Mesh(
        standGeom,
        new THREE.MeshBasicMaterial({ color: 0xf0c850, transparent: true, opacity: 0.55 }),
      );
      standDisc.position.set(standX, 0.02, standZ);
      scene.add(standDisc);
      const label = _makeLabelSprite('HOOP DREAMS — STAND ON THE DOT', '#f0c850');
      label.position.set(disc.cx, 2.4, disc.cz);
      scene.add(label);
      return {
        disc, label, backboard, rim, net, standDisc,
        hoop: { x: hoopX, y: hoopY, z: hoopZ - 0.40, r: 0.40 },
        stand: { x: standX, z: standZ, r: 0.95 },
        prevY: new WeakMap(),         // projectile → y last frame
        counted: new WeakSet(),       // projectile already scored
        score: 0,
        celebrated: false,
        complete: false,
        celebrateT: 0,
        bubbleTimer: 0,
      };
    },
    tick(dt, ctx) {
      const s = ctx.state;
      if (!s.rim) return;
      // Subtle pulse on the stand disc so it reads as interactive.
      const pulse = 0.45 + 0.20 * Math.sin((performance.now() % 100000) * 0.005);
      if (s.standDisc.material) s.standDisc.material.opacity = pulse;
      // Detection: iterate active grenades. Score when a player-owned
      // frag projectile crosses the rim plane (Y went from above to
      // below hoop.y) AND the XZ position is inside the rim radius.
      // Player must ALSO be on the stand disc — "shoot from the line".
      const px = ctx.playerPos.x, pz = ctx.playerPos.z;
      const dxs = px - s.stand.x, dzs = pz - s.stand.z;
      const onStand = (dxs * dxs + dzs * dzs) <= (s.stand.r * s.stand.r);
      const projs = ctx.activeProjectiles ? ctx.activeProjectiles() : [];
      for (const p of projs) {
        if (!p || !p.body || p.dead) continue;
        if (p.owner !== 'player' || p.throwKind !== 'frag') continue;
        if (s.counted.has(p)) continue;
        const y = p.body.position.y;
        const prevY = s.prevY.get(p);
        s.prevY.set(p, y);
        if (prevY === undefined) continue;
        // Crossed downward through the rim plane this frame?
        if (prevY > s.hoop.y && y <= s.hoop.y) {
          const dx = p.body.position.x - s.hoop.x;
          const dz = p.body.position.z - s.hoop.z;
          if ((dx * dx + dz * dz) <= s.hoop.r * s.hoop.r) {
            // Score gating — must be on the stand disc to count.
            if (!onStand) {
              ctx.spawnSpeech(new THREE.Vector3(s.hoop.x, s.hoop.y + 0.6, s.hoop.z),
                'STAND ON THE DOT!', 2.0);
              s.counted.add(p);
              continue;
            }
            s.counted.add(p);
            s.score += 1;
            ctx.spawnSpeech(new THREE.Vector3(s.hoop.x, s.hoop.y + 0.6, s.hoop.z),
              s.score === 1 ? 'SWISH!' : 'AND ONE!', 2.0);
          }
        }
      }
      // Win condition — 2 of 2 → celebration.
      if (s.score >= 2 && !s.celebrated) {
        s.celebrated = true;
        if (ctx.airhorn) ctx.airhorn();
        if (ctx.awardChips) ctx.awardChips(2);
        s.celebrateT = 3.0;
        s.bubbleTimer = 0;
        if (ctx.markEncounterComplete) ctx.markEncounterComplete('hoop_dreams');
      }
      // Celebration — spam ~250 MVP! bubbles over the celebrateT
      // window, scattered in the room's airspace. Throttled per
      // frame to avoid stalling on bubble alloc.
      if (s.celebrateT > 0) {
        s.celebrateT -= dt;
        s.bubbleTimer -= dt;
        if (s.bubbleTimer <= 0) {
          // ~50 bubbles/sec — fast enough to feel like a flood, slow
          // enough that the 24-slot bubble pool isn't churning
          // setTimeout/clearTimeout pairs every frame.
          s.bubbleTimer = 0.080;
          const cb = ctx.room?.bounds;
          if (cb) {
            const spawn = ctx.spawnSpeechRaw || ctx.spawnSpeech;
            for (let i = 0; i < 4; i++) {
              const rx = cb.minX + Math.random() * (cb.maxX - cb.minX);
              const rz = cb.minZ + Math.random() * (cb.maxZ - cb.minZ);
              const ry = 1.0 + Math.random() * 3.0;
              spawn(new THREE.Vector3(rx, ry, rz), 'MVP!', 1.2);
            }
          }
        }
        if (s.celebrateT <= 0) s.complete = true;
      }
    },
    onItemDropped(_item, _ctx) { return { consume: false }; },
  },

  // -----------------------------------------------------------------
  // Travel Buddy — small white bear standing in the centre wearing
  // a tiny backpack. Drop the Unused Rocket Ticket (junk_rocket_ticket)
  // and he hands you the Small Magical Pack — a mythic 50-slot
  // backpack that taxes your move speed by 25%. One-shot per save.
  // -----------------------------------------------------------------
  travel_buddy: {
    id: 'travel_buddy',
    name: 'Travel Buddy',
    floorColor: 0xc0d8e0,             // pale ice-blue dais
    oncePerSave: true,
    condition: (state) => state.levelIndex >= 2,
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      // Build a small white bear inline — two stacked spheres, ear
      // dots, and a felt backpack mounted on its back so the iso
      // camera reads the silhouette as "bear with a pack".
      const bear = new THREE.Group();
      const furMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.85 });
      const noseMat = new THREE.MeshStandardMaterial({ color: 0x202020, roughness: 0.5 });
      const packMat = new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.7 });
      const strapMat = new THREE.MeshStandardMaterial({ color: 0x402a18, roughness: 0.6 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), furMat);
      body.position.y = 0.42;
      body.castShadow = true;
      bear.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), furMat);
      head.position.set(0, 0.95, 0.18);
      head.castShadow = true;
      bear.add(head);
      // Ears.
      for (const xs of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.10, 8, 6), furMat);
        ear.position.set(0.20 * xs, 1.16, 0.10);
        bear.add(ear);
      }
      // Snout + nose.
      const snout = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), furMat);
      snout.position.set(0, 0.86, 0.40);
      bear.add(snout);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), noseMat);
      nose.position.set(0, 0.92, 0.50);
      bear.add(nose);
      // Backpack — box on the bear's back (-Z side) with two strap
      // cylinders running over the shoulders.
      const pack = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.55, 0.22), packMat);
      pack.position.set(0, 0.55, -0.40);
      pack.castShadow = true;
      bear.add(pack);
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.04), packMat);
      flap.position.set(0, 0.78, -0.50);
      bear.add(flap);
      for (const xs of [-1, 1]) {
        const strap = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.025, 0.55, 6),
          strapMat,
        );
        strap.position.set(0.18 * xs, 0.55, -0.10);
        strap.rotation.x = -0.45;
        bear.add(strap);
      }
      bear.position.set(disc.cx, 0, disc.cz);
      // Rotate so the iso camera (looking from +X+Z) catches the
      // backpack edge — bear faces roughly toward the camera, pack
      // hangs visibly off the +X-back side.
      bear.rotation.y = -Math.PI * 0.25;
      scene.add(bear);
      const label = _makeLabelSprite('TRAVEL BUDDY', '#cce0e8');
      label.position.set(disc.cx, 1.7, disc.cz);
      scene.add(label);
      return { bear, label, disc, complete: false };
    },
    tick(_dt, _ctx) { /* purely reactive */ },
    onItemDropped(item, ctx) {
      const s = ctx.state;
      if (s.complete || !item) return { consume: false };
      if (item.id !== 'junk_rocket_ticket') return { consume: false };
      s.complete = true;
      ctx.spawnSpeech(s.bear.position.clone().setY(2.0),
        'Take this — it\'ll fit more than it should.', 5.0);
      // Spawn the Small Magical Pack as a fresh inventory item.
      // Resolved through ctx so encounters.js doesn't import inventory
      // directly; main.js exposes the def on the ctx factory.
      const pack = ctx.makeMagicalPack && ctx.makeMagicalPack();
      if (pack) ctx.spawnLoot(s.disc.cx + 0.8, s.disc.cz, pack);
      if (ctx.markEncounterComplete) ctx.markEncounterComplete('travel_buddy');
      return { consume: true, complete: true };
    },
  },

  // -----------------------------------------------------------------
  // The Crow — small black bird perched on a stone. Drop any backpack
  // and he hops, caws, and trades you a strictly-larger non-magical
  // bag (small → med → large). If you already have the largest
  // non-magical bag (or somehow drop the magical one), he refuses
  // and your bag bounces to the floor as normal loot.
  // -----------------------------------------------------------------
  // -----------------------------------------------------------------
  // The Lamp — golden lamp on a pedestal. E to interact summons three
  // chests in a small arc: two masterwork, one cursed. The cursed
  // chest is visually distinct (darker, bloody tint) so the player
  // CAN tell after a peek — but the choice of which to open first
  // is theirs. Once-per-run; opening the cursed chest grants the
  // Brass Prisoner relic, which the Curse Breaker encounter can
  // later lift for a fee.
  // -----------------------------------------------------------------
  the_lamp: {
    id: 'the_lamp',
    name: 'The Lamp',
    floorColor: 0xc89048,             // warm pedestal disc
    oncePerSave: true,
    condition: (state) => state.levelIndex >= 1,
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      const group = new THREE.Group();
      // Stone pedestal — short cylinder with a thin trim band.
      const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a4042, roughness: 0.85 });
      const trimMat  = new THREE.MeshStandardMaterial({
        color: 0x9a7430, roughness: 0.45, metalness: 0.6,
      });
      const pedestal = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.50, 0.85, 14),
        stoneMat,
      );
      pedestal.position.y = 0.425;
      pedestal.castShadow = true;
      group.add(pedestal);
      const trim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.44, 0.44, 0.06, 14),
        trimMat,
      );
      trim.position.y = 0.82;
      group.add(trim);
      // Lamp — fat squashed sphere body + short conical spout + a
      // half-disc handle on the back. Emissive so it reads as warm
      // gold under the iso lights.
      const lampMat = new THREE.MeshStandardMaterial({
        color: 0xffd070, roughness: 0.30, metalness: 0.85,
        emissive: 0xa06020, emissiveIntensity: 0.55,
      });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 12), lampMat);
      body.scale.set(1.25, 0.65, 0.85);
      body.position.y = 1.02;
      body.castShadow = true;
      group.add(body);
      const lid = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.10, 10), lampMat);
      lid.position.y = 1.18;
      group.add(lid);
      // Spout — long narrow cone tilted forward.
      const spout = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.30, 10), lampMat);
      spout.position.set(0.28, 1.05, 0.05);
      spout.rotation.z = -Math.PI / 2.2;
      group.add(spout);
      // Handle — torus arc on the back.
      const handle = new THREE.Mesh(
        new THREE.TorusGeometry(0.12, 0.03, 8, 14, Math.PI),
        lampMat,
      );
      handle.position.set(-0.20, 1.04, 0);
      handle.rotation.set(Math.PI / 2, Math.PI / 2, 0);
      group.add(handle);
      // Soft glow point light — gold cast on the pedestal stone.
      const glow = new THREE.PointLight(0xffc060, 0.85, 4.5);
      glow.position.set(0, 1.1, 0);
      group.add(glow);
      group.position.set(disc.cx, 0, disc.cz);
      group.rotation.y = -Math.PI * 0.18;
      scene.add(group);
      const label = _makeLabelSprite('THE LAMP', '#f0c080');
      label.position.set(disc.cx, 1.9, disc.cz);
      scene.add(label);
      return { group, label, disc, complete: false, lampBodyMat: lampMat, glow };
    },
    tick(dt, ctx) {
      // Subtle emissive pulse so the lamp looks alive even before the
      // player triggers it. Stops once the encounter completes — chests
      // are the focal point afterward.
      const s = ctx.state;
      if (s.complete) return;
      s._t = (s._t || 0) + dt;
      if (s.lampBodyMat) {
        s.lampBodyMat.emissiveIntensity = 0.45 + 0.15 * Math.sin(s._t * 2.0);
      }
      if (s.glow) {
        s.glow.intensity = 0.75 + 0.25 * Math.sin(s._t * 2.0);
      }
    },
    interact(ctx) {
      const s = ctx.state;
      if (s.complete) return;
      ctx.showPrompt({
        title: 'The Lamp',
        body: 'A small golden lamp sits on a pedestal. Three chests, three offerings. Two are gifts. One is a debt. Will you rub the lamp?',
        options: [
          {
            text: 'Rub the lamp',
            onPick: () => {
              s.complete = true;
              if (s.glow) s.glow.intensity = 0;
              if (s.lampBodyMat) s.lampBodyMat.emissiveIntensity = 0.2;
              const speakAt = new THREE.Vector3(s.disc.cx, 1.9, s.disc.cz);
              ctx.spawnSpeech(speakAt, 'Three chests rise from the dust.', 4.0);
              // Three chests in a shallow arc in front of the pedestal.
              // Cursed chest position is randomised so the player can't
              // memorise "the middle one is the trap."
              const offsets = [
                [-1.8,  1.6],
                [ 0.0,  2.0],
                [ 1.8,  1.6],
              ];
              const cursedIdx = Math.floor(Math.random() * 3);
              for (let i = 0; i < offsets.length; i++) {
                const [dx, dz] = offsets[i];
                const cx = s.disc.cx + dx;
                const cz = s.disc.cz + dz;
                if (ctx.level && ctx.level._collidesAt && ctx.level._collidesAt(cx, cz, 0.6)) continue;
                if (i === cursedIdx) {
                  if (ctx.spawnCursedChest) ctx.spawnCursedChest(cx, cz, 'brass_prisoner');
                } else {
                  if (ctx.spawnMasterworkChest) ctx.spawnMasterworkChest(cx, cz);
                }
              }
              if (ctx.markEncounterComplete) ctx.markEncounterComplete('the_lamp');
            },
          },
          { text: 'Walk away', onPick: () => {} },
        ],
      });
    },
    onItemDropped(_item, _ctx) { return { consume: false }; },
  },

  // -----------------------------------------------------------------
  // Curse Breaker — old gypsy in a colourful shawl. Only spawns when
  // the player has at least one curse relic (currently just Brass
  // Prisoner). Pay 8000c to break the curse — relic is stripped from
  // the owned set, recomputeStats fires, the next shot doesn't drain
  // the magazine. Recurring (NOT oncePerSave) — every curse needs a
  // fresh visit, and the Lamp only grants one per run anyway.
  // -----------------------------------------------------------------
  curse_breaker: {
    id: 'curse_breaker',
    name: 'Curse Breaker',
    floorColor: 0x6a3060,             // mystic violet dais
    oncePerSave: false,
    condition: (state) => !!(state.artifacts && state.artifacts.has('brass_prisoner')),
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      const npc = new THREE.Group();
      const shawlMat = new THREE.MeshStandardMaterial({ color: 0x6a2030, roughness: 0.85 });
      const trimMat  = new THREE.MeshStandardMaterial({
        color: 0xc8a040, roughness: 0.5, metalness: 0.4,
      });
      const skinMat = new THREE.MeshStandardMaterial({ color: 0xa07050, roughness: 0.7 });
      const headMat = new THREE.MeshStandardMaterial({ color: 0x7a3a52, roughness: 0.85 });
      // Layered shawl — wider at base, narrower up top so the
      // silhouette reads as a draped figure.
      const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.65, 1.4, 14, 1, true), shawlMat);
      skirt.position.y = 0.7;
      skirt.castShadow = true;
      npc.add(skirt);
      // Gold trim band around the hem.
      const hem = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.04, 6, 18), trimMat);
      hem.position.y = 0.05;
      hem.rotation.x = Math.PI / 2;
      npc.add(hem);
      const upper = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 10), shawlMat);
      upper.scale.set(1.0, 0.85, 0.9);
      upper.position.y = 1.45;
      npc.add(upper);
      // Headscarf + face.
      const scarf = new THREE.Mesh(new THREE.SphereGeometry(0.25, 14, 10), headMat);
      scarf.position.y = 1.85;
      scarf.castShadow = true;
      npc.add(scarf);
      const face = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10), skinMat);
      face.position.set(0, 1.84, 0.10);
      npc.add(face);
      // Crystal ball she's holding — small glowing sphere in front of chest.
      const ballMat = new THREE.MeshStandardMaterial({
        color: 0x80c0e8, roughness: 0.2, metalness: 0.1,
        emissive: 0x4080c0, emissiveIntensity: 0.7,
        transparent: true, opacity: 0.85,
      });
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), ballMat);
      ball.position.set(0, 1.30, 0.42);
      npc.add(ball);
      const ballLight = new THREE.PointLight(0x60a0e0, 0.7, 3.5);
      ballLight.position.set(0, 1.30, 0.42);
      npc.add(ballLight);
      npc.position.set(disc.cx, 0, disc.cz);
      npc.rotation.y = -Math.PI * 0.20;
      scene.add(npc);
      const label = _makeLabelSprite('CURSE BREAKER', '#d8a0d8');
      label.position.set(disc.cx, 2.5, disc.cz);
      scene.add(label);
      return { npc, label, disc, ballMat, complete: false };
    },
    tick(dt, ctx) {
      const s = ctx.state;
      if (!s.ballMat) return;
      s._t = (s._t || 0) + dt;
      s.ballMat.emissiveIntensity = 0.55 + 0.25 * Math.sin(s._t * 3.0);
    },
    interact(ctx) {
      const s = ctx.state;
      if (s.complete) return;
      const COST = 8000;
      const credits = ctx.getPlayerCredits ? ctx.getPlayerCredits() : 0;
      const hasCurse = !!(ctx.artifacts && ctx.artifacts.has('brass_prisoner'));
      ctx.showPrompt({
        title: 'Curse Breaker',
        body: hasCurse
          ? '"I see brass on you, traveler. A small man, curled inside lead. For 8,000c I can pull him loose."'
          : '"You wear no curse today. Save your coin."',
        options: [
          {
            text: hasCurse ? `Break the curse (8,000c)${credits < COST ? ' — not enough' : ''}` : 'Nothing to break',
            enabled: hasCurse && credits >= COST,
            onPick: () => {
              if (!hasCurse) return;
              if (!ctx.spendCredits || !ctx.spendCredits(COST)) return;
              const ok = ctx.removeRelic && ctx.removeRelic('brass_prisoner');
              const speakAt = s.npc.position.clone().setY(2.5);
              if (ok) {
                ctx.spawnSpeech(speakAt, 'He fights — but he goes. Walk lighter.', 4.5);
                s.complete = true;
                if (ctx.markEncounterComplete) ctx.markEncounterComplete('curse_breaker');
              } else {
                ctx.spawnSpeech(speakAt, 'The curse slips my grasp. Try again.', 3.5);
              }
            },
          },
          { text: 'Walk away', onPick: () => {} },
        ],
      });
    },
    onItemDropped(_item, _ctx) { return { consume: false }; },
  },

  // -----------------------------------------------------------------
  // Sus — shady trench-coat man hawks a "premium" chest for 10000c.
  // Pay him and he vanishes; a chest spawns full of junk (and a small
  // chance of a random toy as a consolation prize). Recurring (NOT
  // oncePerSave) so the player can keep getting scammed if they want.
  // -----------------------------------------------------------------
  sus: {
    id: 'sus',
    name: 'Sus',
    floorColor: 0x2a221c,             // dim alley brown
    oncePerSave: false,
    condition: (state) => state.levelIndex >= 1,
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      // Build the trench-coat NPC. Body is a dark vertical box; head is
      // a slightly hooded sphere; brim hat sits on top so the
      // silhouette reads as "shady stranger" from iso angle.
      const npc = new THREE.Group();
      const coatMat = new THREE.MeshStandardMaterial({ color: 0x1a1812, roughness: 0.85 });
      const skinMat = new THREE.MeshStandardMaterial({ color: 0xa07050, roughness: 0.7 });
      const hatMat  = new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 0.85 });
      const accentMat = new THREE.MeshStandardMaterial({
        color: 0x6a4a20, roughness: 0.7, emissive: 0x301a08, emissiveIntensity: 0.4,
      });
      // Coat — wide tall box, slight forward lean read.
      const coat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 0.55), coatMat);
      coat.position.y = 0.95;
      coat.castShadow = true;
      npc.add(coat);
      // Coat lapel V — a brighter accent strip down the front so the
      // trench-coat reads as buttoned, not a slab.
      const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.04), accentMat);
      lapel.position.set(0, 1.0, 0.29);
      npc.add(lapel);
      // Head + neck.
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.12, 0.12, 8), skinMat);
      neck.position.y = 1.78;
      npc.add(neck);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), skinMat);
      head.position.y = 1.96;
      head.castShadow = true;
      npc.add(head);
      // Wide-brim hat — disc + low cylinder cap.
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 18), hatMat);
      brim.position.y = 2.10;
      npc.add(brim);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.20, 0.18, 14), hatMat);
      cap.position.y = 2.21;
      npc.add(cap);
      // Suspicious glow under the brim — two small emissive dots where
      // eyes would be. Sells "what's he hiding under there?"
      const eyeMat = new THREE.MeshStandardMaterial({
        color: 0xff8030, emissive: 0xff5010, emissiveIntensity: 1.0, roughness: 0.4,
      });
      for (const xs of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), eyeMat);
        eye.position.set(0.06 * xs, 1.99, 0.20);
        npc.add(eye);
      }
      npc.position.set(disc.cx, 0, disc.cz);
      // Slight twist toward the room centre so the iso camera catches
      // the lapel + brim shadow.
      npc.rotation.y = -Math.PI * 0.15;
      scene.add(npc);
      const label = _makeLabelSprite('SUS', '#d8a060');
      label.position.set(disc.cx, 2.6, disc.cz);
      scene.add(label);
      return { npc, label, disc, complete: false };
    },
    tick(_dt, _ctx) { /* purely interactive */ },
    interact(ctx) {
      const s = ctx.state;
      if (s.complete) return;
      const COST = 10000;
      const credits = ctx.getPlayerCredits ? ctx.getPlayerCredits() : 0;
      ctx.showPrompt({
        title: 'Sus',
        body: '"Psst. You. Yeah, you. Got somethin\' real special. Premium chest. The BEST bro. The BEST. 10,000c. Whaddya say?"',
        options: [
          {
            text: `Buy chest (10,000c)${credits < COST ? ' — not enough' : ''}`,
            enabled: credits >= COST,
            onPick: () => {
              if (!ctx.spendCredits || !ctx.spendCredits(COST)) return;
              s.complete = true;
              const speakAt = s.npc.position.clone().setY(2.6);
              ctx.spawnSpeech(speakAt, 'Pleasure doin\' business.', 2.4);
              // The man vanishes — hide the NPC + label so the room
              // empties out behind him. A short delay makes the
              // disappearance read as "he ducked out" instead of
              // popping mid-sentence.
              setTimeout(() => {
                if (s.npc) s.npc.visible = false;
                if (s.label) s.label.visible = false;
              }, 800);
              // Spawn the "premium" chest in front of where he stood.
              if (ctx.spawnSusChest) {
                ctx.spawnSusChest(s.disc.cx + 1.2, s.disc.cz);
              }
              if (ctx.markEncounterComplete) ctx.markEncounterComplete('sus');
            },
          },
          { text: 'Walk away', onPick: () => {} },
        ],
      });
    },
    onItemDropped(_item, _ctx) { return { consume: false }; },
  },

  the_crow: {
    id: 'the_crow',
    name: 'The Crow',
    floorColor: 0x303040,             // slate dais
    oncePerSave: true,
    condition: (state) => state.levelIndex >= 2,
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      const bird = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.65 });
      const beakMat = new THREE.MeshStandardMaterial({ color: 0x886030, roughness: 0.5 });
      const eyeMat  = new THREE.MeshStandardMaterial({
        color: 0xfff080, emissive: 0xa07020, emissiveIntensity: 0.6, roughness: 0.3,
      });
      // Stone perch.
      const perch = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.36, 0.42, 10),
        new THREE.MeshStandardMaterial({ color: 0x44464c, roughness: 0.85 }),
      );
      perch.position.y = 0.21;
      perch.castShadow = true;
      bird.add(perch);
      // Body — egg shape on top of perch.
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), bodyMat);
      body.scale.set(1, 1.2, 1.4);
      body.position.set(0, 0.62, 0.04);
      body.castShadow = true;
      bird.add(body);
      // Head.
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), bodyMat);
      head.position.set(0, 0.92, 0.18);
      head.castShadow = true;
      bird.add(head);
      // Beak — short cone forward.
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.15, 6), beakMat);
      beak.position.set(0, 0.90, 0.34);
      beak.rotation.x = Math.PI / 2;
      bird.add(beak);
      // Eyes.
      for (const xs of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), eyeMat);
        eye.position.set(0.06 * xs, 0.96, 0.27);
        bird.add(eye);
      }
      // Tail wedge.
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.30, 6), bodyMat);
      tail.position.set(0, 0.62, -0.22);
      tail.rotation.x = -Math.PI / 2;
      bird.add(tail);
      bird.position.set(disc.cx, 0, disc.cz);
      // Slight body-twist so the iso camera catches the silhouette.
      bird.rotation.y = -Math.PI * 0.20;
      scene.add(bird);
      const label = _makeLabelSprite('THE CROW', '#a8a0c0');
      label.position.set(disc.cx, 1.6, disc.cz);
      scene.add(label);
      return { bird, label, disc, complete: false, bobT: Math.random() * Math.PI * 2 };
    },
    tick(dt, ctx) {
      // Idle bob — head dip + slight body sway so he reads as alive.
      const s = ctx.state;
      if (!s.bird || s.complete) return;
      s.bobT += dt;
      s.bird.position.y = Math.abs(Math.sin(s.bobT * 1.6)) * 0.04;
    },
    onItemDropped(item, ctx) {
      const s = ctx.state;
      if (s.complete || !item) return { consume: false };
      // Only backpacks accepted. Mythic Magical Pack rejected — Crow
      // can't outdo it, and there's no point trading it for a downgrade.
      if (item.type !== 'backpack') return { consume: false };
      if (item._encounter) {
        ctx.spawnSpeech(s.bird.position.clone().setY(1.6),
          'Caw! Too fancy for me.', 4.0);
        return { consume: false };
      }
      const currentPockets = (item.pockets | 0) || 0;
      const bigger = ctx.pickBiggerBackpack && ctx.pickBiggerBackpack(currentPockets);
      if (!bigger) {
        ctx.spawnSpeech(s.bird.position.clone().setY(1.6),
          'Caw! Bring me something smaller.', 4.0);
        return { consume: false };
      }
      s.complete = true;
      ctx.spawnSpeech(s.bird.position.clone().setY(1.6),
        'Caw! A fair trade.', 4.5);
      ctx.spawnLoot(s.disc.cx + 0.8, s.disc.cz, bigger);
      if (ctx.markEncounterComplete) ctx.markEncounterComplete('the_crow');
      return { consume: true, complete: true };
    },
  },

  // -----------------------------------------------------------------
  // The Priest — recurring encounter. Stands in the room and asks
  // the player if they want to pray. "Yes" → heals; "No" → flavor
  // line about salvation + increments runStats.priestRefusals.
  // The third "no" drops a Demon Bear toy and flips
  // runStats.hasDemonBear, which (a) blocks the priest from
  // re-spawning and (b) unlocks the Great Bear's "Pain" trade.
  // -----------------------------------------------------------------
  priest: {
    id: 'priest',
    name: 'The Priest',
    floorColor: 0xe8d8a8,             // candle-warm dais
    oncePerSave: false,
    condition: (state) => state.levelIndex >= 1 && !(state.runStats?.hasDemonBear),
    SALVATION_LINES: [
      'Then I shall pray for your soul, traveler.',
      'Salvation does not wait forever, my friend.',
      'I have nothing left to offer you. Take this.',
    ],
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      const npc = _buildSimpleNpc({
        bodyColor: 0x202028, headColor: 0xc8a888,
        accentColor: 0xd0b070, height: 2.0,
      });
      npc.position.set(disc.cx, 0, disc.cz);
      scene.add(npc);
      const label = _makeLabelSprite('THE PRIEST', '#f0d488');
      label.position.set(disc.cx, 2.4, disc.cz);
      scene.add(label);
      return { npc, label, disc, complete: false };
    },
    tick(_dt, _ctx) { /* purely interactive */ },
    interact(ctx) {
      const s = ctx.state;
      if (s.complete) return;
      const refused = ctx.runStats?.priestRefusals | 0;
      const def = ENCOUNTER_DEFS.priest;
      ctx.showPrompt({
        title: 'The Priest',
        body: refused === 0
          ? 'Will you pray with me?'
          : refused === 1
            ? 'Once more, will you bow your head?'
            : 'A final chance, traveler. Will you pray?',
        options: [
          {
            text: 'Yes',
            onPick: () => {
              ctx.spawnSpeech(s.npc.position.clone().setY(2.4),
                'Bless you. Walk lighter.', 4.0);
              if (ctx.playerHeal) ctx.playerHeal(60);
              s.complete = true;
              if (ctx.markEncounterComplete) ctx.markEncounterComplete('priest');
            },
          },
          {
            text: 'No',
            onPick: () => {
              const idx = Math.min(refused, def.SALVATION_LINES.length - 1);
              ctx.spawnSpeech(s.npc.position.clone().setY(2.4),
                def.SALVATION_LINES[idx], 4.0);
              if (ctx.runStats) ctx.runStats.priestRefusals = refused + 1;
              s.complete = true;
              if (ctx.markEncounterComplete) ctx.markEncounterComplete('priest');
              // Third "no" — drop the Demon Bear toy and flip the
              // run flag so the priest stops respawning + the Great
              // Bear merchant unlocks the Pain trade.
              if ((refused + 1) >= 3 && !ctx.runStats?.hasDemonBear) {
                if (ctx.runStats) ctx.runStats.hasDemonBear = true;
                if (ctx.spawnDemonBear) ctx.spawnDemonBear(s.disc.cx + 0.8, s.disc.cz);
              }
            },
          },
        ],
      });
    },
    onItemDropped(_item, _ctx) { return { consume: false }; },
  },

  // -----------------------------------------------------------------
  // Brethren — High Council assassin standing in the centre of the
  // room. He's a fence for chips: drop any weapon at his feet and he
  // pays you persistent meta-chips proportional to the weapon's gold
  // value (~1 chip per 1000 gold of sell price, floored at 1). Each
  // weapon is consumed; you can keep feeding him until you leave or
  // run out of weapons. NOT once-per-save — the Council always pays.
  // -----------------------------------------------------------------
  brethren: {
    id: 'brethren',
    name: 'Brethren',
    floorColor: 0x2c2230,             // council-purple flagstone
    oncePerSave: false,
    condition: (state) => state.levelIndex >= 2,
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      // Standing assassin — long dark-robe palette, hood-tan head.
      const npc = _buildSimpleNpc({
        bodyColor: 0x2a2030, headColor: 0xc8a888,
        accentColor: 0x6a3070, height: 2.0,
      });
      npc.position.set(disc.cx, 0, disc.cz);
      scene.add(npc);
      const label = _makeLabelSprite('BRETHREN', '#c890f0');
      label.position.set(disc.cx, 2.4, disc.cz);
      scene.add(label);
      return { npc, label, disc, traded: 0 };
    },
    tick(_dt, _ctx) { /* purely reactive — no per-frame work */ },
    onItemDropped(item, ctx) {
      const s = ctx.state;
      if (!item) return { consume: false };
      const isWeapon = item.type === 'ranged' || item.type === 'melee';
      if (!isWeapon) return { consume: false };
      // Compute chip payout from the weapon's sell value. ~1 chip per
      // 1000 gold, floor 1 so even a common weapon trades for something.
      const gold = ctx.sellPriceFor ? Math.max(1, ctx.sellPriceFor(item) | 0) : 100;
      const chips = Math.max(1, Math.round(gold / 1000));
      if (ctx.awardChips) ctx.awardChips(chips);
      s.traded += 1;
      const flavor = chips >= 20
        ? 'A worthy blade. The Council thanks you.'
        : chips >= 5
          ? 'Acceptable. Your debt grows lighter.'
          : 'Hmm. The Council pays for what it pays for.';
      ctx.spawnSpeech(s.npc.position.clone().setY(2.4),
        `${flavor}  +${chips}◆`, 4.0);
      // Never marks complete — the Council keeps buying.
      return { consume: true };
    },
  },
};

// Helper — pick one valid encounter for the given level state, or null.
// Caller handles the "no encounter this level" outcome.
export function pickEncounterForLevel(levelIndex, completedSet, runStats = null, artifacts = null) {
  const candidates = Object.values(ENCOUNTER_DEFS).filter((def) => {
    if (def.oncePerSave && completedSet.has(def.id)) return false;
    if (def.condition && !def.condition({ levelIndex, completed: completedSet, runStats, artifacts })) return false;
    return true;
  });
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
