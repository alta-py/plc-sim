// ui/js/modbus-tester.js
'use strict';

const MBTESTER = (() => {

  const state = { connected: false, polling: false, scanning: false };

  const DEFAULT_PROFILES = [
    { id: 'p_sim',  name: 'Synkro PLC Simulator', ip: '127.0.0.1',    port: 502, unitId: 1, byteOrder: 'BE', timeout: 3000 },
    { id: 'p_weg',  name: 'Variador WEG CFW500',  ip: '192.168.1.20', port: 502, unitId: 1, byteOrder: 'BE', timeout: 3000 },
    { id: 'p_med',  name: 'Medidor Carlo EM530',  ip: '192.168.1.21', port: 502, unitId: 1, byteOrder: 'BE', timeout: 3000 }
  ];

  let profiles    = JSON.parse(JSON.stringify(DEFAULT_PROFILES));
  let readResults = [];

  // ─────────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────────

  function init() {
    const panel = document.getElementById('tab-modbus-tester');
    panel.innerHTML = _buildHTML();
    _wireEvents();
    _renderHeaderControls();
    _renderProfiles();

    window.electronAPI.onModbusLog((entry) => {
      const lb = document.getElementById('mbLogBody');
      window.utils.appendLog(lb, entry);
    });

    window.electronAPI.onScanResult((result) => {
      _appendScanResult(result);
    });
  }

  // ─────────────────────────────────────────────
  // HTML
  // ─────────────────────────────────────────────

  function _buildHTML() {
    return `
      <div class="mb-layout">

        <!-- LEFT column -->
        <div class="mb-left">

          <div class="card">
            <div class="card-hdr">🔌 Conexión</div>
            <div class="card-body">
              <div class="f-row">
                <span class="f-lbl">IP Address</span>
                <input class="f-inp" id="mbIp" value="127.0.0.1" />
              </div>
              <div class="f-row">
                <span class="f-lbl">Port</span>
                <input class="f-inp" id="mbPort" value="502" style="width:65px;flex:none;" />
                <span class="f-lbl" style="width:50px">Unit ID</span>
                <input class="f-inp" id="mbUnitId" value="1" style="width:50px;flex:none;" />
              </div>
              <div class="f-row">
                <span class="f-lbl">Timeout</span>
                <input class="f-inp" id="mbTimeout" value="3000" style="width:70px;flex:none;" />
                <span style="font-size:10px;color:var(--text3);margin-left:3px">ms</span>
              </div>
              <div class="f-row">
                <span class="f-lbl">Byte Order</span>
                <select class="f-sel" id="mbByteOrder" style="flex:1">
                  <option value="BE">Big Endian</option>
                  <option value="LE">Little Endian</option>
                  <option value="BE_BS">Big Endian Byte Swap</option>
                  <option value="LE_BS">Little Endian Byte Swap</option>
                </select>
              </div>

              <div class="mb-conn-status disconnected" id="mbConnStatus">
                <div class="sdot off" id="mbConnDot"></div>
                <span id="mbConnLabel">Desconectado</span>
              </div>

              <button class="mb-btn-connect" id="mbBtnConnect">Conectar</button>
            </div>
          </div>

          <div class="card" style="margin-top:10px">
            <div class="card-hdr">📋 Perfiles</div>
            <div class="card-body" style="padding:8px">
              <div id="mbProfileList" class="mb-profile-list"></div>
              <button class="btn btn-ghost" id="mbBtnSaveProfile"
                      style="width:100%;margin-top:6px;font-size:11px">
                + Guardar conexión actual
              </button>
            </div>
          </div>

          <div class="card" style="margin-top:10px">
            <div class="card-hdr">🔍 Escaneo de red</div>
            <div class="card-body">
              <div class="f-row" style="margin-bottom:6px">
                <input class="f-inp" id="mbScanStart" value="192.168.1.1"
                       style="font-family:monospace;font-size:11px" />
                <span style="font-size:10px;color:var(--text3);padding:0 4px">→</span>
                <input class="f-inp" id="mbScanEnd" value="192.168.1.254"
                       style="font-family:monospace;font-size:11px;width:130px;flex:none" />
              </div>
              <div class="f-row">
                <span class="f-lbl">Port</span>
                <input class="f-inp" id="mbScanPort" value="502" style="width:65px;flex:none" />
                <button class="btn btn-warning" id="mbBtnScan" style="margin-left:auto">Scan</button>
                <button class="btn btn-ghost" id="mbBtnScanStop" style="display:none">Stop</button>
              </div>
              <div class="mb-scan-results" id="mbScanResults">
                <span style="color:var(--text3);font-size:10px">Esperando escaneo...</span>
              </div>
            </div>
          </div>

        </div>

        <!-- RIGHT column -->
        <div class="mb-right">

          <div class="card mb-rw-card">
            <div class="mb-rw-tabs" id="mbRwTabs">
              <button class="mb-rw-tab active" data-panel="read">Lectura</button>
              <button class="mb-rw-tab" data-panel="write">Escritura</button>
              <div style="margin-left:auto;padding:6px 10px;display:flex;align-items:center;gap:6px">
                <button class="btn btn-ghost" id="mbBtnQuickTest"
                        style="font-size:11px;background:#f5f3ff;color:var(--purple);border-color:#e9d5ff">
                  ⚡ Quick Test All
                </button>
              </div>
            </div>

            <!-- READ panel -->
            <div class="mb-rw-panel active" id="mbPanelRead">
              <div class="mb-rw-body">

                <div class="mb-read-grid">
                  <div class="mb-field">
                    <label>Tipo de registro</label>
                    <select class="f-sel" id="mbRegType">
                      <option value="holding">Holding Registers (4x)</option>
                      <option value="coil">Coils (0x)</option>
                      <option value="discrete">Discrete Inputs (1x)</option>
                      <option value="input">Input Registers (3x)</option>
                    </select>
                  </div>
                  <div class="mb-field">
                    <label>Tipo de dato</label>
                    <select class="f-sel" id="mbDataType">
                      <option value="FLOAT32">FLOAT32</option>
                      <option value="INT16">INT16</option>
                      <option value="UINT16">UINT16</option>
                      <option value="DINT32">DINT32</option>
                      <option value="BOOL">BOOL</option>
                    </select>
                  </div>
                  <div class="mb-field">
                    <label>Dirección inicio</label>
                    <input class="f-inp" id="mbReadAddr" value="40001" />
                  </div>
                  <div class="mb-field">
                    <label>Cantidad</label>
                    <input class="f-inp" id="mbReadCount" value="10" style="width:70px;flex:none" />
                  </div>
                </div>

                <div class="mb-read-actions">
                  <button class="btn btn-primary" id="mbBtnRead">Leer</button>
                  <button class="btn btn-success" id="mbBtnPoll">▶ Polling</button>
                  <select class="f-sel" id="mbPollInterval" style="width:90px">
                    <option value="500">500ms</option>
                    <option value="1000" selected>1000ms</option>
                    <option value="2000">2000ms</option>
                    <option value="5000">5000ms</option>
                  </select>
                  <button class="btn btn-danger" id="mbBtnStopPoll" disabled>■ Stop</button>
                </div>

                <div class="mb-results-wrap">
                  <table class="mb-results-tbl" id="mbResultsTbl">
                    <thead>
                      <tr>
                        <th>Dirección</th><th>Registro</th>
                        <th style="text-align:right">DEC</th>
                        <th>HEX</th><th>BIN</th><th>Timestamp</th>
                      </tr>
                    </thead>
                    <tbody id="mbResultsTbody">
                      <tr>
                        <td colspan="6" style="text-align:center;color:var(--text3);padding:20px;font-size:11px">
                          Sin resultados — hacer click en Leer
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div class="mb-stats-row" id="mbStatsRow">
                  <div class="mb-stat">Requests <span id="mbStatReq">0</span></div>
                  <div class="mb-stat">Errores <span id="mbStatErr">0</span></div>
                  <div class="mb-stat">Último <span id="mbStatLast">—</span></div>
                  <div class="mb-stat">Min <span id="mbStatMin">—</span></div>
                  <div class="mb-stat">Max <span id="mbStatMax">—</span></div>
                  <div class="mb-stat">Prom <span id="mbStatAvg">—</span></div>
                </div>

              </div>
            </div>

            <!-- WRITE panel -->
            <div class="mb-rw-panel" id="mbPanelWrite">
              <div class="mb-rw-body">

                <div class="mb-read-grid">
                  <div class="mb-field">
                    <label>Tipo de registro</label>
                    <select class="f-sel" id="mbWRegType">
                      <option value="holding">Holding Register (FC6)</option>
                      <option value="coil">Coil (FC5)</option>
                    </select>
                  </div>
                  <div class="mb-field">
                    <label>Tipo de dato</label>
                    <select class="f-sel" id="mbWDataType">
                      <option value="FLOAT32">FLOAT32</option>
                      <option value="INT16">INT16</option>
                      <option value="UINT16">UINT16</option>
                      <option value="DINT32">DINT32</option>
                      <option value="BOOL">BOOL</option>
                    </select>
                  </div>
                  <div class="mb-field">
                    <label>Dirección</label>
                    <input class="f-inp" id="mbWriteAddr" value="40001" />
                  </div>
                  <div class="mb-field">
                    <label>Valor</label>
                    <input class="f-inp" id="mbWriteVal" value="0" />
                  </div>
                </div>

                <div class="mb-read-actions">
                  <button class="btn btn-warning" id="mbBtnWrite">Escribir</button>
                </div>

                <div style="margin-top:10px">
                  <div style="font-size:10px;color:var(--text2);font-weight:600;
                              text-transform:uppercase;letter-spacing:0.4px;margin-bottom:5px">
                    Write History
                  </div>
                  <div class="mb-write-hist" id="mbWriteHist">
                    <span style="color:var(--text3);font-size:10px">Sin escrituras</span>
                  </div>
                </div>

              </div>
            </div>
          </div>

          <div class="log-wrap" style="margin-top:10px">
            <div class="log-hdr">
              <span class="log-title">Modbus Log</span>
              <span class="log-count" id="mbLogCount"></span>
              <button class="log-clear"
                onclick="document.getElementById('mbLogBody').innerHTML=''">Clear</button>
            </div>
            <div class="log-body" id="mbLogBody" style="height:72px"></div>
          </div>

        </div>
      </div>
    `;
  }

  // ─────────────────────────────────────────────
  // Wire events
  // ─────────────────────────────────────────────

  function _wireEvents() {
    document.getElementById('mbRwTabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.mb-rw-tab');
      if (!tab) return;
      document.querySelectorAll('.mb-rw-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.mb-rw-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panelKey = tab.dataset.panel.charAt(0).toUpperCase() + tab.dataset.panel.slice(1);
      document.getElementById(`mbPanel${panelKey}`).classList.add('active');
    });

    document.getElementById('mbBtnConnect').addEventListener('click',   _toggleConnect);
    document.getElementById('mbBtnRead').addEventListener('click',      _doRead);
    document.getElementById('mbBtnPoll').addEventListener('click',      _startPolling);
    document.getElementById('mbBtnStopPoll').addEventListener('click',  _stopPolling);
    document.getElementById('mbBtnWrite').addEventListener('click',     _doWrite);
    document.getElementById('mbBtnQuickTest').addEventListener('click', _quickTest);
    document.getElementById('mbBtnScan').addEventListener('click',      _startScan);
    document.getElementById('mbBtnScanStop').addEventListener('click',  _stopScan);
    document.getElementById('mbBtnSaveProfile').addEventListener('click', _saveProfile);
  }

  // ─────────────────────────────────────────────
  // Connect
  // ─────────────────────────────────────────────

  async function _toggleConnect() {
    if (state.connected) {
      await window.electronAPI.modbusDisconnect();
      state.connected = false;
    } else {
      const cfg = _getCfg();
      const btn = document.getElementById('mbBtnConnect');
      btn.textContent = 'Conectando...';
      btn.disabled    = true;

      const result = await window.electronAPI.modbusConnect(cfg);
      btn.disabled    = false;

      if (result.ok) {
        state.connected = true;
      } else {
        alert(`Error de conexión: ${result.error}`);
      }
    }
    _updateConnStatus();
    _updateHeaderControls();
  }

  function _getCfg() {
    return {
      ip:        document.getElementById('mbIp').value.trim(),
      port:      parseInt(document.getElementById('mbPort').value)    || 502,
      unitId:    parseInt(document.getElementById('mbUnitId').value)  || 1,
      byteOrder: document.getElementById('mbByteOrder').value,
      timeout:   parseInt(document.getElementById('mbTimeout').value) || 3000
    };
  }

  function _updateConnStatus() {
    const dot    = document.getElementById('mbConnDot');
    const label  = document.getElementById('mbConnLabel');
    const status = document.getElementById('mbConnStatus');
    const btn    = document.getElementById('mbBtnConnect');

    if (state.connected) {
      dot.className     = 'sdot on';
      label.textContent = `Conectado · ${document.getElementById('mbIp').value}:${document.getElementById('mbPort').value}`;
      status.className  = 'mb-conn-status connected';
      btn.textContent   = 'Desconectar';
      btn.className     = 'mb-btn-connect disconn';
    } else {
      dot.className     = 'sdot off';
      label.textContent = 'Desconectado';
      status.className  = 'mb-conn-status disconnected';
      btn.textContent   = 'Conectar';
      btn.className     = 'mb-btn-connect';
    }
  }

  // ─────────────────────────────────────────────
  // Read
  // ─────────────────────────────────────────────

  async function _doRead() {
    if (!state.connected) { alert('Conectarse primero.'); return; }

    const opts = _getReadOpts();
    const btn  = document.getElementById('mbBtnRead');
    btn.disabled    = true;
    btn.textContent = 'Leyendo...';

    const result = await window.electronAPI.modbusRead(opts);
    btn.disabled    = false;
    btn.textContent = 'Leer';

    if (result.ok) {
      readResults = result.values;
      _renderResults(result.values, result.ms);
      _updateStats();
    } else {
      _showReadError(result.error);
    }
  }

  function _getReadOpts() {
    return {
      registerType: document.getElementById('mbRegType').value,
      dataType:     document.getElementById('mbDataType').value,
      address:      document.getElementById('mbReadAddr').value,
      count:        parseInt(document.getElementById('mbReadCount').value) || 1,
      byteOrder:    document.getElementById('mbByteOrder').value
    };
  }

  function _renderResults(values, ms) {
    const tbody = document.getElementById('mbResultsTbody');
    const ts    = new Date().toLocaleTimeString('es-PY', { hour12: false });

    tbody.innerHTML = values.map(v => `
      <tr>
        <td><span class="plc-addr-b">${v.address}</span></td>
        <td style="font-size:10px;color:var(--text2)">${_regName(v.address)}</td>
        <td style="text-align:right;font-weight:600">${_fmtVal(v.value)}</td>
        <td><span style="font-family:monospace;font-size:10px">${v.hex}</span></td>
        <td><span style="font-family:monospace;font-size:9px;color:var(--text3)">${v.bin}</span></td>
        <td style="font-size:10px;color:var(--text3)">${ts}${ms ? ` (${ms}ms)` : ''}</td>
      </tr>
    `).join('');
  }

  function _showReadError(err) {
    const tbody = document.getElementById('mbResultsTbody');
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--red);padding:16px;font-size:11px">✕ Error: ${window.utils.esc(err)}</td></tr>`;
  }

  function _regName(addr) {
    const n = parseInt(addr);
    if (n >= 40001) return `HR${n - 40001}`;
    if (n >= 30001) return `IR${n - 30001}`;
    if (n >= 10001) return `DI${n - 10001}`;
    return `C${n - 1}`;
  }

  function _fmtVal(v) {
    if (typeof v === 'boolean') return v ? 'ON' : 'OFF';
    if (typeof v === 'number')  return Number.isInteger(v) ? String(v) : v.toFixed(4);
    return String(v);
  }

  // ─────────────────────────────────────────────
  // Polling
  // ─────────────────────────────────────────────

  async function _startPolling() {
    if (!state.connected) { alert('Conectarse primero.'); return; }

    const opts       = _getReadOpts();
    const intervalMs = parseInt(document.getElementById('mbPollInterval').value) || 1000;

    await window.electronAPI.modbusStartPolling(opts, intervalMs);
    state.polling = true;
    _updatePollButtons();

    window.electronAPI.onModbusLog((entry) => {
      if (entry.type === 'pollData' && entry.values) {
        _renderResults(entry.values, entry.ms);
        _updateStats();
      }
    });
  }

  async function _stopPolling() {
    await window.electronAPI.modbusStopPolling();
    state.polling = false;
    _updatePollButtons();
  }

  function _updatePollButtons() {
    const poll = document.getElementById('mbBtnPoll');
    const stop = document.getElementById('mbBtnStopPoll');
    if (poll) poll.disabled = state.polling;
    if (stop) stop.disabled = !state.polling;
  }

  // ─────────────────────────────────────────────
  // Write
  // ─────────────────────────────────────────────

  async function _doWrite() {
    if (!state.connected) { alert('Conectarse primero.'); return; }

    const opts = {
      registerType: document.getElementById('mbWRegType').value,
      dataType:     document.getElementById('mbWDataType').value,
      address:      document.getElementById('mbWriteAddr').value,
      value:        document.getElementById('mbWriteVal').value,
      byteOrder:    document.getElementById('mbByteOrder').value
    };

    const btn = document.getElementById('mbBtnWrite');
    btn.disabled    = true;
    btn.textContent = 'Escribiendo...';

    const result = await window.electronAPI.modbusWrite(opts);
    btn.disabled    = false;
    btn.textContent = 'Escribir';

    _appendWriteHistory(opts, result);
  }

  function _appendWriteHistory(opts, result) {
    const hist = document.getElementById('mbWriteHist');
    if (!hist) return;

    const ts   = new Date().toLocaleTimeString('es-PY', { hour12: false });
    const item = document.createElement('div');
    item.className = `mb-wh-item ${result.ok ? 'ok' : 'err'}`;
    item.innerHTML =
      `<span class="mb-wh-ts">${ts}</span>` +
      `<span class="mb-wh-addr">${opts.address}</span>` +
      `<span class="mb-wh-val">= ${window.utils.esc(String(opts.value))}</span>` +
      `<span class="mb-wh-status">${result.ok ? `✓ OK (${result.ms}ms)` : `✕ ${window.utils.esc(result.error)}`}</span>`;

    hist.prepend(item);
    while (hist.children.length > 50) hist.removeChild(hist.lastChild);
  }

  // ─────────────────────────────────────────────
  // Quick Test
  // ─────────────────────────────────────────────

  async function _quickTest() {
    if (!state.connected) { alert('Conectarse primero.'); return; }

    const tests = [
      { registerType: 'holding', dataType: 'FLOAT32', address: '40001', count: 5, byteOrder: 'BE' },
      { registerType: 'coil',    dataType: 'BOOL',    address: '1',     count: 5, byteOrder: 'BE' }
    ];

    const tbody = document.getElementById('mbResultsTbody');
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--blue);padding:12px;font-size:11px">⚡ Quick Test en progreso...</td></tr>`;

    const allResults = [];
    for (const test of tests) {
      const result = await window.electronAPI.modbusRead(test);
      if (result.ok) allResults.push(...result.values);
    }

    if (allResults.length > 0) {
      _renderResults(allResults, null);
    } else {
      _showReadError('No se pudo leer ningún registro');
    }
  }

  // ─────────────────────────────────────────────
  // Stats
  // ─────────────────────────────────────────────

  function _updateStats() {
    window.electronAPI.modbusGetStatus && window.electronAPI.modbusGetStatus().then(s => {
      if (!s) return;
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('mbStatReq',  s.stats?.requests || 0);
      set('mbStatErr',  s.stats?.errors   || 0);
      set('mbStatLast', s.stats?.lastMs  !== null ? `${s.stats.lastMs}ms`  : '—');
      set('mbStatMin',  s.stats?.minMs   !== null ? `${s.stats.minMs}ms`   : '—');
      set('mbStatMax',  s.stats?.maxMs   !== null ? `${s.stats.maxMs}ms`   : '—');
      const avg = s.stats?.requests > 0 ? Math.round(s.stats.totalMs / s.stats.requests) : 0;
      set('mbStatAvg',  s.stats?.requests > 0 ? `${avg}ms` : '—');
    });
  }

  // ─────────────────────────────────────────────
  // Scan
  // ─────────────────────────────────────────────

  async function _startScan() {
    if (state.scanning) return;
    state.scanning = true;

    document.getElementById('mbBtnScan').style.display     = 'none';
    document.getElementById('mbBtnScanStop').style.display = 'inline-block';

    const scanResults = document.getElementById('mbScanResults');
    scanResults.innerHTML = '<span style="color:var(--blue);font-size:10px">Escaneando...</span>';

    await window.electronAPI.modbusScan({
      startIp:    document.getElementById('mbScanStart').value.trim(),
      endIp:      document.getElementById('mbScanEnd').value.trim(),
      port:       parseInt(document.getElementById('mbScanPort').value) || 502,
      timeout:    500,
      concurrent: 20
    });
  }

  async function _stopScan() {
    await window.electronAPI.modbusScanStop();
    state.scanning = false;
    document.getElementById('mbBtnScan').style.display     = 'inline-block';
    document.getElementById('mbBtnScanStop').style.display = 'none';
  }

  function _appendScanResult(result) {
    const container = document.getElementById('mbScanResults');
    const placeholder = container.querySelector('span');
    if (placeholder && placeholder.textContent.includes('Escaneando')) placeholder.remove();

    const item = document.createElement('div');
    item.className = 'mb-scan-item';
    item.innerHTML =
      `<span class="sdot on" style="width:7px;height:7px;flex-shrink:0"></span>` +
      `<span class="mb-scan-ip">${result.ip}</span>` +
      `<span class="mb-scan-ms">respondió en ${result.ms}ms</span>` +
      `<button class="btn btn-ghost" style="font-size:10px;padding:1px 7px"
               onclick="MBTESTER_useIp('${result.ip}')">Usar</button>`;

    container.appendChild(item);
  }

  window.MBTESTER_useIp = function(ip) {
    document.getElementById('mbIp').value = ip;
  };

  // ─────────────────────────────────────────────
  // Profiles
  // ─────────────────────────────────────────────

  function _renderProfiles() {
    const list = document.getElementById('mbProfileList');
    list.innerHTML = profiles.map(p => `
      <div class="mb-profile-item" data-id="${p.id}">
        <div class="mb-profile-dot"></div>
        <div style="flex:1">
          <div class="mb-profile-name">${window.utils.esc(p.name)}</div>
          <div class="mb-profile-meta">${p.ip}:${p.port} · Unit ${p.unitId}</div>
        </div>
        <button class="mb-profile-del" data-id="${p.id}">✕</button>
      </div>
    `).join('');

    list.querySelectorAll('.mb-profile-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('mb-profile-del')) return;
        const p = profiles.find(x => x.id === item.dataset.id);
        if (p) _applyProfile(p);
      });
    });

    list.querySelectorAll('.mb-profile-del').forEach(btn => {
      btn.addEventListener('click', () => {
        profiles = profiles.filter(p => p.id !== btn.dataset.id);
        _renderProfiles();
      });
    });
  }

  function _applyProfile(p) {
    document.getElementById('mbIp').value        = p.ip;
    document.getElementById('mbPort').value       = p.port;
    document.getElementById('mbUnitId').value     = p.unitId;
    document.getElementById('mbByteOrder').value  = p.byteOrder || 'BE';
    document.getElementById('mbTimeout').value    = p.timeout   || 3000;
  }

  function _saveProfile() {
    const cfg  = _getCfg();
    const name = prompt('Nombre del perfil:', `Dispositivo ${cfg.ip}`);
    if (!name) return;
    profiles.push({ id: `p_${Date.now()}`, name, ...cfg });
    _renderProfiles();
  }

  // ─────────────────────────────────────────────
  // Header controls
  // ─────────────────────────────────────────────

  function _renderHeaderControls() {
    const ctrl = document.getElementById('headerControls');
    if (!ctrl) return;
    ctrl.innerHTML = `
      <div class="srv-badge">
        <div class="sdot off" id="mbHdrDot"></div>
        <span id="mbHdrLabel">Desconectado</span>
      </div>
      <button class="hbtn start" id="mbHdrBtn">Conectar</button>
    `;
    document.getElementById('mbHdrBtn').addEventListener('click', _toggleConnect);
  }

  function _updateHeaderControls() {
    const dot   = document.getElementById('mbHdrDot');
    const label = document.getElementById('mbHdrLabel');
    const btn   = document.getElementById('mbHdrBtn');
    if (!dot) return;

    if (state.connected) {
      dot.className     = 'sdot on';
      label.textContent = `${document.getElementById('mbIp').value}:${document.getElementById('mbPort').value}`;
      btn.textContent   = 'Desconectar';
      btn.className     = 'hbtn stop';
    } else {
      dot.className     = 'sdot off';
      label.textContent = 'Desconectado';
      btn.textContent   = 'Conectar';
      btn.className     = 'hbtn start';
    }
  }

  return { init };

})();

window.MBTESTER = MBTESTER;

document.addEventListener('DOMContentLoaded', () => {
  const panel = document.getElementById('tab-modbus-tester');
  if (panel) MBTESTER.init();
});
