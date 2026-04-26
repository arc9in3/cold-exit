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
