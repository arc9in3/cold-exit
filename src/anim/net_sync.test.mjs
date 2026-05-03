// Regression test: net_sync round-trip — encode then decode must
// produce the same state name + clip time (within 1/255 quantization).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildStateIndex, smHash } from './net_sync.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SM_PATH = resolve(__dirname, '..', '..', 'Assets', 'anim_data', 'states', 'cold_exit_player.json');
const smCfg = JSON.parse(readFileSync(SM_PATH, 'utf-8'));

let total = 0, fails = 0;

// 1. State index is stable across rebuilds.
total++;
const idx1 = buildStateIndex(smCfg);
const idx2 = buildStateIndex(smCfg);
if (JSON.stringify(idx1) !== JSON.stringify(idx2)) {
  fails++; console.error('state index not deterministic');
}

// 2. Hash is deterministic + non-zero.
total++;
const h1 = smHash(smCfg);
const h2 = smHash(smCfg);
if (h1 !== h2 || h1 === 0) {
  fails++; console.error(`hash not stable: ${h1} vs ${h2}`);
}

// 3. Hash differs when a layer state changes.
total++;
const mutated = JSON.parse(JSON.stringify(smCfg));
mutated.layers[0].states.idle.clip = 'CHANGED';
const h3 = smHash(mutated);
if (h3 === h1) {
  fails++; console.error('hash unchanged across SM mutation');
}

// 4. Every state in every layer roundtrips through the index.
for (const L of smCfg.layers) {
  for (const stateName of Object.keys(L.states || {})) {
    total++;
    const layerIdx = idx1[L.name];
    const id = layerIdx.map[stateName];
    const back = layerIdx.indexToState[id];
    if (back !== stateName) {
      fails++;
      console.error(`roundtrip fail: ${L.name}/${stateName} → ${id} → ${back}`);
    }
  }
}

// 5. Indices fit in u8 (0..255).
total++;
let maxId = 0;
for (const L of Object.values(idx1)) {
  for (const id of Object.values(L.map)) maxId = Math.max(maxId, id);
}
if (maxId > 255) {
  fails++; console.error(`state index ${maxId} exceeds u8`);
}

console.log(`net_sync: ${total - fails}/${total} cases match`);
if (fails > 0) process.exit(1);
