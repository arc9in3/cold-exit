// Esc game menu: Resume, Settings (volume + keybinds), Save, Load, Quit.
// Save/Load round-trip through localStorage under a single key.
import { ACTION_GROUPS, getKeyboardBinding, getGamepadBinding,
         setKeyboardBinding, setGamepadBinding,
         displayKeyboard, displayGamepad,
         resetToDefaults, captureNextGamepadInput } from './keybinds.js';

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
  // Show pause menu directly on the keybinds page — used by the
  // settings → keybinds button so the player doesn't have to click
  // through the root menu.
  showKeybinds() {
    this.visible = true;
    this.view = 'keybinds';
    this.root.style.display = 'flex';
    this.render();
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

    this.bodyEl.appendChild(this._btn('Keybinds', () => { this.view = 'keybinds'; this.render(); }));
    this.bodyEl.appendChild(this._btn('Back', () => { this.view = 'root'; this.render(); }));
  }

  // Keybinds page — every action shown with its current keyboard +
  // gamepad binding. Click a binding cell to enter capture mode; the
  // next keypress (or gamepad button / axis push) becomes the new
  // binding. Press Escape during capture to cancel without changing.
  _renderKeybinds() {
    this.titleEl.textContent = 'Keybinds';
    this.bodyEl.innerHTML = '';

    const note = document.createElement('div');
    note.className = 'menu-row-hint';
    note.style.marginBottom = '6px';
    note.textContent = 'Click a binding to rebind, then press the new key, mouse button (LMB / RMB / MMB / Mouse 4 / Mouse 5), or scroll the wheel. Press Escape during capture to cancel.';
    this.bodyEl.appendChild(note);

    const wrap = document.createElement('div');
    wrap.className = 'keybinds-list';
    this.bodyEl.appendChild(wrap);

    const renderRow = (action, label) => {
      const row = document.createElement('div');
      row.className = 'keybind-row';
      row.innerHTML = `
        <span class="keybind-label">${label}</span>
        <button type="button" class="keybind-cell keybind-kb">${displayKeyboard(getKeyboardBinding(action))}</button>
        <button type="button" class="keybind-cell keybind-gp">${displayGamepad(getGamepadBinding(action))}</button>
      `;
      const kb = row.querySelector('.keybind-kb');
      const gp = row.querySelector('.keybind-gp');
      kb.addEventListener('click', () => this._captureKeyboard(action, kb));
      gp.addEventListener('click', () => this._captureGamepad(action, gp));
      return row;
    };

    for (const group of ACTION_GROUPS) {
      const heading = document.createElement('div');
      heading.className = 'keybind-group';
      heading.textContent = group.title;
      wrap.appendChild(heading);
      for (const [action, label] of group.items) {
        wrap.appendChild(renderRow(action, label));
      }
    }

    const btnRow = document.createElement('div');
    btnRow.className = 'menu-row';
    btnRow.style.marginTop = '8px';
    btnRow.appendChild(this._btn('Reset to Defaults', () => {
      resetToDefaults();
      this.render();
      this._flash('Keybinds reset.');
    }));
    btnRow.appendChild(this._btn('Back', () => { this.view = 'settings'; this.render(); }));
    this.bodyEl.appendChild(btnRow);
  }

  _captureKeyboard(action, cellEl) {
    if (this._capturing) return;
    this._capturing = true;
    cellEl.textContent = '… press key / mouse / wheel';
    cellEl.classList.add('keybind-capturing');
    // Capture races three input sources: keyboard keydown, mouse
    // button (mousedown), and mouse wheel. Whichever fires first
    // becomes the new binding. Escape cancels without changes.
    const cleanup = () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      window.removeEventListener('wheel', onWheel, true);
      this._capturing = false;
    };
    const finish = (code) => {
      cleanup();
      if (code) setKeyboardBinding(action, code);
      cellEl.classList.remove('keybind-capturing');
      this.render();
    };
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') { finish(null); return; }
      finish(e.code);
    };
    const onMouse = (e) => {
      e.preventDefault();
      e.stopPropagation();
      finish(`mouse:${e.button}`);
    };
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) < 0.5) return;
      e.preventDefault();
      e.stopPropagation();
      finish(e.deltaY > 0 ? 'wheel:down' : 'wheel:up');
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  }

  async _captureGamepad(action, cellEl) {
    if (this._capturing) return;
    this._capturing = true;
    cellEl.textContent = '… press a button';
    cellEl.classList.add('keybind-capturing');
    // Race the gamepad capture against an Escape keypress so the user
    // can bail out without a connected pad.
    const escPromise = new Promise((resolve) => {
      const onKey = (e) => {
        if (e.code === 'Escape') {
          window.removeEventListener('keydown', onKey, true);
          resolve('cancel');
        }
      };
      window.addEventListener('keydown', onKey, true);
    });
    const result = await Promise.race([
      captureNextGamepadInput(8000),
      escPromise,
    ]);
    this._capturing = false;
    if (result && result !== 'cancel') {
      setGamepadBinding(action, result);
    }
    this.render();
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
      { key: 'credits', label: 'Most Value', fmt: (e) => e.credits ?? e.score },
      { key: 'levels',  label: 'Furthest',   fmt: (e) => `Lv ${e.levels ?? e.score}` },
      { key: 'damage',  label: 'Most Dmg',   fmt: (e) => e.damage ?? e.score },
      { key: 'kills',   label: 'Most Kills', fmt: (e) => e.kills ?? e.score },
    ];
    // Source badge — flips to GLOBAL or LOCAL once the remote
    // fetches resolve. Same flow as the main-menu leaderboard.
    const badge = document.createElement('div');
    badge.style.cssText = 'font-size:10px;letter-spacing:1.5px;color:#9b8b6a;margin-bottom:6px;text-align:center;';
    badge.textContent = 'loading global scores…';
    this.bodyEl.appendChild(badge);
    const wrap = document.createElement('div');
    wrap.className = 'menu-leaderboard';
    const colByKey = new Map();
    const fillCol = (col, entries, fmt) => {
      col.innerHTML = '';
      const h = document.createElement('div');
      h.className = 'menu-lb-heading';
      h.textContent = col._label;
      col.appendChild(h);
      // Always paint 10 row slots so the panel reads as a true top-10
      // leaderboard. Empty ranks get a dim placeholder.
      const TOP_N = 10;
      for (let i = 0; i < TOP_N; i++) {
        const e = entries && entries[i];
        const row = document.createElement('div');
        row.className = 'menu-lb-row';
        if (e) {
          const who = e.name || e.playerName || 'anon';
          row.textContent = `${i + 1}. ${fmt(e)} — ${who}`;
        } else {
          row.textContent = `${i + 1}. —`;
          row.style.color = '#6a7280';
        }
        col.appendChild(row);
      }
    };
    for (const c of cats) {
      const col = document.createElement('div');
      col.className = 'menu-lb-col';
      col._label = c.label;
      fillCol(col, lb.top(c.key, 10), c.fmt);
      wrap.appendChild(col);
      colByKey.set(c.key, col);
    }
    this.bodyEl.appendChild(wrap);
    this.bodyEl.appendChild(this._btn('Back', () => { this.view = 'root'; this.render(); }));
    // Background remote refresh — replaces each column's content as
    // its fetch resolves. Bails silently if the user navigates away.
    let anyRemote = false;
    let resolved = 0;
    const finalise = () => {
      if (resolved !== cats.length || !badge.parentNode) return;
      badge.textContent = anyRemote ? 'GLOBAL · live scores from cold-exit.pages.dev'
                                    : 'LOCAL · global service unavailable';
      badge.style.color = anyRemote ? '#6abe5a' : '#a88070';
    };
    for (const c of cats) {
      const col = colByKey.get(c.key);
      Promise.resolve(lb.remoteTop(c.key, 10)).then((res) => {
        if (!col || !col.parentNode) return;
        if (res?.source === 'remote') anyRemote = true;
        fillCol(col, res?.entries || [], c.fmt);
        resolved += 1;
        finalise();
      }).catch(() => { resolved += 1; finalise(); });
    }
  }

  render() {
    if (this.view === 'settings') this._renderSettings();
    else if (this.view === 'leaderboard') this._renderLeaderboard();
    else if (this.view === 'keybinds') this._renderKeybinds();
    else this._renderRoot();
  }
}

export const GAME_SAVE_KEY = SAVE_KEY;
