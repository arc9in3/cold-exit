// Shared stack-split modal. Replaces window.prompt and is mounted as
// a singleton — opening a new one dismisses the previous so back-to-
// back splits don't stack overlays. Used by ui_inventory.js,
// ui_loot.js, and ui_shop.js so the gesture (shift+right-click on a
// stack) feels identical regardless of which surface the player is in.
//
// Usage:
//   import { openSplitModal } from './ui_split_modal.js';
//   openSplitModal(item, count, (n) => { /* move/sell/take n items */ });
//
// The callback fires with the peel count (1..count-1). It does NOT
// fire on cancel / escape / outside-click. Each caller decides what
// to do with the peel: split into the inventory, push to body loot,
// sell to the shop, etc. The caller is responsible for adjusting the
// source stack's count.

let _splitModalEl = null;

export function openSplitModal(item, count, onConfirm) {
  if (count <= 1) return;
  if (_splitModalEl) {
    _splitModalEl.remove();
    _splitModalEl = null;
  }
  const def = Math.ceil(count / 2);
  const overlay = document.createElement('div');
  overlay.className = 'split-modal-overlay';
  overlay.innerHTML = `
    <div class="split-modal-card">
      <div class="split-modal-title">SPLIT STACK</div>
      <div class="split-modal-name">${item.name || 'Stack'}</div>
      <div class="split-modal-count">Stack size: <b>${count}</b></div>
      <div class="split-modal-row">
        <button type="button" class="split-modal-step" data-step="-1">−</button>
        <input type="number" class="split-modal-input"
               min="1" max="${count - 1}" step="1" value="${def}">
        <button type="button" class="split-modal-step" data-step="+1">+</button>
      </div>
      <div class="split-modal-buttons">
        <button type="button" class="split-modal-cancel">Cancel</button>
        <button type="button" class="split-modal-ok">Split</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  _splitModalEl = overlay;
  const input = overlay.querySelector('.split-modal-input');
  input.focus();
  input.select();
  const close = () => {
    if (_splitModalEl === overlay) _splitModalEl = null;
    overlay.remove();
  };
  const confirm = () => {
    const n = Math.max(1, Math.min(count - 1, parseInt(input.value, 10) || 0));
    close();
    try { onConfirm(n); } catch (e) { console.warn('[split-modal] onConfirm threw', e); }
  };
  overlay.querySelector('.split-modal-ok').addEventListener('click', confirm);
  overlay.querySelector('.split-modal-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) close();   // outside-click closes
  });
  overlay.querySelectorAll('.split-modal-step').forEach((btn) => {
    btn.addEventListener('click', () => {
      const step = parseInt(btn.dataset.step, 10) || 0;
      const cur = parseInt(input.value, 10) || def;
      input.value = String(Math.max(1, Math.min(count - 1, cur + step)));
      input.focus();
    });
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); confirm(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); close(); }
  });
}
