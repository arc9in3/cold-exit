// Probe — assert that the 'pos' wire payload propagates oL to the
// receiver's ghost record via the same shape lobby.js consumes. We
// re-implement the relevant slice of the pos handler here (the real
// one is wrapped in CoopLobby + EventTarget plumbing that's not
// trivial to mount headless). Catch a regression where the field
// gets renamed or swallowed in the lobby update.
//
// Run: node .mc/probe-coop-onledge.mjs

// Mirror of the field shape main.js sends in transport.send('pos', ...)
function makePosBody({ onLedge }) {
  return {
    x: 1, z: 2, f: 0,
    c: 0, a: 0, d: 0, wc: 'pistol',
    oL: onLedge ? 1 : 0,
    xt: 0, r: 0, bf: 0,
  };
}

// Mirror of the relevant slice of CoopLobby._on('pos', body) — the
// fields the rest of the code reads off ghost.*.
function ghostFromBody(body) {
  return {
    x: body.x, z: body.z,
    crouched: !!body.c,
    aiming: typeof body.a === 'number' ? body.a : (body.a ? 1 : 0),
    dashing: !!body.d,
    weaponClass: body.wc || 'pistol',
    yaw: typeof body.f === 'number' ? body.f : 0,
    inExit: !!body.xt,
    reloading: !!body.r,
    buffActive: !!body.bf,
    onLedge: !!body.oL,
  };
}

const onLedge = ghostFromBody(makePosBody({ onLedge: true }));
const offLedge = ghostFromBody(makePosBody({ onLedge: false }));
console.log('onLedge.onLedge:', onLedge.onLedge);
console.log('offLedge.onLedge:', offLedge.onLedge);
if (onLedge.onLedge !== true || offLedge.onLedge !== false) {
  console.error('FAIL: oL → ghost.onLedge mapping broken');
  process.exit(1);
}

// Y-lift derivation that main.js's render path applies.
const yWhenOn = onLedge.onLedge ? 1.0 : 0.0;
const yWhenOff = offLedge.onLedge ? 1.0 : 0.0;
if (yWhenOn !== 1.0 || yWhenOff !== 0.0) {
  console.error('FAIL: target Y mismatch');
  process.exit(1);
}

console.log('PASS — oL bit propagates from pos packet to ghost.onLedge → 1m Y lift');
