import { SKILLS } from './skills.js';

// Shown when the player extracts. Presents 3 random skill options. Picking
// one levels it up and resolves a promise so the caller can regenerate the
// next level.
export class SkillPickUI {
  constructor(skills) {
    this.skills = skills;
    this.root = document.createElement('div');
    this.root.id = 'skill-pick-root';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div id="skill-pick-card">
        <div id="skill-pick-title">Choose a skill</div>
        <div id="skill-pick-options"></div>
      </div>
    `;
    document.body.appendChild(this.root);
    this.optionsEl = this.root.querySelector('#skill-pick-options');
  }

  async show() {
    const ids = this.skills.randomOffers(3);
    if (ids.length === 0) return null; // nothing to offer, proceed
    this.root.style.display = 'flex';
    this.optionsEl.innerHTML = '';
    return new Promise((resolve) => {
      for (const id of ids) {
        const s = SKILLS[id]; if (!s) continue;
        const curLv = this.skills.level(id);
        const nextLv = curLv + 1;
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'skill-card';
        card.innerHTML = `
          <div class="skill-card-ico">${s.icon}</div>
          <div class="skill-card-name">${s.name}</div>
          <div class="skill-card-level">Lv ${curLv} → ${nextLv}</div>
          <div class="skill-card-desc">${s.descriptionAt(nextLv)}</div>
        `;
        card.addEventListener('click', () => {
          this.skills.levelUp(id);
          this.root.style.display = 'none';
          resolve(id);
        });
        this.optionsEl.appendChild(card);
      }
    });
  }
}
