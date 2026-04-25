// Landing screen shown on page load (and re-shown after Quit-to-title).
// Four buttons: Play, Starting Store, Leaderboard, Settings. The play
// button chains into the class-picker; the other three open sub-views
// inline without leaving the menu.
//
// This screen isn't the in-game Esc menu — it's a separate modal that
// owns its own lifecycle. The existing `GameMenuUI` still handles the
// Esc pause / save / load flow during a run.

export class MainMenuUI {
  constructor({ onPlay, onTutorial, onOpenStore, getLeaderboard, getVolume, setVolume,
                getQuality, setQuality, getDevTools, setDevTools,
                getPlayerName, setPlayerName,
                getCharacterStyle, setCharacterStyle }) {
    this.onPlay = onPlay;
    this.onTutorial = onTutorial;
    this.onOpenStore = onOpenStore;
    this.getLeaderboard = getLeaderboard || (() => null);
    this.getVolume = getVolume || (() => 0.7);
    this.setVolume = setVolume || (() => {});
    this.getQuality = getQuality || (() => 'high');
    this.setQuality = setQuality || (() => {});
    this.getDevTools = getDevTools || (() => false);
    this.setDevTools = setDevTools || (() => {});
    this.getPlayerName = getPlayerName || (() => '');
    this.setPlayerName = setPlayerName || (() => {});
    this.getCharacterStyle = getCharacterStyle || (() => 'operator');
    this.setCharacterStyle = setCharacterStyle || (() => {});

    this.visible = false;
    this.view = 'root';   // 'root' | 'settings' | 'leaderboard'

    this.root = document.createElement('div');
    this.root.id = 'main-menu-root';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div id="main-menu-card">
        <div id="main-menu-title">Cold Exit</div>
        <div id="main-menu-subtitle">Extract. Survive. Disappear.</div>
        <div id="main-menu-body"></div>
      </div>
      <div id="main-menu-status">
        prototype build v0.1<br>
        status · nominal
      </div>
    `;
    document.body.appendChild(this.root);
    this.cardEl = this.root.querySelector('#main-menu-card');
    this.bodyEl = this.root.querySelector('#main-menu-body');
    this.titleEl = this.root.querySelector('#main-menu-title');
    this.subEl = this.root.querySelector('#main-menu-subtitle');
    this.statusEl = this.root.querySelector('#main-menu-status');
  }

  show() { this.visible = true; this.view = 'root'; this.root.style.display = 'flex'; this.render(); }
  hide() { this.visible = false; this.root.style.display = 'none'; }
  isOpen() { return this.visible; }

  _btn(label, onClick, extra = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `menu-btn${extra}`;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  _renderRoot() {
    // Root view — splash-art styled rail. The splash image already
    // has "COLD EXIT · EXTRACT. SURVIVE. DISAPPEAR." baked in, so
    // hide the DOM title/subtitle here to avoid duplication. Sub-
    // views (Options / Leaderboard) re-show them as page headers.
    this.titleEl.style.display = 'none';
    this.subEl.style.display = 'none';
    this.cardEl?.classList.remove('nested');
    if (this.statusEl) this.statusEl.style.display = '';
    this.bodyEl.innerHTML = '';

    // Player-name field — lives on the main menu above New Game so
    // it reads like "enter name → start run". Moved from Options
    // because the settings modal was too deep in the UI tree and
    // players were skipping it entirely.
    const nameWrap = document.createElement('div');
    nameWrap.className = 'main-menu-name';
    nameWrap.innerHTML = `
      <label>Codename</label>
      <input type="text" class="menu-input" maxlength="16" placeholder="anonymous" value="${(this.getPlayerName() || '').replace(/"/g, '&quot;')}">
    `;
    const nameInput = nameWrap.querySelector('input');
    nameInput.addEventListener('input', () => this.setPlayerName(nameInput.value));
    this.bodyEl.appendChild(nameWrap);

    // Button names match the splash-art mock. Keep the same
    // callbacks so nothing in the flow changes.
    this.bodyEl.appendChild(this._btn('New Game', () => {
      this.hide();
      this.onPlay?.();
    }));
    this.bodyEl.appendChild(this._btn('Tutorial', () => {
      this.hide();
      this.onTutorial?.();
    }));
    this.bodyEl.appendChild(this._btn('Store', () => {
      this.onOpenStore?.();
    }));
    this.bodyEl.appendChild(this._btn('Leaderboard', () => { this.view = 'leaderboard'; this.render(); }));
    this.bodyEl.appendChild(this._btn('Options',    () => { this.view = 'settings';    this.render(); }));
  }

  _renderSettings() {
    // Nested sub-view — switch to the centred boxed card so form
    // rows read against the splash backdrop, and hide the status
    // line so the overlay reads as "deep into a menu". Title shows
    // again here as a page header; root view hides it (splash image
    // carries the branding).
    this.cardEl?.classList.add('nested');
    if (this.statusEl) this.statusEl.style.display = 'none';
    this.titleEl.style.display = '';
    this.titleEl.textContent = 'Options';
    this.subEl.style.display = 'none';
    this.bodyEl.innerHTML = '';

    const vol = this.getVolume();
    const volRow = document.createElement('div');
    volRow.className = 'menu-row';
    volRow.innerHTML = `
      <label>Master Volume <span class="menu-row-val">${Math.round(vol * 100)}%</span></label>
      <input type="range" min="0" max="100" value="${Math.round(vol * 100)}">
    `;
    const slider = volRow.querySelector('input');
    const valEl  = volRow.querySelector('.menu-row-val');
    slider.addEventListener('input', () => {
      const v = +slider.value / 100;
      this.setVolume(v);
      valEl.textContent = `${slider.value}%`;
    });
    this.bodyEl.appendChild(volRow);

    const muteRow = document.createElement('div');
    muteRow.className = 'menu-row';
    const muted = this.getVolume() <= 0.0001;
    muteRow.innerHTML = `
      <label>Mute <span class="menu-row-val">${muted ? 'On' : 'Off'}</span></label>
      <input type="checkbox" class="menu-check" ${muted ? 'checked' : ''}>
    `;
    const muteCheck = muteRow.querySelector('input');
    const muteVal = muteRow.querySelector('.menu-row-val');
    muteCheck.addEventListener('change', () => {
      if (muteCheck.checked) {
        this._savedVol = this.getVolume() || 0.7;
        this.setVolume(0);
        slider.value = 0;
        valEl.textContent = '0%';
        muteVal.textContent = 'On';
      } else {
        const restore = this._savedVol || 0.7;
        this.setVolume(restore);
        slider.value = Math.round(restore * 100);
        valEl.textContent = `${slider.value}%`;
        muteVal.textContent = 'Off';
      }
    });
    this.bodyEl.appendChild(muteRow);

    const currentQ = this.getQuality();
    const qRow = document.createElement('div');
    qRow.className = 'menu-row';
    qRow.innerHTML = `
      <label>Quality <span class="menu-row-val">${currentQ === 'low' ? 'Low' : 'High'}</span></label>
      <select class="menu-select">
        <option value="high"${currentQ === 'high' ? ' selected' : ''}>High</option>
        <option value="low"${currentQ === 'low'  ? ' selected' : ''}>Low (performance)</option>
      </select>
      <div class="menu-row-hint">AA change needs reload; other effects are live.</div>
    `;
    const sel = qRow.querySelector('select');
    const qValEl = qRow.querySelector('.menu-row-val');
    sel.addEventListener('change', () => {
      this.setQuality(sel.value);
      qValEl.textContent = sel.value === 'low' ? 'Low' : 'High';
    });
    this.bodyEl.appendChild(qRow);

    // Player name lives on the main-menu root now — removed from
    // Options so the naming flow reads as "enter codename → start".

    const devRow = document.createElement('div');
    devRow.className = 'menu-row';
    const devChecked = this.getDevTools() ? 'checked' : '';
    devRow.innerHTML = `
      <label>Dev Tools Panel <span class="menu-row-val">${this.getDevTools() ? 'On' : 'Off'}</span></label>
      <input type="checkbox" class="menu-check" ${devChecked}>
      <div class="menu-row-hint">Live-tunable lil-gui panel. Off by default.</div>
    `;
    const devCheck = devRow.querySelector('input');
    const devValEl = devRow.querySelector('.menu-row-val');
    devCheck.addEventListener('change', () => {
      this.setDevTools(devCheck.checked);
      devValEl.textContent = devCheck.checked ? 'On' : 'Off';
    });
    this.bodyEl.appendChild(devRow);

    // Character style toggle — cosmetic-only, live-applied.
    const styleCurrent = this.getCharacterStyle();
    const styleRow = document.createElement('div');
    styleRow.className = 'menu-row';
    styleRow.innerHTML = `
      <label>Character Style <span class="menu-row-val">${styleCurrent === 'marine' ? 'Space Marine' : 'Operator'}</span></label>
      <select class="menu-select">
        <option value="operator"${styleCurrent === 'operator' ? ' selected' : ''}>Operator (default)</option>
        <option value="marine"${styleCurrent === 'marine' ? ' selected' : ''}>Space Marine</option>
      </select>
      <div class="menu-row-hint">Cosmetic only — pauldrons, power pack, helmet from primitives.</div>
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

  _renderLeaderboard() {
    this.cardEl?.classList.add('nested');
    if (this.statusEl) this.statusEl.style.display = 'none';
    this.titleEl.style.display = '';
    this.titleEl.textContent = 'Leaderboard';
    this.subEl.style.display = 'none';
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
    const wrap = document.createElement('div');
    wrap.className = 'menu-leaderboard';
    // Source badge — switches between "GLOBAL" and "LOCAL" once the
    // remote fetches resolve. Initial render shows local data so the
    // panel isn't empty during the round-trip; remote data overlays
    // each column as it lands.
    const badge = document.createElement('div');
    badge.className = 'menu-lb-source';
    badge.textContent = 'loading global scores…';
    badge.style.cssText = 'font-size:10px;letter-spacing:1.5px;color:#9b8b6a;margin-bottom:6px;text-align:center;';
    this.bodyEl.appendChild(badge);
    const colByKey = new Map();
    for (const c of cats) {
      const col = document.createElement('div');
      col.className = 'menu-lb-col';
      const h = document.createElement('div');
      h.className = 'menu-lb-heading';
      h.textContent = c.label;
      col.appendChild(h);
      // Initial fill — local list so the player isn't staring at a
      // blank panel for the network round-trip.
      this._fillLbCol(col, lb.top(c.key, 10), c.fmt);
      wrap.appendChild(col);
      colByKey.set(c.key, col);
    }
    this.bodyEl.appendChild(wrap);
    this.bodyEl.appendChild(this._btn('Back', () => { this.view = 'root'; this.render(); }));
    // Remote refresh — fire all four categories in parallel, replace
    // the column body with remote entries when each resolves. Falls
    // back silently to the local data we already painted on failure.
    let anyRemote = false;
    let resolved = 0;
    for (const c of cats) {
      const col = colByKey.get(c.key);
      Promise.resolve(lb.remoteTop(c.key, 10)).then((res) => {
        // Bail if the user already navigated away — `col.parentNode`
        // goes null when the body is wiped by a re-render.
        if (!col || !col.parentNode) return;
        if (res?.source === 'remote') anyRemote = true;
        // Re-fill the column with whatever remoteTop returned (remote
        // entries when available, otherwise the same local list).
        col.innerHTML = '';
        const h = document.createElement('div');
        h.className = 'menu-lb-heading';
        h.textContent = c.label;
        col.appendChild(h);
        this._fillLbCol(col, res?.entries || [], c.fmt);
        resolved += 1;
        if (resolved === cats.length && badge.parentNode) {
          badge.textContent = anyRemote ? 'GLOBAL · live scores from cold-exit.pages.dev'
                                        : 'LOCAL · global service unavailable';
          badge.style.color = anyRemote ? '#6abe5a' : '#a88070';
        }
      }).catch(() => {
        resolved += 1;
        if (resolved === cats.length && badge.parentNode) {
          badge.textContent = anyRemote ? 'GLOBAL · live scores from cold-exit.pages.dev'
                                        : 'LOCAL · global service unavailable';
          badge.style.color = anyRemote ? '#6abe5a' : '#a88070';
        }
      });
    }
  }

  _fillLbCol(col, entries, fmt) {
    if (!entries || entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'menu-lb-empty';
      empty.textContent = '—';
      col.appendChild(empty);
      return;
    }
    entries.forEach((e, i) => {
      const row = document.createElement('div');
      row.className = 'menu-lb-row';
      // Remote rows expose `name`; local rows expose `playerName`.
      const who = e.name || e.playerName || 'anon';
      row.textContent = `${i + 1}. ${fmt(e)} — ${who}`;
      col.appendChild(row);
    });
  }

  render() {
    if (this.view === 'settings') this._renderSettings();
    else if (this.view === 'leaderboard') this._renderLeaderboard();
    else this._renderRoot();
  }
}
