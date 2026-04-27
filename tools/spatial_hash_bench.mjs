class SpatialHash2D {
  constructor(cellSize = 5) {
    this.cellSize = cellSize;
    this._invCellSize = 1 / cellSize;
    this._cells = new Map();
    this._marks = new WeakMap();
    this._queryStamp = 0;
  }

  _cellKey(cellX, cellZ) {
    return ((cellX + 32768) << 16) | ((cellZ + 32768) & 0xffff);
  }

  clear() {
    this._cells.clear();
  }

  rebuildAabbs(items, getBounds) {
    this.clear();
    for (const item of items) {
      const bounds = getBounds(item);
      if (!bounds) continue;
      const minCellX = Math.floor(bounds.minX * this._invCellSize);
      const maxCellX = Math.floor(bounds.maxX * this._invCellSize);
      const minCellZ = Math.floor(bounds.minZ * this._invCellSize);
      const maxCellZ = Math.floor(bounds.maxZ * this._invCellSize);
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
          const key = this._cellKey(cellX, cellZ);
          let bucket = this._cells.get(key);
          if (!bucket) {
            bucket = [];
            this._cells.set(key, bucket);
          }
          bucket.push(item);
        }
      }
    }
  }

  rebuildPoints(items, getPoint) {
    this.clear();
    for (const item of items) {
      const point = getPoint(item);
      if (!point) continue;
      const key = this._cellKey(
        Math.floor(point.x * this._invCellSize),
        Math.floor(point.z * this._invCellSize),
      );
      let bucket = this._cells.get(key);
      if (!bucket) {
        bucket = [];
        this._cells.set(key, bucket);
      }
      bucket.push(item);
    }
  }

  queryAabb(minX, maxX, minZ, maxZ, out) {
    out.length = 0;
    const stamp = ++this._queryStamp;
    const minCellX = Math.floor(minX * this._invCellSize);
    const maxCellX = Math.floor(maxX * this._invCellSize);
    const minCellZ = Math.floor(minZ * this._invCellSize);
    const maxCellZ = Math.floor(maxZ * this._invCellSize);
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        const bucket = this._cells.get(this._cellKey(cellX, cellZ));
        if (!bucket) continue;
        for (const item of bucket) {
          if (this._marks.get(item) === stamp) continue;
          this._marks.set(item, stamp);
          out.push(item);
        }
      }
    }
    return out;
  }
}

const CELL_SIZE = 5;
const MIN_OBSTACLES_FOR_HASH = 512;
const MIN_SHIELDS_FOR_HASH = 48;
const WORLD_SIZE = 180;
const ROOM_COUNT = 24;

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

function queryHashedLosCandidates(hash, box, scratch) {
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

function forcedHashEscort(enemy, shieldHash, scratch) {
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

function adaptiveEscort(enemy, shieldBearers, shieldHash, scratch) {
  if (shieldBearers.length < MIN_SHIELDS_FOR_HASH) {
    return naiveEscort(enemy, shieldBearers);
  }
  return forcedHashEscort(enemy, shieldHash, scratch);
}

function time(fn) {
  const start = process.hrtime.bigint();
  const value = fn();
  const end = process.hrtime.bigint();
  return { ms: Number(end - start) / 1e6, value };
}

function verifyCorrectness(dataset) {
  const escortScratch = [];
  const losScratch = [];
  const shieldHash = new SpatialHash2D(CELL_SIZE);
  shieldHash.rebuildPoints(dataset.shieldBearers, (sb) => sb.group.position);
  const obstacleHash = new SpatialHash2D(CELL_SIZE);
  obstacleHash.rebuildAabbs(dataset.obstacles, (o) => o.userData.collisionXZ);

  for (const enemy of dataset.enemies) {
    const a = naiveEscort(enemy, dataset.shieldBearers)?.id ?? null;
    const b = forcedHashEscort(enemy, shieldHash, escortScratch)?.id ?? null;
    if (a !== b) throw new Error(`Escort mismatch for enemy ${enemy.id}: naive=${a} hash=${b}`);
  }
  for (let i = 0; i < Math.min(250, dataset.losQueries); i++) {
    const from = dataset.enemies[i % dataset.enemies.length].group.position;
    const to = dataset.playerSamples[i];
    const box = losBox(from, to);
    const naive = dataset.obstacles
      .filter((o) => overlapsAabb(o.userData.collisionXZ, box))
      .map((o) => o.id)
      .sort((a, b) => a - b);
    const hashed = queryHashedLosCandidates(obstacleHash, box, losScratch)
      .map((o) => o.id)
      .sort((a, b) => a - b);
    if (naive.length !== hashed.length || naive.some((id, idx) => id !== hashed[idx])) {
      throw new Error(`LoS candidate mismatch on sample ${i}`);
    }
  }
}

function runScenario(name, config) {
  const obstacles = Array.from({ length: config.obstacles }, (_, i) => makeObstacle(i));
  const shieldBearers = Array.from({ length: config.shields }, (_, i) => makeShieldBearer(i));
  const enemies = Array.from({ length: config.enemies }, (_, i) => makeEnemy(i));
  const playerSamples = Array.from({ length: config.losQueries }, () => ({
    x: rand(-WORLD_SIZE, WORLD_SIZE),
    z: rand(-WORLD_SIZE, WORLD_SIZE),
  }));
  const dataset = { obstacles, shieldBearers, enemies, playerSamples, losQueries: config.losQueries };
  verifyCorrectness(dataset);

  const shieldHash = new SpatialHash2D(CELL_SIZE);
  shieldHash.rebuildPoints(shieldBearers, (sb) => sb.group.position);
  const obstacleHash = new SpatialHash2D(CELL_SIZE);
  obstacleHash.rebuildAabbs(obstacles, (o) => o.userData.collisionXZ);
  const escortScratch = [];
  const losScratch = [];

  const escortNaive = time(() => {
    let hits = 0;
    for (let i = 0; i < config.escortQueries; i++) {
      if (naiveEscort(enemies[i % enemies.length], shieldBearers)) hits++;
    }
    return hits;
  });
  const escortForcedHash = time(() => {
    let hits = 0;
    for (let i = 0; i < config.escortQueries; i++) {
      if (forcedHashEscort(enemies[i % enemies.length], shieldHash, escortScratch)) hits++;
    }
    return hits;
  });
  const escortAdaptive = time(() => {
    let hits = 0;
    for (let i = 0; i < config.escortQueries; i++) {
      if (adaptiveEscort(enemies[i % enemies.length], shieldBearers, shieldHash, escortScratch)) hits++;
    }
    return hits;
  });

  const losNaive = time(() => {
    let candidateCount = 0;
    for (let i = 0; i < config.losQueries; i++) {
      const from = enemies[i % enemies.length].group.position;
      const to = playerSamples[i];
      const box = losBox(from, to);
      for (const obstacle of obstacles) {
        if (overlapsAabb(obstacle.userData.collisionXZ, box)) candidateCount++;
      }
    }
    return candidateCount;
  });
  const losForcedHash = time(() => {
    let candidateCount = 0;
    for (let i = 0; i < config.losQueries; i++) {
      const from = enemies[i % enemies.length].group.position;
      const to = playerSamples[i];
      candidateCount += queryHashedLosCandidates(obstacleHash, losBox(from, to), losScratch).length;
    }
    return candidateCount;
  });
  const losAdaptive = time(() => {
    let candidateCount = 0;
    const useHash = obstacles.length >= MIN_OBSTACLES_FOR_HASH;
    for (let i = 0; i < config.losQueries; i++) {
      const from = enemies[i % enemies.length].group.position;
      const to = playerSamples[i];
      if (useHash) {
        candidateCount += queryHashedLosCandidates(obstacleHash, losBox(from, to), losScratch).length;
      } else {
        const box = losBox(from, to);
        for (const obstacle of obstacles) {
          if (overlapsAabb(obstacle.userData.collisionXZ, box)) candidateCount++;
        }
      }
    }
    return candidateCount;
  });

  console.log(`\nScenario: ${name}`);
  console.log(`Obstacles=${config.obstacles}, shieldBearers=${config.shields}, enemies=${config.enemies}`);
  console.log(`Escort naive:       ${escortNaive.ms.toFixed(2)} ms`);
  console.log(`Escort forced hash: ${escortForcedHash.ms.toFixed(2)} ms`);
  console.log(`Escort adaptive:    ${escortAdaptive.ms.toFixed(2)} ms`);
  console.log(`LoS naive:          ${losNaive.ms.toFixed(2)} ms`);
  console.log(`LoS forced hash:    ${losForcedHash.ms.toFixed(2)} ms`);
  console.log(`LoS adaptive:       ${losAdaptive.ms.toFixed(2)} ms`);
}

console.log(`Spatial hash benchmark (${CELL_SIZE}m cells, thresholds obstacles>=${MIN_OBSTACLES_FOR_HASH}, shields>=${MIN_SHIELDS_FOR_HASH})`);
runScenario('Current-scale', {
  obstacles: 260,
  shields: 22,
  enemies: 180,
  escortQueries: 3000,
  losQueries: 4000,
});
runScenario('Stress-scale', {
  obstacles: 1200,
  shields: 96,
  enemies: 320,
  escortQueries: 3000,
  losQueries: 4000,
});
