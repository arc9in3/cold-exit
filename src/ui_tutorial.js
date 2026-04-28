// Tutorial overlay — a stepped checklist pinned to the top-right of
// the screen during a tutorial run. Each step shows a target action
// (Move with WASD, Fire with LMB, etc.); ticks off when the player
// performs it. When every step is done, a "head for the green exit"
// prompt highlights at the bottom of the list.
//
// State flow:
//   markStep(id) — called from main.js when the player does the
//                  matching action. Idempotent; same step won't tick
//                  twice. Auto-progresses focus to the next unticked
//                  step.
//   isComplete() — returns true once every step is ticked.
//   show()/hide() — toggle visibility (called by the tutorial run
//                   start / exit paths).
//
// Visual is pure DOM — no canvas redraws so the overlay cost is one
// re-render per step transition.

// Tutorial curriculum — ordered roughly easy → advanced. The focus
// arrow points to the first unticked step, so a slow learner can do
// them in order; a power user can complete them in any order.
const STEPS = [
  { id: 'move',       label: 'Move (WASD)' },
  { id: 'crouch',     label: 'Crouch (C) — quieter footsteps, harder to detect' },
  { id: 'dash',       label: 'Dash to dodge (Space) — i-frames mid-dash' },
  { id: 'ads',        label: 'Aim Down Sights — hold RMB to focus + cursor anywhere on the dummy' },
  { id: 'shoot_head', label: 'Headshot — aim at the dummy\'s head and fire (massive bonus damage)' },
  { id: 'shoot_leg',  label: 'Leg shot — hit the dummy\'s leg to slow them' },
  { id: 'disarm',     label: 'Disarm — shoot the dummy\'s GUN ARM to make them drop their weapon' },
  { id: 'melee',      label: 'Quick Melee (F) — close-range knife strike' },
  { id: 'reload',     label: 'Reload (R) — top up the magazine' },
  { id: 'inventory',  label: 'Open Inventory (Tab) — manage gear, pockets, attachments' },
  { id: 'pickup',     label: 'Pick up loot (E) — walk over the dropped item near you' },
  { id: 'container',  label: 'Open the supply crate (E) — grab consumables + a grenade' },
  { id: 'heal',       label: 'Quick heal (H) — uses a bandage / medkit from your kit' },
  { id: 'throwable',  label: 'Throw a grenade (5-8 hotbar) — area damage from the kit' },
  { id: 'stealth',    label: 'Stealth — crouch + close to the FAR dummy without being detected' },
  { id: 'extract',    label: 'Walk into the green extract zone' },
];

export class TutorialUI {
  constructor() {
    this._done = new Set();
    this.root = document.createElement('div');
    this.root.id = 'tutorial-overlay';
    Object.assign(this.root.style, {
      position: 'fixed',
      top: '14px',
      right: '14px',
      width: '280px',
      maxHeight: '88vh',
      overflowY: 'auto',
      padding: '12px 14px',
      background: 'rgba(20, 24, 32, 0.92)',
      border: '1px solid #c9a87a',
      borderRadius: '4px',
      color: '#f2e7c9',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '11px',
      letterSpacing: '1px',
      boxShadow: '0 0 18px rgba(201,168,122,0.30), 0 6px 24px rgba(0,0,0,0.7)',
      pointerEvents: 'none',
      zIndex: '60',
      display: 'none',
    });
    document.body.appendChild(this.root);
    this._render();
  }

  show() {
    this.root.style.display = 'block';
    this._render();
  }
  hide() {
    this.root.style.display = 'none';
  }
  reset() {
    this._done.clear();
    this._render();
  }

  // Mark a step complete. No-op if id not in the registry or step
  // already done. Caller doesn't need to guard duplicates.
  markStep(id) {
    if (!STEPS.some(s => s.id === id)) return;
    if (this._done.has(id)) return;
    this._done.add(id);
    this._render();
  }

  isComplete() {
    return STEPS.every(s => this._done.has(s.id));
  }

  isStepDone(id) { return this._done.has(id); }

  _render() {
    // Find the first unticked step — that's the active focus.
    const focusIdx = STEPS.findIndex(s => !this._done.has(s.id));
    const allDone = focusIdx === -1;
    const head = `<div style="font-size: 11px; color: #c9a87a; letter-spacing: 2px; text-transform: uppercase; font-weight: 700; margin-bottom: 8px; text-align: center;">Tutorial</div>`;
    const rows = STEPS.map((s, i) => {
      const done = this._done.has(s.id);
      const focus = !done && i === focusIdx;
      const mark = done ? '✓' : (focus ? '▸' : '·');
      const color = done ? '#6abe5a'
                  : focus ? '#ffd27a'
                  : '#6f6754';
      const fontWeight = focus ? '700' : '400';
      return `<div style="display:flex; gap:8px; padding:2px 0; color:${color}; font-weight:${fontWeight};">
        <span style="width:14px; text-align:center;">${mark}</span>
        <span>${s.label}</span>
      </div>`;
    }).join('');
    const footer = allDone
      ? `<div style="margin-top: 10px; padding: 6px 8px; background: rgba(106,190,90,0.15); border: 1px solid #6abe5a; border-radius: 3px; color: #6abe5a; text-align: center; font-weight: 700;">All steps done — extract!</div>`
      : `<div style="margin-top: 10px; font-size: 9px; color: #6f6754; text-align: center;">Esc to skip · returns to main menu</div>`;
    this.root.innerHTML = head + rows + footer;
  }
}
