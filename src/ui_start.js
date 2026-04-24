// Starter-loadout picker shown on new game. Asks the player which
// weapon class they want as their starting weapon, then hands control
// back to main.js via the onPick callback.

const CLASS_CHOICES = [
  { id: 'pistol',  label: 'Pistol',   hint: 'Sidearm — fast, short range' },
  { id: 'smg',     label: 'SMG',      hint: 'High fire rate, close range' },
  { id: 'shotgun', label: 'Shotgun',  hint: 'Pellets, brutal at close range' },
  { id: 'rifle',   label: 'Rifle',    hint: 'Balanced — medium range' },
  { id: 'sniper',  label: 'Sniper',   hint: 'One-shot potential, long range' },
  { id: 'lmg',     label: 'LMG',      hint: 'Big mag, slow reload, suppression' },
  { id: 'melee',   label: 'Melee',    hint: 'Blades / bludgeons, no ammo' },
];

export class StartUI {
  constructor({ onPick }) {
    this.onPick = onPick;
    this.visible = false;
    this.root = document.createElement('div');
    this.root.id = 'start-root';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div id="start-card">
        <div id="start-title">Choose your starting weapon</div>
        <div id="start-subtitle">You'll spawn with a small pack, basic clothes, and a common-rarity weapon of your chosen class.</div>
        <div id="start-grid"></div>
      </div>
    `;
    document.body.appendChild(this.root);
    this.gridEl = this.root.querySelector('#start-grid');
    for (const c of CLASS_CHOICES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'start-choice';
      b.innerHTML = `<div class="start-choice-label">${c.label}</div><div class="start-choice-hint">${c.hint}</div>`;
      b.addEventListener('click', () => {
        this.hide();
        this.onPick?.(c.id);
      });
      this.gridEl.appendChild(b);
    }
  }
  show() { this.visible = true; this.root.style.display = 'flex'; }
  hide() { this.visible = false; this.root.style.display = 'none'; }
  isOpen() { return this.visible; }
}
