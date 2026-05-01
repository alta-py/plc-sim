// ui/js/plc-sim.js
'use strict';

const PLCSIM = (() => {

  const state = {
    running:   false,
    clients:   0,
    filePath:  null,
    modified:  false,
    validated: false,
    errors:    []
  };

  const DEFAULT_BITS = Array.from({ length: 5 }, (_, i) => ({
    id:      `b${i}`,
    address: String(i + 1).padStart(5, '0'),
    label:   `M${i}`,
    value:   false,
    access:  'rw',
    enabled: true
  }));

  const DEFAULT_REGS = Array.from({ length: 5 }, (_, i) => ({
    id:       `r${i}`,
    address:  String(40001 + i * 2),
    label:    `HR${i}`,
    dataType: 'FLOAT32',
    value:    0,
    access:   'rw',
    enabled:  true
  }));

  const DEFAULT_SIGS = [
    { id: 's0', address: '00021', label: 'Sim_Bit_1',   registerType: 'coil',    dataType: 'BOOL',    signalType: 'blink',     params: { period: 2 },                       interval: 1000, running: false },
    { id: 's1', address: '00022', label: 'Sim_Bit_2',   registerType: 'coil',    dataType: 'BOOL',    signalType: 'blinkFast', params: { period: 2 },                       interval: 200,  running: false },
    { id: 's2', address: '40041', label: 'Sim_Temp',    registerType: 'holding', dataType: 'FLOAT32', signalType: 'sine',      params: { min: 20, max: 90, period: 30 },    interval: 1000, running: false },
    { id: 's3', address: '40043', label: 'Sim_Presion', registerType: 'holding', dataType: 'FLOAT32', signalType: 'square',    params: { low: 2.0, high: 6.0, period: 20 }, interval: 1000, running: false },
    { id: 's4', address: '40045', label: 'Sim_Nivel',   registerType: 'holding', dataType: 'FLOAT32', signalType: 'triangle',  params: { min: 0, max: 100, period: 60 },    interval: 1000, running: false }
  ];

  let bits = JSON.parse(JSON.stringify(DEFAULT_BITS));
  let regs = JSON.parse(JSON.stringify(DEFAULT_REGS));
  let sigs = JSON.parse(JSON.stringify(DEFAULT_SIGS));

  const MAX_BITS = 20;
  const MAX_REGS = 20;
  const MAX_SIGS = 10;

  let _refreshTimer = null;

  // ─────────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────────

  function init() {
    const panel = document.getElementById('tab-plc-sim');
    panel.innerHTML = _buildHTML();
    _wireEvents();
    _renderHeaderControls();
    _renderBits();
    _renderRegs();
    _renderSigs();
    _updateFooter();
    _updateValidationBanner();

    window.electronAPI.onPlcLog((entry) => {
      const lb = document.getElementById('plcLogBody');
      window.utils.appendLog(lb, entry);
    });

    window.electronAPI.onPlcState((s) => {
      state.running = s.running;
      state.clients = s.clients;
      _updateStatus();
      _updateHeaderControls();
      if (s.running) _startRefresh();
      else           _stopRefresh();
    });

    window.addEventListener('menu:new',    () => _newProfile());
    window.addEventListener('menu:save',   () => _saveProfile());
    window.addEventListener('menu:saveAs', () => _saveProfileAs());
    window.addEventListener('menu:open',   (e) => _loadProfileFromPath(e.detail));
  }

  // ─────────────────────────────────────────────
  // HTML shell
  // ─────────────────────────────────────────────

  function _buildHTML() {
    return `
      <div class="info-bar">
        <span>🖥</span>
        Simulador Modbus TCP. Sección 1: bits ON/OFF manual. Sección 2: registros con valor manual. Sección 3: señales automáticas.
        <div class="info-hint">
          Conectar a: <strong id="plcConnHint">127.0.0.1 : 502</strong>
          <button class="copy-btn" id="plcCopyHint">Copiar</button>
        </div>
      </div>

      <div id="plcValBanner" style="display:none"></div>

      <div class="plc-main">

        <!-- BITS -->
        <div class="plc-section">
          <div class="plc-sec-hdr">
            <div class="plc-sec-icon" style="background:#374151">B</div>
            <span class="plc-sec-title">Bits Manuales</span>
            <span class="plc-sec-sub">— Coils · ON / OFF manual</span>
            <span class="plc-sec-count" id="plcBitsCount">5/20</span>
          </div>
          <div class="plc-sec-body">
            <div class="plc-bits-grid" id="plcBitsGrid"></div>
          </div>
          <div class="plc-sec-footer">
            <button class="btn btn-ghost" id="plcAddBit">+ Agregar bit</button>
            <span class="plc-max-hint">Máx. ${MAX_BITS} bits</span>
          </div>
        </div>

        <!-- REGISTERS -->
        <div class="plc-section">
          <div class="plc-sec-hdr">
            <div class="plc-sec-icon" style="background:#0066FF">R</div>
            <span class="plc-sec-title">Registros Manuales</span>
            <span class="plc-sec-sub">— INT16 · FLOAT32 · DINT32</span>
            <div class="plc-sec-hdr-right">
              <span style="font-size:10px;color:var(--text2)">Byte Order:</span>
              <select class="plc-byte-sel" id="plcByteOrder">
                <option value="BE">Big Endian</option>
                <option value="LE">Little Endian</option>
                <option value="BE_BS">Big Endian Byte Swap</option>
                <option value="LE_BS">Little Endian Byte Swap</option>
              </select>
              <span class="plc-sec-count" id="plcRegsCount">5/20</span>
            </div>
          </div>
          <div class="plc-sec-body">
            <table class="plc-reg-tbl">
              <thead>
                <tr>
                  <th>Dirección</th><th>Label</th><th>Tipo</th><th>Acceso</th>
                  <th style="text-align:right">DEC</th><th>HEX</th><th>BIN</th>
                  <th>Nuevo valor</th><th></th>
                </tr>
              </thead>
              <tbody id="plcRegsTbody"></tbody>
            </table>
          </div>
          <div class="plc-sec-footer">
            <button class="btn btn-ghost" id="plcAddReg">+ Agregar registro</button>
            <span class="plc-max-hint">Máx. ${MAX_REGS} registros</span>
          </div>
        </div>

        <!-- SIGNALS -->
        <div class="plc-section">
          <div class="plc-sec-hdr">
            <div class="plc-sec-icon" style="background:#c95f00">∿</div>
            <span class="plc-sec-title">Señales Automáticas</span>
            <span class="plc-sec-sub">— Configurar → Start → generan solas · Solo R</span>
            <span class="plc-sec-count" id="plcSigsCount">5/10</span>
          </div>
          <div class="plc-sec-body">
            <table class="plc-sig-tbl">
              <thead>
                <tr>
                  <th>Estado</th><th>Dirección</th><th>Label</th>
                  <th>Tipo reg.</th><th>Señal</th><th>Parámetros</th>
                  <th style="text-align:right">Valor</th><th>Acciones</th>
                </tr>
              </thead>
              <tbody id="plcSigsTbody"></tbody>
            </table>
          </div>
          <div class="plc-sec-footer">
            <button class="btn btn-ghost" id="plcAddSigBit">+ Señal bit</button>
            <button class="btn btn-ghost" id="plcAddSigReg">+ Señal registro</button>
            <button class="btn" style="background:#f0fdf4;color:var(--green);border:1px solid #bbf7d0"
                    id="plcStartAll">▶ Start All</button>
            <button class="btn" style="background:#fef2f2;color:var(--red);border:1px solid #fecaca"
                    id="plcStopAll">■ Stop All</button>
            <span class="plc-max-hint">Máx. ${MAX_SIGS} señales</span>
          </div>
        </div>

        <!-- LOG -->
        <div class="log-wrap">
          <div class="log-hdr">
            <span class="log-title">Activity Log</span>
            <span class="log-count" id="plcLogCount"></span>
            <button class="log-clear"
              onclick="document.getElementById('plcLogBody').innerHTML=''">Clear</button>
          </div>
          <div class="log-body" id="plcLogBody" style="height:64px"></div>
        </div>

      </div>

      <!-- Footer -->
      <div class="app-footer">
        <span class="footer-filename" id="plcFooterFilename">Sin guardar</span>
        <div class="footer-btns">
          <button class="fbtn" id="plcBtnOpen">📂 Abrir</button>
          <button class="fbtn primary" id="plcBtnSave">💾 Guardar</button>
          <button class="fbtn" id="plcBtnSaveAs">Guardar como...</button>
          <button class="fbtn danger" id="plcBtnReset">⊘ Reset</button>
          <button class="fbtn start-sim" id="plcBtnStartStop" disabled>
            ▶ Iniciar Simulación
          </button>
        </div>
      </div>
    `;
  }

  // ─────────────────────────────────────────────
  // Wire events
  // ─────────────────────────────────────────────

  function _wireEvents() {
    document.getElementById('plcCopyHint').addEventListener('click', (e) => {
      const hint = document.getElementById('plcConnHint').textContent;
      window.utils.copyText(hint.replace(/ /g, ''), e.currentTarget);
    });

    document.getElementById('plcAddBit').addEventListener('click', () => {
      if (bits.length >= MAX_BITS) return;
      const lastAddr = bits.length ? parseInt(bits[bits.length - 1].address) + 1 : 1;
      bits.push({ id: `b${Date.now()}`, address: String(lastAddr).padStart(5,'0'), label: `M${bits.length}`, value: false, access: 'rw', enabled: true });
      _renderBits();
      _validate();
    });

    document.getElementById('plcAddReg').addEventListener('click', () => {
      if (regs.length >= MAX_REGS) return;
      const last = regs[regs.length - 1];
      const inc  = last ? (last.dataType === 'INT16' ? 1 : 2) : 0;
      const next = last ? parseInt(last.address) + inc : 40001;
      regs.push({ id: `r${Date.now()}`, address: String(next), label: `HR${regs.length}`, dataType: 'FLOAT32', value: 0, access: 'rw', enabled: true });
      _renderRegs();
      _validate();
    });

    document.getElementById('plcAddSigBit').addEventListener('click', () => {
      if (sigs.length >= MAX_SIGS) return;
      const last = sigs.filter(s => s.registerType === 'coil').slice(-1)[0];
      const addr = last ? parseInt(last.address) + 1 : 21;
      sigs.push({ id: `s${Date.now()}`, address: String(addr).padStart(5,'0'), label: `Sim_Bit_${sigs.length}`, registerType: 'coil', dataType: 'BOOL', signalType: 'blink', params: { period: 2 }, interval: 1000, running: false });
      _renderSigs();
    });

    document.getElementById('plcAddSigReg').addEventListener('click', () => {
      if (sigs.length >= MAX_SIGS) return;
      const last = sigs.filter(s => s.registerType === 'holding').slice(-1)[0];
      const addr = last ? parseInt(last.address) + 2 : 40041;
      sigs.push({ id: `s${Date.now()}`, address: String(addr), label: `Sim_Reg_${sigs.length}`, registerType: 'holding', dataType: 'FLOAT32', signalType: 'sine', params: { min: 0, max: 100, period: 30 }, interval: 1000, running: false });
      _renderSigs();
    });

    document.getElementById('plcStartAll').addEventListener('click', async () => {
      for (const sig of sigs) { if (!sig.running) await _startSignal(sig.id); }
    });

    document.getElementById('plcStopAll').addEventListener('click', async () => {
      for (const sig of sigs) { if (sig.running) await _stopSignal(sig.id); }
    });

    document.getElementById('plcBtnStartStop').addEventListener('click', _toggleServer);
    document.getElementById('plcBtnOpen').addEventListener('click',      _openProfile);
    document.getElementById('plcBtnSave').addEventListener('click',      _saveProfile);
    document.getElementById('plcBtnSaveAs').addEventListener('click',    _saveProfileAs);
    document.getElementById('plcBtnReset').addEventListener('click',     _resetProfile);
  }

  // ─────────────────────────────────────────────
  // Bits rendering
  // ─────────────────────────────────────────────

  function _renderBits() {
    const grid = document.getElementById('plcBitsGrid');
    grid.innerHTML = bits.map(b => `
      <div class="plc-bit-row ${b._err ? 'err' : 'ok'}" data-id="${b.id}">
        <span class="plc-bit-addr ${b._err ? 'err' : ''}">${b.address}</span>
        <input class="plc-bit-label" value="${window.utils.esc(b.label)}"
               onchange="PLCSIM_updateBit('${b.id}','label',this.value)" />
        <select class="plc-rw-sel"
                onchange="PLCSIM_updateBit('${b.id}','access',this.value)">
          <option value="rw" ${b.access==='rw'?'selected':''}>R/W</option>
          <option value="r"  ${b.access==='r' ?'selected':''}>R</option>
        </select>
        <span class="plc-bit-val ${b.value?'on':'off'}">${b.value?'ON':'OFF'}</span>
        <div class="toggle" onclick="PLCSIM_toggleBit('${b.id}')">
          <div class="trk ${b.value?'on':''}"><div class="tth" style="${b.value?'left:17px':''}"></div></div>
        </div>
      </div>
    `).join('');

    const addBtn = document.getElementById('plcAddBit');
    if (addBtn) addBtn.disabled = bits.length >= MAX_BITS;

    const count = document.getElementById('plcBitsCount');
    if (count) count.textContent = `${bits.length}/${MAX_BITS}`;
  }

  // ─────────────────────────────────────────────
  // Registers rendering
  // ─────────────────────────────────────────────

  function _renderRegs() {
    const tbody = document.getElementById('plcRegsTbody');
    tbody.innerHTML = regs.map(r => `
      <tr class="${r._err ? 'plc-row-err' : ''}" data-id="${r.id}">
        <td><span class="plc-addr-b ${r._err?'err':''}">${r.address}</span></td>
        <td><input class="plc-label-inp" value="${window.utils.esc(r.label)}"
                   onchange="PLCSIM_updateReg('${r.id}','label',this.value)" /></td>
        <td>
          <select class="plc-type-sel"
                  onchange="PLCSIM_updateReg('${r.id}','dataType',this.value)">
            <option value="FLOAT32" ${r.dataType==='FLOAT32'?'selected':''}>FLOAT32</option>
            <option value="INT16"   ${r.dataType==='INT16'  ?'selected':''}>INT16</option>
            <option value="DINT32"  ${r.dataType==='DINT32' ?'selected':''}>DINT32</option>
          </select>
        </td>
        <td>
          <select class="plc-rw-sel"
                  onchange="PLCSIM_updateReg('${r.id}','access',this.value)">
            <option value="rw" ${r.access==='rw'?'selected':''}>R/W</option>
            <option value="r"  ${r.access==='r' ?'selected':''}>R</option>
          </select>
        </td>
        <td style="text-align:right">
          <span class="plc-val-cur" id="plcval-${r.id}">${_fmt(r.value, r.dataType)}</span>
        </td>
        <td><span class="plc-val-hex" id="plchex-${r.id}">${_toHex(r.value, r.dataType)}</span></td>
        <td><span class="plc-val-bin" id="plcbin-${r.id}">${_toBin(r.value, r.dataType)}</span></td>
        <td>
          <input class="plc-new-val" id="plcnew-${r.id}" value="${_fmt(r.value, r.dataType)}"
                 onkeydown="if(event.key==='Enter') PLCSIM_setReg('${r.id}')" />
        </td>
        <td style="display:flex;gap:3px;padding:5px 8px">
          <button class="btn btn-primary btn-sm" onclick="PLCSIM_setReg('${r.id}')">Set</button>
          <button class="btn btn-ghost  btn-sm" onclick="PLCSIM_zeroReg('${r.id}')">0</button>
        </td>
      </tr>
    `).join('');

    const addBtn = document.getElementById('plcAddReg');
    if (addBtn) addBtn.disabled = regs.length >= MAX_REGS;

    const count = document.getElementById('plcRegsCount');
    if (count) count.textContent = `${regs.length}/${MAX_REGS}`;
  }

  // ─────────────────────────────────────────────
  // Signals rendering
  // ─────────────────────────────────────────────

  function _renderSigs() {
    const tbody = document.getElementById('plcSigsTbody');
    const SIGNAL_LABELS = {
      sine: 'Senoidal', square: 'Onda Cuadrada', triangle: 'Triangular',
      ramp: 'Rampa', randomWalk: 'Random Walk', blink: 'Blink Normal',
      blinkFast: 'Blink Fast', blinkSlow: 'Blink Slow',
      counter: 'Contador', step: 'Escalón'
    };
    const SIG_CLASSES = {
      sine: 'sig-sine', square: 'sig-square', triangle: 'sig-triangle',
      ramp: 'sig-ramp', randomWalk: 'sig-walk', blink: 'sig-blink',
      blinkFast: 'sig-blink-f', blinkSlow: 'sig-blink-s',
      counter: 'sig-counter', step: 'sig-step'
    };

    tbody.innerHTML = sigs.map(sig => {
      const params    = _renderSigParams(sig);
      const typeBadge = sig.registerType === 'coil'
        ? '<span class="tb" style="background:#f3f4f6;color:#374151">BOOL</span>'
        : `<span class="tb tb-f32">${sig.dataType}</span>`;

      return `
        <tr data-id="${sig.id}">
          <td>
            <div class="plc-run-ind">
              <div class="plc-run-dot ${sig.running ? 'running' : 'stopped'}"></div>
              <span class="plc-run-lbl ${sig.running ? 'running' : 'stopped'}">
                ${sig.running ? 'Running' : 'Stopped'}
              </span>
            </div>
          </td>
          <td><span class="plc-addr-b">${sig.address}</span></td>
          <td>
            <input class="plc-label-inp" value="${window.utils.esc(sig.label)}"
                   style="width:100px"
                   onchange="PLCSIM_updateSig('${sig.id}','label',this.value)" />
          </td>
          <td>${typeBadge}</td>
          <td>
            <select class="plc-sig-type-sel"
                    onchange="PLCSIM_updateSig('${sig.id}','signalType',this.value)">
              ${Object.entries(SIGNAL_LABELS).map(([v, l]) =>
                `<option value="${v}" ${sig.signalType===v?'selected':''}
                  class="${SIG_CLASSES[v]||''}">${l}</option>`
              ).join('')}
            </select>
          </td>
          <td class="plc-params-cell">${params}</td>
          <td style="text-align:right;font-weight:700;font-size:12px"
              id="sigval-${sig.id}">—</td>
          <td style="display:flex;gap:4px;padding:6px 8px">
            ${sig.running
              ? `<button class="btn btn-danger btn-sm"
                         onclick="PLCSIM_stopSig('${sig.id}')">Stop</button>`
              : `<button class="btn btn-success btn-sm"
                         onclick="PLCSIM_startSig('${sig.id}')">Start</button>`
            }
            <button class="btn btn-ghost btn-sm"
                    onclick="PLCSIM_cfgSig('${sig.id}')">⚙</button>
          </td>
        </tr>
      `;
    }).join('');

    const count = document.getElementById('plcSigsCount');
    if (count) count.textContent = `${sigs.length}/${MAX_SIGS}`;
  }

  function _renderSigParams(sig) {
    const p = sig.params || {};
    switch (sig.signalType) {
      case 'sine':       return `<span class="plc-chip">min ${p.min??0}</span><span class="plc-chip">max ${p.max??100}</span><span class="plc-chip">T=${p.period??30}s</span>`;
      case 'square':     return `<span class="plc-chip">low ${p.low??0}</span><span class="plc-chip">high ${p.high??100}</span><span class="plc-chip">T=${p.period??20}s</span>`;
      case 'triangle':   return `<span class="plc-chip">min ${p.min??0}</span><span class="plc-chip">max ${p.max??100}</span><span class="plc-chip">T=${p.period??60}s</span>`;
      case 'ramp':       return `<span class="plc-chip">min ${p.min??0}</span><span class="plc-chip">max ${p.max??100}</span><span class="plc-chip">T=${p.period??60}s</span>`;
      case 'randomWalk': return `<span class="plc-chip">init ${p.initial??50}</span><span class="plc-chip">δ=${p.delta??1}</span><span class="plc-chip">${p.min??0}–${p.max??100}</span>`;
      case 'blink':      return `<span class="plc-chip">${sig.interval||1000}ms</span>`;
      case 'blinkFast':  return `<span class="plc-chip">200ms</span>`;
      case 'blinkSlow':  return `<span class="plc-chip">3000ms</span>`;
      case 'counter':    return `<span class="plc-chip">+${p.increment??1}</span><span class="plc-chip">${sig.interval||1000}ms</span><span class="plc-chip">max ${p.max??9999}</span>`;
      case 'step':       return `<span class="plc-chip">${(p.steps||[0,50,100]).join('→')}</span><span class="plc-chip">${p.stepTime||10}s</span>`;
      default:           return '';
    }
  }

  // ─────────────────────────────────────────────
  // Exposed globals (called from inline HTML)
  // ─────────────────────────────────────────────

  window.PLCSIM_toggleBit = async function(id) {
    const bit = bits.find(b => b.id === id);
    if (!bit) return;
    bit.value = !bit.value;
    _renderBits();
    if (state.running) await window.electronAPI.plcToggleBit(bit.address);
    _markModified();
  };

  window.PLCSIM_updateBit = function(id, key, value) {
    const bit = bits.find(b => b.id === id);
    if (bit) { bit[key] = value; _validate(); _markModified(); }
  };

  window.PLCSIM_updateReg = function(id, key, value) {
    const reg = regs.find(r => r.id === id);
    if (reg) { reg[key] = value; _validate(); _renderRegs(); _markModified(); }
  };

  window.PLCSIM_setReg = async function(id) {
    const reg = regs.find(r => r.id === id);
    if (!reg) return;
    const inp = document.getElementById(`plcnew-${id}`);
    if (!inp) return;
    const val = parseFloat(inp.value);
    reg.value = val;
    _updateRegDisplay(reg);
    if (state.running) await window.electronAPI.plcSetValue(reg.address, val, reg.dataType, 'holding');
    _markModified();
  };

  window.PLCSIM_zeroReg = async function(id) {
    const reg = regs.find(r => r.id === id);
    if (!reg) return;
    reg.value = 0;
    const inp = document.getElementById(`plcnew-${id}`);
    if (inp) inp.value = '0';
    _updateRegDisplay(reg);
    if (state.running) await window.electronAPI.plcSetValue(reg.address, 0, reg.dataType, 'holding');
    _markModified();
  };

  window.PLCSIM_updateSig = function(id, key, value) {
    const sig = sigs.find(s => s.id === id);
    if (sig) { sig[key] = value; _renderSigs(); _markModified(); }
  };

  window.PLCSIM_startSig = async function(id) { await _startSignal(id); };
  window.PLCSIM_stopSig  = async function(id) { await _stopSignal(id);  };

  window.PLCSIM_cfgSig = function(id) {
    alert('Signal configuration modal — coming soon');
  };

  async function _startSignal(id) {
    const sig = sigs.find(s => s.id === id);
    if (!sig || !state.running) return;
    const result = await window.electronAPI.plcStartSignal({ ...sig });
    if (result.ok) { sig.running = true; _renderSigs(); }
  }

  async function _stopSignal(id) {
    const sig = sigs.find(s => s.id === id);
    if (!sig) return;
    await window.electronAPI.plcStopSignal(id);
    sig.running = false;
    _renderSigs();
  }

  // ─────────────────────────────────────────────
  // Server start/stop
  // ─────────────────────────────────────────────

  async function _toggleServer() {
    if (state.running) {
      await window.electronAPI.plcStop();
      state.running = false;
    } else {
      const byteOrder = document.getElementById('plcByteOrder')?.value || 'BE';
      const result    = await window.electronAPI.plcStart({ bindMode: 'local', port: 502, unitId: 1, byteOrder, bits, regs, sigs });
      if (!result.ok) { alert(`Error: ${result.error}`); return; }
      state.running = true;
    }
    _updateHeaderControls();
    _updateStatus();
  }

  // ─────────────────────────────────────────────
  // Value refresh
  // ─────────────────────────────────────────────

  function _startRefresh() {
    _stopRefresh();
    _refreshTimer = setInterval(async () => {
      const snap = await window.electronAPI.plcGetValues({ bits, registers: regs, signals: sigs });
      if (!snap) return;

      for (const b of (snap.bits || [])) {
        const bit = bits.find(x => x.address === b.address);
        if (bit) bit.value = b.value;
      }

      for (const r of (snap.registers || [])) {
        const reg = regs.find(x => x.address === r.address);
        if (reg) { reg.value = r.value; _updateRegDisplay(reg); }
      }

      for (const s of (snap.signals || [])) {
        const el = document.getElementById(`sigval-${_sigIdByAddress(s.address)}`);
        if (el) el.textContent = typeof s.value === 'boolean'
          ? (s.value ? 'ON' : 'OFF')
          : _fmt(s.value, 'FLOAT32');
      }

      _renderBits();
    }, 800);
  }

  function _stopRefresh() {
    if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
  }

  function _sigIdByAddress(addr) {
    const sig = sigs.find(s => s.address === addr);
    return sig ? sig.id : '';
  }

  function _updateRegDisplay(reg) {
    const valEl = document.getElementById(`plcval-${reg.id}`);
    const hexEl = document.getElementById(`plchex-${reg.id}`);
    const binEl = document.getElementById(`plcbin-${reg.id}`);
    if (valEl) valEl.textContent = _fmt(reg.value, reg.dataType);
    if (hexEl) hexEl.textContent = _toHex(reg.value, reg.dataType);
    if (binEl) binEl.textContent = _toBin(reg.value, reg.dataType);
  }

  // ─────────────────────────────────────────────
  // Validation
  // ─────────────────────────────────────────────

  async function _validate() {
    const result = await window.electronAPI.plcValidate({ bits, registers: regs, signals: sigs });

    state.errors    = result.errors || [];
    state.validated = result.ok;

    bits.forEach(b => { b._err = state.errors.some(e => e.field === 'bits'      && e.address === b.address); });
    regs.forEach(r => { r._err = state.errors.some(e => e.field === 'registers' && e.address === r.address); });

    _renderBits();
    _renderRegs();
    _updateValidationBanner();
    _updateStartButton();
  }

  function _updateValidationBanner() {
    const banner = document.getElementById('plcValBanner');
    if (!banner) return;

    if (state.errors.length === 0 && state.filePath) {
      banner.style.display = 'none';
      return;
    }

    if (state.errors.length > 0) {
      banner.className     = 'val-banner err';
      banner.style.display = 'flex';
      banner.innerHTML = `⚠ &nbsp;${state.errors.length} error${state.errors.length > 1 ? 'es' : ''} — ${window.utils.esc(state.errors[0].message)}`;
    } else if (!state.filePath) {
      banner.className     = 'val-banner warn';
      banner.style.display = 'flex';
      banner.innerHTML     = '💾 &nbsp;Guardá la simulación para poder iniciarla.';
    }
  }

  function _updateStartButton() {
    const btn = document.getElementById('plcBtnStartStop');
    if (!btn) return;
    const canStart = state.errors.length === 0 && state.filePath;
    btn.disabled = !canStart && !state.running;
  }

  // ─────────────────────────────────────────────
  // Status / Header
  // ─────────────────────────────────────────────

  function _updateStatus() {
    const btn = document.getElementById('plcBtnStartStop');
    if (btn) {
      btn.textContent = state.running ? '■ Detener Simulación' : '▶ Iniciar Simulación';
      btn.className   = state.running ? 'fbtn danger' : 'fbtn start-sim';
      if (!state.running) _updateStartButton();
    }
  }

  function _renderHeaderControls() {
    const ctrl = document.getElementById('headerControls');
    if (!ctrl) return;
    ctrl.innerHTML = `
      <div class="srv-badge">
        <div class="sdot off" id="plcHdrDot"></div>
        <span id="plcHdrLabel">Detenido</span>
      </div>
      <div class="srv-badge" id="plcHdrClients">Clients: 0</div>
      <div class="srv-badge">:502</div>
      <button class="hbtn start" id="plcHdrBtn">▶ Iniciar</button>
    `;
    document.getElementById('plcHdrBtn').addEventListener('click', _toggleServer);
  }

  function _updateHeaderControls() {
    const dot     = document.getElementById('plcHdrDot');
    const label   = document.getElementById('plcHdrLabel');
    const btn     = document.getElementById('plcHdrBtn');
    const clients = document.getElementById('plcHdrClients');
    if (!dot) return;

    if (state.running) {
      dot.className     = 'sdot on pulse';
      label.textContent = 'Running';
      btn.textContent   = '■ Stop';
      btn.className     = 'hbtn stop';
    } else {
      dot.className     = 'sdot off';
      label.textContent = 'Stopped';
      btn.textContent   = '▶ Iniciar';
      btn.className     = 'hbtn start';
    }
    if (clients) clients.textContent = `Clients: ${state.clients}`;
  }

  // ─────────────────────────────────────────────
  // Profile management
  // ─────────────────────────────────────────────

  async function _saveProfile() {
    if (!state.filePath) return _saveProfileAs();
    const data    = { meta: { version: '1.0' }, bits, registers: regs, signals: sigs };
    await window.electronAPI.writeFile({ filePath: state.filePath, content: JSON.stringify(data, null, 2) });
    state.modified = false;
    _updateFooter();
    _updateValidationBanner();
    _updateStartButton();
  }

  async function _saveProfileAs() {
    const fp = await window.electronAPI.saveDialog({ defaultName: 'simulacion', ext: 'plcsim', title: 'Guardar simulación' });
    if (!fp) return;
    state.filePath = fp;
    await _saveProfile();
  }

  async function _openProfile() {
    const result = await window.utils.readProfile(['plcsim'], 'Abrir simulación');
    if (!result) return;
    _applyProfile(result.data);
    state.filePath = result.filePath;
    state.modified = false;
    _updateFooter();
  }

  async function _loadProfileFromPath(filePath) {
    if (!filePath?.endsWith('.plcsim')) return;
    const result = await window.electronAPI.readFile({ filePath });
    if (!result.ok) return;
    try {
      _applyProfile(JSON.parse(result.content));
      state.filePath = filePath;
      state.modified = false;
      _updateFooter();
    } catch (_) {}
  }

  function _applyProfile(data) {
    if (data.bits)      bits = data.bits;
    if (data.registers) regs = data.registers;
    if (data.signals)   sigs = data.signals;
    _renderBits(); _renderRegs(); _renderSigs();
    _validate();
  }

  function _newProfile() {
    if (state.modified && !confirm('¿Descartar cambios no guardados?')) return;
    bits = JSON.parse(JSON.stringify(DEFAULT_BITS));
    regs = JSON.parse(JSON.stringify(DEFAULT_REGS));
    sigs = JSON.parse(JSON.stringify(DEFAULT_SIGS));
    state.filePath = null;
    state.modified = false;
    _renderBits(); _renderRegs(); _renderSigs();
    _validate();
    _updateFooter();
  }

  function _resetProfile() {
    if (!confirm('¿Resetear todos los valores a cero?')) return;
    bits.forEach(b => { b.value = false; });
    regs.forEach(r => { r.value = 0; });
    _renderBits(); _renderRegs();
    _markModified();
  }

  function _markModified() { state.modified = true; _updateFooter(); _updateStartButton(); }

  function _updateFooter() {
    const el = document.getElementById('plcFooterFilename');
    if (!el) return;
    const name = state.filePath ? state.filePath.split(/[\\/]/).pop() : 'Sin guardar';
    const mod  = state.modified
      ? `&nbsp;·&nbsp;<span class="footer-modified">● Sin guardar</span>`
      : state.filePath ? `&nbsp;·&nbsp;<span class="footer-saved">● Guardado</span>` : '';
    el.innerHTML = name + mod;
  }

  // ─────────────────────────────────────────────
  // Format helpers
  // ─────────────────────────────────────────────

  function _fmt(v, dt) {
    if (v === null || v === undefined) return '—';
    switch (dt) {
      case 'FLOAT32': return parseFloat(v).toFixed(2);
      case 'INT16':
      case 'DINT32':  return String(Math.round(v));
      default:        return String(v);
    }
  }

  function _toHex(v, dt) {
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, parseFloat(v) || 0, false);
    const n = Math.round(v) >>> 0;
    switch (dt) {
      case 'FLOAT32': return '0x' + Array.from(new Uint8Array(view.buffer)).map(b => b.toString(16).padStart(2,'0').toUpperCase()).join('');
      case 'DINT32':  return '0x' + (n & 0xFFFFFFFF).toString(16).toUpperCase().padStart(8,'0');
      default:        return '0x' + (n & 0xFFFF).toString(16).toUpperCase().padStart(4,'0');
    }
  }

  function _toBin(v, dt) {
    const n = Math.round(v) >>> 0;
    switch (dt) {
      case 'FLOAT32':
      case 'DINT32': return (n & 0xFFFFFFFF).toString(2).padStart(32,'0').match(/.{4}/g).join(' ');
      default:       return (n & 0xFFFF).toString(2).padStart(16,'0').match(/.{4}/g).join(' ');
    }
  }

  return { init };

})();

window.PLCSIM = PLCSIM;

document.addEventListener('DOMContentLoaded', () => {
  const panel = document.getElementById('tab-plc-sim');
  if (panel) PLCSIM.init();
});
