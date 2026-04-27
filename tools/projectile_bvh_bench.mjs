import { StaticObstacleGrid2D } from '../src/obstacle_grid.js';

const CELL_SIZE = 5;
const PROJECTILE_RADIUS = 0.1;
const PROP_TOP = 1.5;
const WORLD_SIZE = 180;
const FRAMES = 1200;
const PROJECTILES_PER_FRAME = 30;
const STEPS_PER_PROJECTILE = 5;
const IMPACTS_PER_FRAME = PROJECTILES_PER_FRAME * STEPS_PER_PROJECTILE;

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function makeObstacle(id) {
  const cx = rand(-WORLD_SIZE, WORLD_SIZE);
  const cz = rand(-WORLD_SIZE, WORLD_SIZE);
  const w = rand(0.8, 6.5);
  const d = rand(0.8, 6.5);
  const kind = Math.random();
  return {
    id,
    userData: {
      isProp: kind < 0.22,
      containerRef: kind >= 0.22 && kind < 0.28 ? { id } : null,
      collisionXZ: {
        minX: cx - w * 0.5,
        maxX: cx + w * 0.5,
        minZ: cz - d * 0.5,
        maxZ: cz + d * 0.5,
      },
    },
  };
}

function makeStep() {
  const fromX = rand(-WORLD_SIZE, WORLD_SIZE);
  const fromZ = rand(-WORLD_SIZE, WORLD_SIZE);
  const vx = rand(-18, 18);
  const vz = rand(-18, 18);
  const dt = rand(0.012, 0.028);
  return {
    fromX,
    fromZ,
    x: fromX + vx * dt,
    z: fromZ + vz * dt,
    y: rand(0.12, 2.85),
  };
}

function hitsObstacleNaive(obstacles, step) {
  let candidates = 0;
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    const b = o.userData.collisionXZ;
    if (!b) continue;
    candidates++;
    const ud = o.userData;
    if ((ud.isProp || ud.containerRef) && step.y > PROP_TOP) continue;
    if (
      step.x > b.minX - PROJECTILE_RADIUS &&
      step.x < b.maxX + PROJECTILE_RADIUS &&
      step.z > b.minZ - PROJECTILE_RADIUS &&
      step.z < b.maxZ + PROJECTILE_RADIUS
    ) {
      return { hit: true, candidates };
    }
  }
  return { hit: false, candidates };
}

function hitsObstacleGrid(grid, scratch, step) {
  const candidates = grid.queryAabb(
    Math.min(step.fromX, step.x) - PROJECTILE_RADIUS,
    Math.max(step.fromX, step.x) + PROJECTILE_RADIUS,
    Math.min(step.fromZ, step.z) - PROJECTILE_RADIUS,
    Math.max(step.fromZ, step.z) + PROJECTILE_RADIUS,
    scratch,
  );
  let candidateChecks = 0;
  for (let i = 0; i < candidates.length; i++) {
    const o = candidates[i];
    const b = o.userData.collisionXZ;
    if (!b) continue;
    candidateChecks++;
    const ud = o.userData;
    if ((ud.isProp || ud.containerRef) && step.y > PROP_TOP) continue;
    if (
      step.x > b.minX - PROJECTILE_RADIUS &&
      step.x < b.maxX + PROJECTILE_RADIUS &&
      step.z > b.minZ - PROJECTILE_RADIUS &&
      step.z < b.maxZ + PROJECTILE_RADIUS
    ) {
      return { hit: true, candidates: candidateChecks };
    }
  }
  return { hit: false, candidates: candidateChecks };
}

function time(fn) {
  const start = process.hrtime.bigint();
  const value = fn();
  const end = process.hrtime.bigint();
  return { ms: Number(end - start) / 1e6, value };
}

function verifyCorrectness(obstacles, steps) {
  const grid = new StaticObstacleGrid2D(CELL_SIZE);
  grid.rebuild(obstacles, (o) => o.userData.collisionXZ);
  const scratch = [];
  for (let i = 0; i < Math.min(steps.length, 1500); i++) {
    const naive = hitsObstacleNaive(obstacles, steps[i]).hit;
    const hashed = hitsObstacleGrid(grid, scratch, steps[i]).hit;
    if (naive !== hashed) {
      throw new Error(`Mismatch on step ${i}: naive=${naive} grid=${hashed}`);
    }
  }
}

function runScenario(name, obstacleCount) {
  const obstacles = Array.from({ length: obstacleCount }, (_, i) => makeObstacle(i));
  const steps = Array.from({ length: FRAMES * IMPACTS_PER_FRAME }, () => makeStep());
  verifyCorrectness(obstacles, steps);

  const build = time(() => {
    const grid = new StaticObstacleGrid2D(CELL_SIZE);
    grid.rebuild(obstacles, (o) => o.userData.collisionXZ);
    return grid;
  });
  const grid = build.value;
  const scratch = [];

  const naive = time(() => {
    let hits = 0;
    let candidates = 0;
    for (let i = 0; i < steps.length; i++) {
      const result = hitsObstacleNaive(obstacles, steps[i]);
      if (result.hit) hits++;
      candidates += result.candidates;
    }
    return { hits, candidates };
  });
  const indexed = time(() => {
    let hits = 0;
    let candidates = 0;
    for (let i = 0; i < steps.length; i++) {
      const result = hitsObstacleGrid(grid, scratch, steps[i]);
      if (result.hit) hits++;
      candidates += result.candidates;
    }
    return { hits, candidates };
  });

  const amortizedMs = indexed.ms + (build.ms / FRAMES);
  console.log(`\nScenario: ${name}`);
  console.log(`Obstacles=${obstacleCount}, frames=${FRAMES}, projectiles/frame=${PROJECTILES_PER_FRAME}, steps/projectile=${STEPS_PER_PROJECTILE}`);
  console.log(`Index build:          ${build.ms.toFixed(2)} ms total (${(build.ms / FRAMES).toFixed(4)} ms/frame amortized)`);
  console.log(`Naive wall time:      ${naive.ms.toFixed(2)} ms`);
  console.log(`Indexed wall time:    ${indexed.ms.toFixed(2)} ms (${amortizedMs.toFixed(2)} ms with build amortized)`);
  console.log(`Naive candidates:     ${naive.value.candidates}`);
  console.log(`Indexed candidates:   ${indexed.value.candidates}`);
  console.log(`Hit count match:      ${naive.value.hits === indexed.value.hits}`);
}

console.log(`Projectile obstacle benchmark (${CELL_SIZE}m cells)`);
runScenario('Current-scale', 260);
runScenario('Stress-scale', 720);
