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

// Hex floor-disc helper used by every encounter spawn. Adds a flat
// glowing ring at the room centre so the room reads as "special" from
// the doorway. Returns the mesh so callers can add additional props
// on top.
function _spawnFloorDisc(scene, room, color) {
  const cx = (room.bounds.minX + room.bounds.maxX) / 2;
  const cz = (room.bounds.minZ + room.bounds.maxZ) / 2;
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
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.85 });
  const headMat = new THREE.MeshStandardMaterial({ color: headColor, roughness: 0.7 });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accentColor, roughness: 0.5, metalness: 0.3,
    emissive: accentColor, emissiveIntensity: 0.2,
  });
  // Legs.
  const leg = (sx) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.12, height * 0.45, 8), bodyMat);
    m.position.set(sx, height * 0.225, 0);
    m.castShadow = true;
    return m;
  };
  group.add(leg(-0.10), leg(0.10));
  // Torso.
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, height * 0.40, 10), bodyMat);
  torso.position.y = height * 0.45 + height * 0.20;
  torso.castShadow = true;
  group.add(torso);
  // Head.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), headMat);
  head.position.y = height * 0.85 + 0.18;
  head.castShadow = true;
  group.add(head);
  // Accent: shoulder cape / sash that clearly identifies the role.
  const sash = new THREE.Mesh(
    new THREE.BoxGeometry(0.50, 0.08, 0.18),
    accentMat,
  );
  sash.position.set(0, height * 0.78, 0);
  sash.rotation.z = 0.05;
  group.add(sash);
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
    oncePerSave: true,
    condition: (state) => state.levelIndex >= 1,
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
        'DID SOMEONE SAY PEAS?!', 4.0);
      // Reward: one of two encounter-only relics. Skips any the
      // player already owns so re-running the trick still rewards
      // (in the rare case both are unowned, randomly pick one).
      const ids = ['innocent_heart', 'unused_rocket_ticket'];
      const available = ctx.filterUnownedArtifactIds
        ? ctx.filterUnownedArtifactIds(ids)
        : ids;
      const pickId = available.length
        ? available[Math.floor(Math.random() * available.length)]
        : ids[Math.floor(Math.random() * ids.length)];
      const scroll = ctx.artifactScrollFor && ctx.artifactScrollFor(pickId);
      if (scroll) ctx.spawnLoot(s.disc.cx + 0.8, s.disc.cz, scroll);
      return { consume: true, complete: true };
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
  // artifact scroll appears in its place. One-shot per save.
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
      // Subtle hint sprite below — the player has to figure out the
      // mechanic, but we drop a small hint about weapons.
      const hint = _makeLabelSprite('Drop a weapon to confess', '#c9a87a');
      hint.scale.set(3.6, 0.65, 1);
      hint.position.set(disc.cx, 0.55, disc.cz + 1.6);
      scene.add(hint);
      return { booth, label, hint, disc, complete: false };
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
      const scroll = ctx.rollUnownedArtifactScroll && ctx.rollUnownedArtifactScroll();
      if (!scroll) {
        s.complete = false;
        return { consume: false };
      }
      ctx.spawnLoot(s.disc.cx, s.disc.cz + 1.0, scroll);
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
      // Collapse animation — drop each skull with a wobble.
      if (s.collapseT > 0) {
        s.collapseT = Math.max(0, s.collapseT - dt);
        const k = 1 - (s.collapseT / 1.4);
        for (const child of s.cairn.children) {
          child.position.y = Math.max(0.10, child.position.y - dt * 1.6);
          child.rotation.z += dt * (Math.random() - 0.5) * 4;
        }
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
    hittables(state) {
      if (!state || !state.built) return [];
      if (state.target && state.target.broken) return [];
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
      const hint = _makeLabelSprite('Press E to consult', '#c9a87a');
      hint.scale.set(3.6, 0.65, 1);
      hint.position.set(disc.cx, 0.55, disc.cz + 1.6);
      scene.add(hint);
      return { npc, label, hint, orb, disc, complete: false, wobbleT: 0 };
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
      const hint = _makeLabelSprite('Press E to make an offering', '#c9a87a');
      hint.scale.set(4.2, 0.65, 1);
      hint.position.set(disc.cx, 0.55, disc.cz + 1.6);
      scene.add(hint);
      return { altar, brazier, flame, label, hint, disc, wobbleT: 0 };
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
              const scroll = ctx.rollUnownedArtifactScroll && ctx.rollUnownedArtifactScroll();
              if (scroll) {
                ctx.spawnLoot(s.disc.cx, s.disc.cz + 1.2, scroll);
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
    LISTEN_TIME: 25,
    MOVE_THRESHOLD: 0.20,             // metres of drift considered "movement"
    spawn(scene, room, ctx) {
      const disc = _spawnFloorDisc(scene, room, this.floorColor);
      const door = _buildWhisperingDoor();
      door.position.set(disc.cx, 0, disc.cz);
      scene.add(door);
      const label = _makeLabelSprite('WHISPERING DOOR', '#c8e0f0');
      label.position.set(disc.cx, 3.2, disc.cz);
      scene.add(label);
      const hint = _makeLabelSprite('Stand still and listen', '#c9a87a');
      hint.scale.set(3.6, 0.65, 1);
      hint.position.set(disc.cx, 0.55, disc.cz + 1.6);
      scene.add(hint);
      // Progress sprite — text fills in when listening.
      const progress = _makeLabelSprite('', '#c8e0f0');
      progress.scale.set(3.6, 0.65, 1);
      progress.position.set(disc.cx, 1.0, disc.cz + 1.6);
      progress.visible = false;
      scene.add(progress);
      return {
        door, label, hint, progress, disc,
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
      // Update progress sprite + final prompt.
      if (s.progress) {
        s.progress.visible = true;
        const pct = Math.min(1, s.listenT / def.LISTEN_TIME);
        const sec = Math.max(0, Math.ceil(def.LISTEN_TIME - s.listenT));
        s.progress.userData.setText(
          pct >= 1 ? 'PRESS E TO CHOOSE A PATH'
                   : `Listening... ${sec}s`,
        );
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
      const hint = _makeLabelSprite('Press E to throw 100c', '#c9a87a');
      hint.scale.set(3.6, 0.65, 1);
      hint.position.set(disc.cx, 0.55, disc.cz + 1.8);
      scene.add(hint);
      const progress = _makeLabelSprite('', '#a0e0f0');
      progress.scale.set(3.6, 0.65, 1);
      progress.position.set(disc.cx, 1.0, disc.cz + 1.8);
      progress.visible = false;
      scene.add(progress);
      return {
        built, label, hint, progress, disc,
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
          ctx.spawnSignetChest(s.disc.cx + 1.8, s.disc.cz);
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
    GAZE_TIME: 10,
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
      const hint = _makeLabelSprite('Stand still and look', '#c9a87a');
      hint.scale.set(3.6, 0.65, 1);
      hint.position.set(disc.cx, 0.55, disc.cz + 1.6);
      scene.add(hint);
      const progress = _makeLabelSprite('', '#d8e0e8');
      progress.scale.set(3.6, 0.65, 1);
      progress.position.set(disc.cx, 1.0, disc.cz + 1.6);
      progress.visible = false;
      scene.add(progress);
      return {
        group, glass, label, hint, progress, disc,
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
          const sec = Math.max(0, Math.ceil(def.GAZE_TIME - s.gazeT));
          s.progress.userData.setText(s.gazeT >= def.GAZE_TIME
            ? '...something stirs in the glass'
            : `Gazing... ${sec}s`);
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
      const hint = _makeLabelSprite('Zzz... do not disturb', '#7a8290');
      hint.scale.set(3.6, 0.65, 1);
      hint.position.set(disc.cx, 0.55, disc.cz + 1.6);
      scene.add(hint);
      // Sub-boss loot pile in a corner.
      const cb = ctx.room.bounds;
      const chestX = cb.minX + 2.4;
      const chestZ = cb.minZ + 2.4;
      const items = ctx.rollSubBossLootPile ? ctx.rollSubBossLootPile() : [];
      if (ctx.spawnEncounterChest) ctx.spawnEncounterChest(chestX, chestZ, items);
      return {
        npc, label, hint, disc,
        slept: false,
        woke: false,
        complete: false,
        snoreT: 0,
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
      // First-frame logic: if the player ever leaves the room while
      // peaceful, we lock the encounter complete (peaceful path).
      const px = ctx.playerPos.x, pz = ctx.playerPos.z;
      const inRoom = ctx.room && ctx.room.bounds
        && px >= ctx.room.bounds.minX && px <= ctx.room.bounds.maxX
        && pz >= ctx.room.bounds.minZ && pz <= ctx.room.bounds.maxZ;
      if (inRoom) s.everEntered = true;
      if (!s.complete && s.everEntered && !inRoom && !s.woke) {
        // Player left without disturbing him. Peaceful path locked.
        s.complete = true;
        if (ctx.markEncounterComplete) ctx.markEncounterComplete('sleeping_boss');
        if (s.hint) s.hint.userData.setText('You stepped softly. He never knew.');
      }
    },
    // Sleeping Boss is purely environmental; player damages him by
    // shooting/meleeing the NPC mesh, which we don't make hittable
    // for this prototype. The "wake on damage" branch is left as a
    // future hook — the peaceful path is what ships now.
    onItemDropped(item, ctx) { return { consume: false }; },
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
      const hint = _makeLabelSprite('Talk · or shoot one', '#c9a87a');
      hint.scale.set(3.6, 0.65, 1);
      hint.position.set(disc.cx, 0.55, disc.cz + 1.8);
      scene.add(hint);
      return {
        pair, label, hint, disc,
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
        // Bark dialog when player is close.
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
          if (target && target.group) {
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
          const scroll = ctx.artifactScrollFor && ctx.artifactScrollFor('indecision');
          if (scroll) ctx.spawnLoot(s.disc.cx, s.disc.cz, scroll);
          s.phase = 'returned';
          s.complete = true;
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
      const hint = _makeLabelSprite('Drop an item in the centre', '#c9a87a');
      hint.scale.set(3.6, 0.65, 1);
      hint.position.set(disc.cx, 0.55, disc.cz + 2.0);
      scene.add(hint);
      return {
        group, flames, label, hint, disc,
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
      // Legendary in → random non-Jessica's-Rage mythic.
      if (item.rarity === 'legendary' && (item.type === 'ranged' || item.type === 'melee')) {
        const mythic = ctx.rollMythicWeapon && ctx.rollMythicWeapon();
        if (!mythic) return { consume: false };
        ctx.spawnSpeech(new THREE.Vector3(s.disc.cx, 1.8, s.disc.cz),
          'A greater shape emerges.', 4.0);
        ctx.spawnLoot(s.disc.cx, s.disc.cz + 0.6, mythic);
        return { consume: true };
      }
      // Non-legendary → legendary version (5% mastercraft on top).
      // Only meaningful for items with a rarity ladder (weapons,
      // armor, gear, attachments, throwables). Junk + consumables
      // don't have rarity tiers worth bumping.
      const ladderTypes = new Set(['ranged', 'melee', 'armor', 'gear', 'attachment', 'throwable']);
      if (ladderTypes.has(item.type) && item.rarity !== 'mythic') {
        const out = JSON.parse(JSON.stringify(item));
        out.rarity = 'legendary';
        if (Math.random() < 0.05) out.mastercraft = true;
        ctx.spawnSpeech(new THREE.Vector3(s.disc.cx, 1.8, s.disc.cz),
          'The flames purify.', 4.0);
        ctx.spawnLoot(s.disc.cx, s.disc.cz + 0.6, out);
        return { consume: true };
      }
      // Anything else (junk, consumable, etc.): refuse.
      return { consume: false };
    },
  },
};

// Helper — pick one valid encounter for the given level state, or null.
// Caller handles the "no encounter this level" outcome.
export function pickEncounterForLevel(levelIndex, completedSet) {
  const candidates = Object.values(ENCOUNTER_DEFS).filter((def) => {
    if (def.oncePerSave && completedSet.has(def.id)) return false;
    if (def.condition && !def.condition({ levelIndex, completed: completedSet })) return false;
    return true;
  });
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
