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
      // Spawn a random toy nearby.
      const toy = ctx.rollRandomToy && ctx.rollRandomToy();
      if (toy) ctx.spawnLoot(s.disc.cx + 0.8, s.disc.cz, toy);
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
