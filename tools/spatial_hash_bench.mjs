import { SpatialHash2D } from '../src/spatial_hash.js';

const CELL_SIZE = 5;
const WORLD_SIZE = 180;
const ROOM_COUNT = 24;
const OBSTACLE_COUNT = 260;
const SHIELD_COUNT = 22;
const ENEMY_COUNT = 180;
const LOS_QUERY_COUNT = 4000;
const ESCORT_QUERY_COUNT = 3000;

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function overlapsAabb(a, b) {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxZ < b.minZ || a.minZ > b.maxZ);
}

function makeObstacle(id) {
  const cx = rand(-WORLD_SIZE, WORLD_SIZE);
  const cz = rand(-WORLD_SIZE, WORLD_SIZE);
  const w = rand(0.8, 6.5);
  const d = rand(0.8, 6.5);
  return {
    id,
    userData: {
      collisionXZ: {
        minX: cx - w * 0.5,
        maxX: cx + w * 0.5,
        minZ: cz - d * 0.5,
        maxZ: cz + d * 0.5,
      },
    },
  };
}

function makeShieldBearer(id) {
  return {
    id,
    alive: true,
    roomId: Math.floor(rand(0, ROOM_COUNT)),
    group: { position: { x: rand(-WORLD_SIZE, WORLD_SIZE), z: rand(-WORLD_SIZE, WORLD_SIZE) } },
  };
}

function makeEnemy(id) {
  return {
    id,
    roomId: Math.floor(rand(0, ROOM_COUNT)),
    group: { position: { x: rand(-WORLD_SIZE, WORLD_SIZE), z: rand(-WORLD_SIZE, WORLD_SIZE) } },
  };
}

function losBox(from, to) {
  const pad = 0.15;
  return {
    minX: Math.min(from.x, to.x) - pad,
    maxX: Math.max(from.x, to.x) + pad,
    minZ: Math.min(from.z, to.z) - pad,
    maxZ: Math.max(from.z, to.z) + pad,
  };
}

function naiveEscort(enemy, shieldBearers) {
  let best = null;
  let bestD = 40;
  for (const sb of shieldBearers) {
    if (sb.roomId !== enemy.roomId) continue;
    const dx = sb.group.position.x - enemy.group.position.x;
    const dz = sb.group.position.z - enemy.group.position.z;
    const d = Math.hypot(dx, dz);
    if (d < bestD) {
      best = sb;
      bestD = d;
    }
  }
  return best;
}

function hashedEscort(enemy, shieldHash, scratch) {
  const nearby = shieldHash.queryAabb(
    enemy.group.position.x - 40,
    enemy.group.position.x + 40,
    enemy.group.position.z - 40,
    enemy.group.position.z + 40,
    scratch,
  );
  let best = null;
  let bestD = 40;
  for (const sb of nearby) {
    if (sb.roomId !== enemy.roomId) continue;
    const dx = sb.group.position.x - enemy.group.position.x;
    const dz = sb.group.position.z - enemy.group.position.z;
    const d = Math.hypot(dx, dz);
    if (d < bestD) {
      best = sb;
      bestD = d;
    }
  }
  return best;
}

function hashedLosCandidates(hash, box, scratch) {
  const candidates = hash.queryAabb(box.minX, box.maxX, box.minZ, box.maxZ, scratch);
  let write = 0;
  for (let i = 0; i < candidates.length; i++) {
    const obstacle = candidates[i];
    if (!overlapsAabb(obstacle.userData.collisionXZ, box)) continue;
    candidates[write++] = obstacle;
  }
  candidates.length = write;
  return candidates;
}

function time(label, fn) {
  const start = process.hrtime.bigint();
  const value = fn();
  const end = process.hrtime.bigint();
  const ms = Number(end - start) / 1e6;
  return { label, ms, value };
}

const obstacles = Array.from({ length: OBSTACLE_COUNT }, (_, i) => makeObstacle(i));
const shieldBearers = Array.from({ length: SHIELD_COUNT }, (_, i) => makeShieldBearer(i));
const enemies = Array.from({ length: ENEMY_COUNT }, (_, i) => makeEnemy(i));
const playerSamples = Array.from({ length: LOS_QUERY_COUNT }, () => ({
  x: rand(-WORLD_SIZE, WORLD_SIZE),
  z: rand(-WORLD_SIZE, WORLD_SIZE),
}));

const obstacleHash = new SpatialHash2D(CELL_SIZE);
obstacleHash.rebuildAabbs(obstacles, (o) => o.userData.collisionXZ);

const shieldHash = new SpatialHash2D(CELL_SIZE);
shieldHash.rebuildPoints(shieldBearers, (sb) => sb.group.position);

const escortScratch = [];
for (const enemy of enemies) {
  const a = naiveEscort(enemy, shieldBearers)?.id ?? null;
  const b = hashedEscort(enemy, shieldHash, escortScratch)?.id ?? null;
  if (a !== b) {
    throw new Error(`Escort mismatch for enemy ${enemy.id}: naive=${a} hash=${b}`);
  }
}

const losScratch = [];
for (let i = 0; i < 250; i++) {
  const from = enemies[i % enemies.length].group.position;
  const to = playerSamples[i];
  const box = losBox(from, to);
  const naive = obstacles
    .filter((o) => overlapsAabb(o.userData.collisionXZ, box))
    .map((o) => o.id)
    .sort((a, b) => a - b);
  const hashed = hashedLosCandidates(obstacleHash, box, losScratch)
    .map((o) => o.id)
    .sort((a, b) => a - b);
  if (naive.length !== hashed.length || naive.some((id, idx) => id !== hashed[idx])) {
    throw new Error(`LoS candidate mismatch on sample ${i}`);
  }
}

const escortNaive = time('escort naive', () => {
  let hits = 0;
  let checks = 0;
  for (let i = 0; i < ESCORT_QUERY_COUNT; i++) {
    checks += shieldBearers.length;
    if (naiveEscort(enemies[i % enemies.length], shieldBearers)) hits++;
  }
  return { hits, checks };
});

const escortHashed = time('escort hash', () => {
  let hits = 0;
  let checks = 0;
  for (let i = 0; i < ESCORT_QUERY_COUNT; i++) {
    const enemy = enemies[i % enemies.length];
    const nearby = shieldHash.queryAabb(
      enemy.group.position.x - 40,
      enemy.group.position.x + 40,
      enemy.group.position.z - 40,
      enemy.group.position.z + 40,
      escortScratch,
    );
    checks += nearby.length;
    if (hashedEscort(enemy, shieldHash, escortScratch)) hits++;
  }
  return { hits, checks };
});

const losNaive = time('los candidates naive', () => {
  let candidateCount = 0;
  for (let i = 0; i < LOS_QUERY_COUNT; i++) {
    candidateCount += obstacles.length;
  }
  return candidateCount;
});

const losHashed = time('los candidates hash', () => {
  let candidateCount = 0;
  for (let i = 0; i < LOS_QUERY_COUNT; i++) {
    const from = enemies[i % enemies.length].group.position;
    const to = playerSamples[i];
    const box = losBox(from, to);
    candidateCount += hashedLosCandidates(obstacleHash, box, losScratch).length;
  }
  return candidateCount;
});

console.log(`Spatial hash benchmark (${CELL_SIZE}m cells)`);
console.log(`Obstacles: ${OBSTACLE_COUNT}, shield bearers: ${SHIELD_COUNT}, enemies: ${ENEMY_COUNT}`);
console.log(`Escort naive: ${escortNaive.ms.toFixed(2)} ms, candidate checks ${escortNaive.value.checks}`);
console.log(`Escort hash: ${escortHashed.ms.toFixed(2)} ms, candidate checks ${escortHashed.value.checks}`);
console.log(`Escort candidate reduction: ${(escortNaive.value.checks / Math.max(1, escortHashed.value.checks)).toFixed(2)}x`);
console.log(`LoS naive: ${losNaive.ms.toFixed(2)} ms, blocker checks ${losNaive.value}`);
console.log(`LoS hash: ${losHashed.ms.toFixed(2)} ms, blocker checks ${losHashed.value}`);
console.log(`LoS blocker reduction: ${(losNaive.value / Math.max(1, losHashed.value)).toFixed(2)}x`);
