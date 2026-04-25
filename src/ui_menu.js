// Esc game menu: Resume, Settings (volume), Save, Load, Quit.
// Save/Load round-trip through localStorage under a single key.

const SAVE_KEY = 'tacticalrogue_save_v1';

export class GameMenuUI {
  constructor({ onSave, onLoad, onQuit, getVolume, setVolume, getQuality, setQuality, getLeaderboard,
                getDevTools, setDevTools, getPlayerName: gpn, setPlayerName: spn,
                getCharacterStyle: gcs, setCharacterStyle: scs }) {
    this.onSave = onSave;
    this.onLoad = onLoad;
    this.onQuit = onQuit;
    this.getVolume = getVolume || (() => 0.7);
    this.setVolume = setVolume || (() => {});
    this.getQuality = getQuality || (() => 'high');
    this.setQuality = setQuality || (() => {});
    this.getLeaderboard = getLeaderboard || (() => null);
    this.getDevTools = getDevTools || (() => false);
    this.setDevTools = setDevTools || (() => {});
    this.getPlayerName = gpn || (() => '');
    this.setPlayerName = spn || (() => {});
    this.getCharacterStyle = gcs || (() => 'operator');
    this.setCharacterStyle = scs || (() => {});
    this.visible = false;
    this.view = 'root';   // 'root' | 'settings' | 'leaderboard'

    this.root = document.createElement('div');
    this.root.id = 'menu-root';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div id="menu-card">
        <div id="menu-title">Game Menu</div>
        <div id="menu-body"></div>
        <div id="menu-footer">Esc to resume</div>
      </div>
    `;
    document.body.appendChild(this.root);
    this.bodyEl = this.root.querySelector('#menu-body');
    this.titleEl = this.root.querySelector('#menu-title');
  }

  toggle() {
    this.visible = !this.visible;
    this.view = 'root';
    this.root.style.display = this.visible ? 'flex' : 'none';
    if (this.visible) this.render();
  }
  isOpen() { return this.visible; }
  hide() { this.visible = false; this.root.style.display = 'none'; }

  _btn(label, onClick, extra = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `menu-btn${extra}`;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  _renderRoot() {
    this.titleEl.textContent = 'Game Menu';
    this.bodyEl.innerHTML = '';
    this.bodyEl.appendChild(this._btn('Resume', () => this.toggle()));
    this.bodyEl.appendChild(this._btn('Settings', () => { this.view = 'settings'; this.render(); }));
    this.bodyEl.appendChild(this._btn('Leaderboard', () => { this.view = 'leaderboard'; this.render(); }));
    // Save / Load are gated behind the dev-tools toggle (Options →
    // Dev Tools Panel). They taint the run's leaderboard eligibility
    // anyway, so hiding them from default players keeps the run loop
    // honest; devs with the toggle on keep the buttons for
    // debugging.
    if (this.getDevTools && this.getDevTools()) {
      this.bodyEl.appendChild(this._btn('Save (dev)', () => {
        try {
          const s = this.onSave?.();
          if (s) localStorage.setItem(SAVE_KEY, JSON.stringify(s));
          this._flash('Saved.');
        } catch (e) {
          this._flash('Save failed.');
        }
      }));
      this.bodyEl.appendChild(this._btn('Load (dev)', () => {
        try {
          const raw = localStorage.getItem(SAVE_KEY);
          if (!raw) { this._flash('No save found.'); return; }
          this.onLoad?.(JSON.parse(raw));
          this._flash('Loaded.');
        } catch (e) {
          this._flash('Load failed.');
        }
      }));
    }
    this.bodyEl.appendChild(this._btn('Quit to Title', () => {
      if (this.onQuit) this.onQuit();
    }, ' danger'));
  }

  _renderSettings() {
    this.titleEl.textContent = 'Settings';
    this.bodyEl.innerHTML = '';
    const vol = this.getVolume();

    const row = document.createElement('div');
    row.className = 'menu-row';
    row.innerHTML = `
      <label>Master Volume <span class="menu-row-val">${Math.round(vol * 100)}%</span></label>
      <input type="range" min="0" max="100" value="${Math.round(vol * 100)}">
    `;
    const slider = row.querySelector('input');
    const valEl  = row.querySelector('.menu-row-val');
    slider.addEventListener('input', () => {
      const v = +slider.value / 100;
      this.setVolume(v);
      valEl.textContent = `${slider.value}%`;
    });
    this.bodyEl.appendChild(row);

    // Quality toggle — applies live for everything except antialiasing
    // (which requires reload since it's a WebGLRenderer construction
    // option). A small note below the dropdown flags that caveat.
    const currentQ = this.getQuality();
    const qRow = document.createElement('div');
    qRow.className = 'menu-row';
    qRow.innerHTML = `
      <label>Quality <span class="menu-row-val">${currentQ === 'low' ? 'Low' : 'High'}</span></label>
      <select class="menu-select">
        <option value="high"${currentQ === 'high' ? ' selected' : ''}>High (shadows + AA + outlines)</option>
        <option value="low"${currentQ === 'low' ? ' selected' : ''}>Low (performance mode)</option>
      </select>
      <div class="menu-row-hint">Switching to/from Low takes full effect after a reload (antialiasing).</div>
    `;
    const sel = qRow.querySelector('select');
    const qValEl = qRow.querySelector('.menu-row-val');
    sel.addEventListener('change', () => {
      this.setQuality(sel.value);
      qValEl.textContent = sel.value === 'low' ? 'Low' : 'High';
    });
    this.bodyEl.appendChild(qRow);

    // Player name — shown on leaderboard entries. Short input, trimmed
    // and clamped to 16 chars inside setPlayerName.
    const nameRow = document.createElement('div');
    nameRow.className = 'menu-row';
    nameRow.innerHTML = `
      <label>Player Name</label>
      <input type="text" class="menu-input" maxlength="16" value="${(this.getPlayerName() || '').replace(/"/g, '&quot;')}">
    `;
    const nameInput = nameRow.querySelector('input');
    nameInput.addEventListener('input', () => this.setPlayerName(nameInput.value));
    this.bodyEl.appendChild(nameRow);

    // Dev tools toggle — hides/shows the lil-gui tunables panel. Off
    // by default so a shipped prototype stays uncluttered; flip on to
    // iterate on values live.
    const devRow = document.createElement('div');
    devRow.className = 'menu-row';
    const devChecked = this.getDevTools() ? 'checked' : '';
    devRow.innerHTML = `
      <label>Dev Tools Panel <span class="menu-row-val">${this.getDevTools() ? 'On' : 'Off'}</span></label>
      <input type="checkbox" class="menu-check" ${devChecked}>
      <div class="menu-row-hint">Shows the live tunables panel (lil-gui) for tweaking values on the fly.</div>
    `;
    const devCheck = devRow.querySelector('input');
    const devValEl = devRow.querySelector('.menu-row-val');
    devCheck.addEventListener('change', () => {
      this.setDevTools(devCheck.checked);
      devValEl.textContent = devCheck.checked ? 'On' : 'Off';
    });
    this.bodyEl.appendChild(devRow);

    // Character style — operator vs. primitive-space-marine silhouette.
    // Recolours materials + toggles decoration visibility live.
    const styleCurrent = this.getCharacterStyle();
    const styleRow = document.createElement('div');
    styleRow.className = 'menu-row';
    styleRow.innerHTML = `
      <label>Character Style <span class="menu-row-val">${styleCurrent === 'marine' ? 'Space Marine' : 'Operator'}</span></label>
      <select class="menu-select">
        <option value="operator"${styleCurrent === 'operator' ? ' selected' : ''}>Operator (default)</option>
        <option value="marine"${styleCurrent === 'marine' ? ' selected' : ''}>Space Marine</option>
      </select>
    `;
    const styleSel = styleRow.querySelector('select');
    const styleValEl = styleRow.querySelector('.menu-row-val');
    styleSel.addEventListener('change', () => {
      this.setCharacterStyle(styleSel.value);
      styleValEl.textContent = styleSel.value === 'marine' ? 'Space Marine' : 'Operator';
    });
    this.bodyEl.appendChild(styleRow);

    this.bodyEl.appendChild(this._btn('Back', () => { this.view = 'root'; this.render(); }));
  }

  _flash(text) {
    const f = document.createElement('div');
    f.className = 'menu-flash';
    f.textContent = text;
    this.bodyEl.appendChild(f);
    setTimeout(() => f.remove(), 1400);
  }

  _renderLeaderboard() {
    this.titleEl.textContent = 'Leaderboard';
    this.bodyEl.innerHTML = '';
    const lb = this.getLeaderboard();
    if (!lb) {
      this.bodyEl.appendChild(document.createTextNode('Leaderboard unavailable.'));
      this.bodyEl.appendChild(this._btn('Back', () => { this.view = 'root'; this.render(); }));
      return;
    }
    const cats = [
      { key: 'credits', label: 'Most Value', fmt: (e) => e.credits },
      { key: 'levels',  label: 'Furthest',   fmt: (e) => `Lv ${e.levels}` },
      { key: 'damage',  label: 'Most Dmg',   fmt: (e) => e.damage },
      { key: 'kills',   label: 'Most Kills', fmt: (e) => e.kills },
    ];
    const wrap = document.createElement('div');
    wrap.className = 'menu-leaderboard';
    for (const c of cats) {
      const top = lb.top(c.key, 10);
      const col = document.createElement('div');
      col.className = 'menu-lb-col';
      const h = document.createElement('div');
      h.className = 'menu-lb-heading';
      h.textContent = c.label;
      col.appendChild(h);
      if (top.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'menu-lb-empty';
        empty.textContent = '—';
        col.appendChild(empty);
      } else {
        top.forEach((e, i) => {
          const row = document.createElement('div');
          row.className = 'menu-lb-row';
          row.textContent = `${i + 1}. ${c.fmt(e)} — ${e.playerName}`;
          col.appendChild(row);
        });
      }
      wrap.appendChild(col);
    }
    this.bodyEl.appendChild(wrap);
    this.bodyEl.appendChild(this._btn('Back', () => { this.view = 'root'; this.render(); }));
  }

  render() {
    if (this.view === 'settings') this._renderSettings();
    else if (this.view === 'leaderboard') this._renderLeaderboard();
    else this._renderRoot();
  }
}

export const GAME_SAVE_KEY = SAVE_KEY;
