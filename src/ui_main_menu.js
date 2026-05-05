// Landing screen shown on page load (and re-shown after Quit-to-title).
// Four buttons: Play, Starting Store, Leaderboard, Settings. The play
// button chains into the class-picker; the other three open sub-views
// inline without leaving the menu.
//
// This screen isn't the in-game Esc menu — it's a separate modal that
// owns its own lifecycle. The existing `GameMenuUI` still handles the
// Esc pause / save / load flow during a run.

export class MainMenuUI {
  constructor({ onPlay, onQuickStart, onTutorial, onOpenStore, onOpenHideout,
                getLeaderboard, getVolume, setVolume,
                getQuality, setQuality, getDevTools, setDevTools,
                getMusicEnabled, setMusicEnabled,
                getPlayerName, setPlayerName,
                getCharacterStyle, setCharacterStyle,
                onGrantAllCurrencies, onClearSaveData,
                onOpenSquadLobby, getCoopMode, setCoopMode }) {
    this.onPlay = onPlay;
    this.onQuickStart = onQuickStart;
    this.onTutorial = onTutorial;
    this.onOpenStore = onOpenStore;
    this.onOpenHideout = onOpenHideout;
    this.getLeaderboard = getLeaderboard || (() => null);
    this.getVolume = getVolume || (() => 0.7);
    this.setVolume = setVolume || (() => {});
    this.getQuality = getQuality || (() => 'high');
    this.setQuality = setQuality || (() => {});
    this.getDevTools = getDevTools || (() => false);
    this.setDevTools = setDevTools || (() => {});
    this.getMusicEnabled = getMusicEnabled || (() => true);
    this.setMusicEnabled = setMusicEnabled || (() => {});
    this.getPlayerName = getPlayerName || (() => '');
    this.setPlayerName = setPlayerName || (() => {});
    this.getCharacterStyle = getCharacterStyle || (() => 'operator');
    this.setCharacterStyle = setCharacterStyle || (() => {});
    // Account-debug hooks. Optional — when not wired, the settings
    // section is hidden so production builds don't ship the buttons.
    this.onGrantAllCurrencies = onGrantAllCurrencies || null;
    this.onClearSaveData = onClearSaveData || null;
    this.onOpenSquadLobby = onOpenSquadLobby || null;
    this.getCoopMode = getCoopMode || (() => 'solo');
    this.setCoopMode = setCoopMode || (() => {});

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

    // Mode pick — primary surface of the title screen. SOLO leads
    // (default + always available); SQUAD is the secondary mode and
    // routes to the lobby branch when wired. The selected value
    // persists to localStorage('coop:mode') so the title remembers
    // the player's last choice.
    const curMode = this.getCoopMode() || 'solo';
    const modeWrap = document.createElement('div');
    modeWrap.className = 'main-menu-modes';
    modeWrap.innerHTML = `
      <div class="mode-pick-label">CHOOSE A MODE</div>
    `;
    const soloBtn = this._btn('▶ SOLO', () => {
      this.setCoopMode('solo');
      this.hide();
      this.onOpenHideout?.();
    }, ' primary mode-solo');
    const squadBtn = this._btn('SQUAD', () => {
      this.setCoopMode('squad');
      // Squad lobby is wired separately. Until the lobby ships, fall
      // back to opening the hideout with a small "coming soon" toast
      // so the title isn't a dead end.
      if (this.onOpenSquadLobby) {
        this.hide();
        this.onOpenSquadLobby();
      } else {
        try { window.__hudMsg?.('Squad lobby — coming soon. Drop into Solo for now.', 3.5); } catch (_) {}
        this.setCoopMode('solo');
        this.hide();
        this.onOpenHideout?.();
      }
    }, ' mode-squad');
    if (curMode === 'squad') {
      // Last-chosen-was-squad — flip the visual emphasis so the player
      // sees their previous pick highlighted but can still re-choose.
      soloBtn.classList.remove('primary');
      squadBtn.classList.add('primary');
      squadBtn.firstChild.textContent = '▶ SQUAD';
      soloBtn.firstChild.textContent = 'SOLO';
    }
    modeWrap.appendChild(soloBtn);
    modeWrap.appendChild(squadBtn);
    this.bodyEl.appendChild(modeWrap);

    // Secondary actions kept reachable without leaving the title.
    this.bodyEl.appendChild(this._btn('Tutorial', () => {
      this.hide();
      this.onTutorial?.();
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

    // Music toggle — independent of master volume + mute. When off,
    // sfx.musicPlay short-circuits + any active track is faded out.
    const musicOn = this.getMusicEnabled();
    const musicRow = document.createElement('div');
    musicRow.className = 'menu-row';
    musicRow.innerHTML = `
      <label>Music <span class="menu-row-val">${musicOn ? 'On' : 'Off'}</span></label>
      <input type="checkbox" class="menu-check" ${musicOn ? 'checked' : ''}>
    `;
    const musicCheck = musicRow.querySelector('input');
    const musicVal = musicRow.querySelector('.menu-row-val');
    musicCheck.addEventListener('change', () => {
      const on = musicCheck.checked;
      this.setMusicEnabled(on);
      musicVal.textContent = on ? 'On' : 'Off';
    });
    this.bodyEl.appendChild(musicRow);

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
    const styleLabels = {
      operator: 'Operator',
      marine: 'Space Marine',
      recon: 'Recon',
      juggernaut: 'Juggernaut',
      wraith: 'Wraith',
    };
    const styleCurrent = this.getCharacterStyle();
    const curLabel = styleLabels[styleCurrent] || 'Operator';
    const styleRow = document.createElement('div');
    styleRow.className = 'menu-row';
    const optHtml = Object.entries(styleLabels).map(([k, l]) =>
      `<option value="${k}"${styleCurrent === k ? ' selected' : ''}>${l}</option>`
    ).join('');
    styleRow.innerHTML = `
      <label>Character Style <span class="menu-row-val">${curLabel}</span></label>
      <select class="menu-select">${optHtml}</select>
      <div class="menu-row-hint">Cosmetic only — palette swap on the procgen rig.</div>
    `;
    const styleSel = styleRow.querySelector('select');
    const styleValEl = styleRow.querySelector('.menu-row-val');
    styleSel.addEventListener('change', () => {
      this.setCharacterStyle(styleSel.value);
      styleValEl.textContent = styleLabels[styleSel.value] || 'Operator';
    });
    this.bodyEl.appendChild(styleRow);

    // Account Debug — only rendered when the hooks are wired in
    // main.js. Two destructive actions: grant every currency to a
    // capped value, and wipe all `tacticalrogue:*` localStorage
    // keys. Both run from the existing options modal so the player
    // doesn't need a console.
    if (this.onGrantAllCurrencies || this.onClearSaveData) {
      const debugHeader = document.createElement('div');
      debugHeader.className = 'menu-row';
      debugHeader.style.cssText = 'border-top: 1px solid rgba(155, 139, 106, 0.25); padding-top: 14px; margin-top: 8px;';
      debugHeader.innerHTML = `
        <label style="color:#f2c060; letter-spacing: 2px;">ACCOUNT DEBUG</label>
        <div class="menu-row-hint">Destructive — only use for testing.</div>
      `;
      this.bodyEl.appendChild(debugHeader);

      if (this.onGrantAllCurrencies) {
        const grantRow = document.createElement('div');
        grantRow.className = 'menu-row';
        const grantBtn = document.createElement('button');
        grantBtn.type = 'button';
        grantBtn.className = 'menu-btn';
        grantBtn.textContent = 'Grant All Currencies';
        const grantStatus = document.createElement('span');
        grantStatus.className = 'menu-row-val';
        grantStatus.textContent = '';
        grantBtn.addEventListener('click', () => {
          let summary;
          try { summary = this.onGrantAllCurrencies(); }
          catch (e) { grantStatus.textContent = 'failed'; return; }
          grantStatus.textContent = summary || 'granted';
          grantStatus.style.color = '#6abe5a';
          setTimeout(() => { grantStatus.textContent = ''; grantStatus.style.color = ''; }, 4000);
        });
        grantRow.appendChild(grantBtn);
        grantRow.appendChild(grantStatus);
        this.bodyEl.appendChild(grantRow);
      }

      if (this.onClearSaveData) {
        const clearRow = document.createElement('div');
        clearRow.className = 'menu-row';
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'menu-btn';
        clearBtn.textContent = 'Clear Save Data';
        clearBtn.style.color = '#c94a3a';
        const clearStatus = document.createElement('span');
        clearStatus.className = 'menu-row-val';
        clearStatus.textContent = '';
        // Two-stage confirm — first click arms, second click within
        // 4 seconds actually wipes. Avoids a popup but still gates
        // accidental clicks.
        let armed = false;
        let armedTimer = null;
        clearBtn.addEventListener('click', () => {
          if (!armed) {
            armed = true;
            clearBtn.textContent = 'CONFIRM — wipe all save data?';
            clearStatus.textContent = 'click again to confirm';
            clearStatus.style.color = '#d0a030';
            armedTimer = setTimeout(() => {
              armed = false;
              clearBtn.textContent = 'Clear Save Data';
              clearStatus.textContent = '';
              clearStatus.style.color = '';
            }, 4000);
            return;
          }
          if (armedTimer) clearTimeout(armedTimer);
          armed = false;
          let summary;
          try { summary = this.onClearSaveData(); }
          catch (e) { clearStatus.textContent = 'failed'; return; }
          clearBtn.textContent = 'Clear Save Data';
          clearStatus.textContent = summary || 'wiped — reload page';
          clearStatus.style.color = '#6abe5a';
        });
        clearRow.appendChild(clearBtn);
        clearRow.appendChild(clearStatus);
        this.bodyEl.appendChild(clearRow);
      }
    }

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
    // Always paint 10 row slots so the panel reads as a true top-10
    // leaderboard. Filled entries take ranks 1..N; empty ranks N+1..10
    // get a dim placeholder so the player can see the leaderboard has
    // headroom and where their next run could land.
    const TOP_N = 10;
    for (let i = 0; i < TOP_N; i++) {
      const e = entries && entries[i];
      const row = document.createElement('div');
      row.className = 'menu-lb-row';
      if (e) {
        const who = e.name || e.playerName || 'anon';
        const tag = (e.meta && e.meta.mythicRun) || e.mythicRun ? ' (mythic run)' : '';
        row.textContent = `${i + 1}. ${fmt(e)} — ${who}${tag}`;
      } else {
        row.textContent = `${i + 1}. —`;
        row.style.color = '#6a7280';
      }
      col.appendChild(row);
    }
  }

  render() {
    if (this.view === 'settings') this._renderSettings();
    else if (this.view === 'leaderboard') this._renderLeaderboard();
    else this._renderRoot();
  }
}
