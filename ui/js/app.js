// ui/js/app.js
'use strict';

// ─────────────────────────────────────────────
// Tab switching
// ─────────────────────────────────────────────

document.getElementById('headerTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.htab');
  if (!btn) return;

  const tabId = btn.dataset.tab;

  document.querySelectorAll('.htab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`tab-${tabId}`).classList.add('active');

  window.dispatchEvent(new CustomEvent('tabSwitch', { detail: { tabId } }));
});

// ─────────────────────────────────────────────
// Menu events from main process
// ─────────────────────────────────────────────

window.electronAPI.onMenuNew(    ()   => window.dispatchEvent(new CustomEvent('menu:new')));
window.electronAPI.onMenuOpen(   (fp) => window.dispatchEvent(new CustomEvent('menu:open',   { detail: fp })));
window.electronAPI.onMenuSave(   ()   => window.dispatchEvent(new CustomEvent('menu:save')));
window.electronAPI.onMenuSaveAs( ()   => window.dispatchEvent(new CustomEvent('menu:saveAs')));

// ─────────────────────────────────────────────
// Utility functions (global)
// ─────────────────────────────────────────────

window.utils = {

  fmtTs(isoStr) {
    try {
      return new Date(isoStr).toLocaleTimeString('es-PY', { hour12: false });
    } catch (_) {
      return isoStr?.slice(11, 19) || '';
    }
  },

  appendLog(logBody, entry, maxLines = 200) {
    if (!logBody) return;

    const ts  = window.utils.fmtTs(entry.ts);
    const cls = {
      ok:    'log-ok',
      err:   'log-err',
      conn:  'log-conn',
      read:  'log-rw',
      write: 'log-wr',
      pub:   'log-pub',
      info:  ''
    }[entry.type] || '';

    const line = document.createElement('div');
    line.innerHTML = `<span class="log-ts">${ts}</span> ` +
                     (cls ? `<span class="${cls}">` : '') +
                     window.utils.esc(entry.msg) +
                     (cls ? '</span>' : '');

    logBody.appendChild(line);

    while (logBody.children.length > maxLines) logBody.removeChild(logBody.firstChild);

    const parent = logBody.parentElement;
    if (parent && parent.scrollHeight - parent.scrollTop < parent.clientHeight + 60) {
      logBody.scrollIntoView({ behavior: 'instant', block: 'end' });
    }
  },

  esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  async copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = '✓ Copiado';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      }
    } catch (_) {}
  },

  show(el, visible = true) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (el) el.style.display = visible ? '' : 'none';
  },

  async getLocalIps() {
    return window.electronAPI.getLocalIps();
  },

  async readProfile(exts, title) {
    const filePath = await window.electronAPI.openDialog({ exts, title });
    if (!filePath) return null;
    const result = await window.electronAPI.readFile({ filePath });
    if (!result.ok) return null;
    try { return { filePath, data: JSON.parse(result.content) }; } catch (_) { return null; }
  },

  async saveProfile(data, defaultName, ext, title) {
    const filePath = await window.electronAPI.saveDialog({ defaultName, ext, title });
    if (!filePath) return null;
    const content = JSON.stringify(data, null, 2);
    const result  = await window.electronAPI.writeFile({ filePath, content });
    return result.ok ? filePath : null;
  }
};
