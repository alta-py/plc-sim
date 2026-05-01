// ui/js/iot-sim.js
'use strict';

const IOT = (() => {

  // ─────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────

  const state = {
    running:   false,
    connected: false,
    filePath:  null,
    modified:  false,
    activeTab: 'publish',  // 'publish' | 'subscribe'
    subPaused: false,
    stats:     { published: 0, errors: 0, startedAt: null, lastTs: null }
  };

  const DEFAULT_FIELDS = [
    { id: 'f1', enabled: true,  label: 'Temperatura', key: 'temperature', value: '23.5', type: 'float',  random: false, randomMin: '-50', randomMax: '50'  },
    { id: 'f2', enabled: true,  label: 'Humedad',     key: 'humidity',    value: '65.0', type: 'float',  random: false, randomMin: '0',   randomMax: '100' },
    { id: 'f3', enabled: true,  label: 'Batería %',   key: 'battery',     value: '98',   type: 'int',    random: false, randomMin: '0',   randomMax: '100' },
    { id: 'f4', enabled: true,  label: 'Estado',      key: 'status',      value: 'true', type: 'bool',   random: false, randomMin: '',    randomMax: ''    },
    { id: 'f5', enabled: false, label: 'Calidad',     key: 'quality',     value: 'good', type: 'string', random: false, randomMin: '',    randomMax: ''    }
  ];

  let fields = JSON.parse(JSON.stringify(DEFAULT_FIELDS));

  const DEFAULT_CFG = {
    brokerUrl:  'mqtt://localhost:1883',
    topic:      'synkro/sensor/01',
    clientId:   'iot-sim-01',
    qos:        0,
    interval:   1000,
    username:   '',
    password:   '',
    bindMode:   'local',
    bindIp:     ''
  };

  let cfg = { ...DEFAULT_CFG };

  let subscriptions = [];  // { topic, qos, messages[], count }

  // ─────────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────────

  function init() {
    const panel = document.getElementById('tab-iot-sim');
    panel.innerHTML = _buildHTML();
    _wireEvents();
    _renderHeaderControls();
    _renderFields();
    _updatePreview();
    _updateFooter();

    // IPC listeners
    window.electronAPI.onIotLog((entry) => {
      const lb = document.getElementById('iotLogBody');
      window.utils.appendLog(lb, entry);
    });

    window.electronAPI.onIotState((s) => {
      state.connected = s.connected;
      state.running   = s.publishing;
      state.stats     = s.stats;
      _updateStatus();
      _updateHeaderControls();
    });

    window.electronAPI.onIotMessage((msg) => {
      if (state.activeTab === 'subscribe' && !state.subPaused) {
        _appendSubMessage(msg);
      }
      // Update subscription counts
      _refreshSubCounts(msg.topic);
    });

    // Menu events
    window.addEventListener('menu:new',    () => _newProfile());
    window.addEventListener('menu:save',   () => _saveProfile());
    window.addEventListener('menu:saveAs', () => _saveProfileAs());
    window.addEventListener('menu:open',   (e) => _loadProfileFromPath(e.detail));
  }

  // ─────────────────────────────────────────────
  // HTML
  // ─────────────────────────────────────────────

  function _buildHTML() {
    return `
      <!-- Info bar -->
      <div class="info-bar" id="iotInfoBar">
        <span>📡</span>
        Dispositivo IoT virtual. Configurar campos → Iniciar → publica JSON al broker.
        <div class="info-hint">
          Topic: <strong id="iotTopicHint">synkro/sensor/01</strong>
          <button class="copy-btn" id="iotCopyTopic">Copiar</button>
        </div>
      </div>

      <!-- Status bar -->
      <div class="iot-status-bar" id="iotStatusBar">
        <div class="iot-status-item">
          <div class="sdot off" id="iotConnDot"></div>
          <span id="iotConnLabel">Desconectado</span>
        </div>
        <div class="iot-status-sep"></div>
        <span id="iotPublishedCount">↑ 0 mensajes</span>
        <div class="iot-status-sep"></div>
        <span id="iotUptimeLabel">—</span>
      </div>

      <!-- Main layout -->
      <div class="iot-layout">

        <!-- LEFT — Config -->
        <div class="iot-left">

          <!-- Broker config -->
          <div class="card">
            <div class="card-hdr">🔗 Broker MQTT</div>
            <div class="card-body">

              <div class="f-row">
                <span class="f-lbl">Broker URL</span>
                <input class="f-inp" id="iotBrokerUrl" value="${cfg.brokerUrl}" />
              </div>
              <div class="f-row">
                <span class="f-lbl">Topic base</span>
                <input class="f-inp" id="iotTopic" value="${cfg.topic}" />
              </div>
              <div class="f-row">
                <span class="f-lbl">Client ID</span>
                <input class="f-inp" id="iotClientId" value="${cfg.clientId}" />
              </div>
              <div class="f-row">
                <span class="f-lbl">QoS</span>
                <select class="f-sel" id="iotQos" style="width:60px">
                  <option value="0" selected>0</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                </select>
                <span class="f-lbl" style="width:auto;margin-left:8px">Intervalo</span>
                <input class="f-inp" id="iotInterval" value="${cfg.interval}"
                       style="width:65px;flex:none;text-align:right" />
                <span style="font-size:10px;color:var(--text3);margin-left:3px">ms</span>
              </div>

              <div class="iot-divider"></div>

              <div class="f-row">
                <span class="f-lbl">Usuario</span>
                <input class="f-inp" id="iotUsername" placeholder="opcional" />
              </div>
              <div class="f-row">
                <span class="f-lbl">Password</span>
                <input class="f-inp" id="iotPassword" type="password" placeholder="opcional" />
              </div>

              <div class="iot-divider"></div>

              <div class="f-row" style="margin-bottom:6px">
                <span class="f-lbl">Modo</span>
                <div class="bind-toggle" id="iotBindToggle">
                  <button class="bind-opt active" data-mode="local">Local</button>
                  <button class="bind-opt" data-mode="ip">Definir IP</button>
                </div>
              </div>

              <div class="f-row" id="iotBindIpRow" style="display:none">
                <span class="f-lbl"></span>
                <input class="f-inp" id="iotBindIp" placeholder="192.168.1.x"
                       style="font-family:monospace;font-size:12px" />
                <button class="btn btn-ghost" id="iotShowIps" style="white-space:nowrap;font-size:10px">▼ IPs</button>
              </div>

              <div id="iotIpDropdown" class="iot-ip-dropdown" style="display:none"></div>

              <div class="iot-conn-status disconnected" id="iotConnStatus">
                <div class="sdot off"></div>
                Desconectado
              </div>

            </div>
          </div>

          <!-- Stats -->
          <div class="card" style="margin-top:10px">
            <div class="card-hdr">📊 Estadísticas</div>
            <div class="card-body">
              <div class="iot-stats-grid" id="iotStatsGrid">
                <div class="iot-stat">Publicados<span id="sPublished">0</span></div>
                <div class="iot-stat">Errores<span id="sErrors">0</span></div>
                <div class="iot-stat">Uptime<span id="sUptime">—</span></div>
                <div class="iot-stat">Último<span id="sLastTs">—</span></div>
              </div>
            </div>
          </div>

        </div>

        <!-- RIGHT — Publish / Subscribe tabs -->
        <div class="iot-right">

          <!-- Inner tabs -->
          <div class="iot-inner-tabs">
            <button class="iot-itab active" data-itab="publish">📤 Publicar</button>
            <button class="iot-itab" data-itab="subscribe">
              📥 Suscribir
              <span class="iot-sub-badge" id="iotSubBadge" style="display:none">0</span>
            </button>
          </div>

          <!-- PUBLISH PANEL -->
          <div class="iot-itab-panel active" id="iotPanelPublish">

            <!-- Fields section -->
            <div class="card iot-fields-card">
              <div class="card-hdr">
                <span>⊞</span> Campos del mensaje
                <span style="font-size:10px;color:var(--text3);margin-left:4px" id="iotFieldsCount">
                  5 campos · 4 habilitados
                </span>
              </div>
              <div class="card-body" style="padding:8px 10px">

                <!-- Column headers -->
                <div class="iot-col-hdr">
                  <span class="iot-ch-en"></span>
                  <span class="iot-ch-label">Label</span>
                  <span class="iot-ch-key">Key JSON</span>
                  <span class="iot-ch-val">Valor</span>
                  <span class="iot-ch-type">Tipo</span>
                  <span class="iot-ch-rnd">Random</span>
                  <span class="iot-ch-range">Rango</span>
                </div>

                <!-- Fields rows -->
                <div id="iotFieldsContainer"></div>

              </div>
            </div>

            <!-- Preview JSON -->
            <div class="iot-preview-card">
              <div class="iot-preview-hdr">
                <span class="iot-preview-label">Preview</span>
                <span class="iot-preview-topic" id="iotPreviewTopic">synkro/sensor/01</span>
                <span class="iot-preview-interval" id="iotPreviewInterval">↑ cada 1000ms</span>
              </div>
              <pre class="iot-preview-body" id="iotPreviewBody"></pre>
            </div>

          </div>

          <!-- SUBSCRIBE PANEL -->
          <div class="iot-itab-panel" id="iotPanelSubscribe">

            <!-- Add subscription -->
            <div class="card" style="margin-bottom:10px">
              <div class="card-hdr">
                ➕ Agregar suscripción
                <span style="font-size:10px;color:var(--text3);margin-left:auto" id="iotSubCount">
                  0 / 10
                </span>
              </div>
              <div class="card-body">
                <div class="f-row" style="margin-bottom:0">
                  <input class="f-inp" id="iotSubTopic"
                         placeholder="synkro/# o synkro/gateway/tags/+" />
                  <select class="f-sel" id="iotSubQos" style="width:65px">
                    <option value="0">QoS 0</option>
                    <option value="1">QoS 1</option>
                    <option value="2">QoS 2</option>
                  </select>
                  <button class="btn btn-primary" id="iotBtnSubscribe">Suscribir</button>
                </div>
              </div>
            </div>

            <!-- Active subscriptions -->
            <div id="iotSubList" style="display:flex;flex-direction:column;gap:8px;"></div>

            <!-- Message monitor -->
            <div style="margin-top:10px">
              <div class="iot-mon-hdr">
                <span>Monitor de mensajes</span>
                <div style="display:flex;gap:6px;align-items:center">
                  <input class="f-inp" id="iotSubFilter"
                         placeholder="🔍 Filtrar..."
                         style="width:160px;font-size:11px;padding:3px 7px" />
                  <button class="btn btn-ghost" id="iotSubPause" style="font-size:10px">⏸ Pausar</button>
                  <button class="btn btn-ghost" id="iotSubClearAll" style="font-size:10px">🗑 Limpiar</button>
                </div>
              </div>
              <div class="iot-msg-monitor" id="iotMsgMonitor"></div>
            </div>

          </div>

        </div>
      </div>

      <!-- Log -->
      <div style="padding:0 14px 10px">
        <div class="log-wrap">
          <div class="log-hdr">
            <span class="log-title">MQTT Log</span>
            <span class="log-count" id="iotLogCount">0</span>
            <button class="log-clear" onclick="document.getElementById('iotLogBody').innerHTML=''">Clear</button>
          </div>
          <div class="log-body" id="iotLogBody" style="height:60px"></div>
        </div>
      </div>

      <!-- Footer -->
      <div class="app-footer" id="iotFooter">
        <span class="footer-filename" id="iotFooterFilename">Sin guardar</span>
        <div class="footer-btns">
          <button class="fbtn" id="iotBtnOpen">📂 Abrir</button>
          <button class="fbtn primary" id="iotBtnSave">💾 Guardar</button>
          <button class="fbtn" id="iotBtnSaveAs">Guardar como...</button>
          <button class="fbtn danger" id="iotBtnReset">⊘ Reset</button>
          <button class="fbtn start-sim" id="iotBtnStartStop" style="margin-left:8px">
            ▶ Iniciar
          </button>
        </div>
      </div>
    `;
  }

  // ─────────────────────────────────────────────
  // Wire events
  // ─────────────────────────────────────────────

  function _wireEvents() {

    // Inner tabs
    document.querySelectorAll('.iot-itab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.iot-itab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.iot-itab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const panelId = `iotPanel${btn.dataset.itab.charAt(0).toUpperCase() + btn.dataset.itab.slice(1)}`;
        document.getElementById(panelId).classList.add('active');
        state.activeTab = btn.dataset.itab;
      });
    });

    // Bind mode toggle
    document.getElementById('iotBindToggle').addEventListener('click', (e) => {
      const btn = e.target.closest('.bind-opt');
      if (!btn) return;
      document.querySelectorAll('#iotBindToggle .bind-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      cfg.bindMode = btn.dataset.mode;
      const ipRow = document.getElementById('iotBindIpRow');
      ipRow.style.display = cfg.bindMode === 'ip' ? 'flex' : 'none';
    });

    // Show IPs dropdown
    document.getElementById('iotShowIps').addEventListener('click', async () => {
      const ips = await window.utils.getLocalIps();
      const dd  = document.getElementById('iotIpDropdown');
      dd.innerHTML = ips.map(({ ip, name }) =>
        `<div class="iot-ip-item" data-ip="${ip}">
          <span class="iot-ip-addr">${ip}</span>
          <span class="iot-ip-name">${name}</span>
        </div>`
      ).join('');
      dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
    });

    document.getElementById('iotIpDropdown').addEventListener('click', (e) => {
      const item = e.target.closest('.iot-ip-item');
      if (!item) return;
      document.getElementById('iotBindIp').value = item.dataset.ip;
      document.getElementById('iotIpDropdown').style.display = 'none';
    });

    // Copy topic
    document.getElementById('iotCopyTopic').addEventListener('click', (e) => {
      window.utils.copyText(cfg.topic, e.currentTarget);
    });

    // Topic input → update hint
    document.getElementById('iotTopic').addEventListener('input', (e) => {
      cfg.topic = e.target.value;
      document.getElementById('iotTopicHint').textContent   = cfg.topic;
      document.getElementById('iotPreviewTopic').textContent = cfg.topic;
      _markModified();
    });

    // Interval input → update preview
    document.getElementById('iotInterval').addEventListener('input', (e) => {
      cfg.interval = parseInt(e.target.value) || 1000;
      document.getElementById('iotPreviewInterval').textContent = `↑ cada ${cfg.interval}ms`;
      _markModified();
    });

    // Start/Stop
    document.getElementById('iotBtnStartStop').addEventListener('click', _toggleStartStop);

    // Subscribe
    document.getElementById('iotBtnSubscribe').addEventListener('click', _addSubscription);

    // Sub filter
    document.getElementById('iotSubFilter').addEventListener('input', _filterMessages);

    // Sub pause
    document.getElementById('iotSubPause').addEventListener('click', () => {
      state.subPaused = !state.subPaused;
      document.getElementById('iotSubPause').textContent = state.subPaused ? '▶ Reanudar' : '⏸ Pausar';
    });

    // Sub clear all
    document.getElementById('iotSubClearAll').addEventListener('click', () => {
      document.getElementById('iotMsgMonitor').innerHTML = '';
      window.electronAPI.iotClearMessages && window.electronAPI.iotClearMessages({});
    });

    // Footer buttons
    document.getElementById('iotBtnOpen').addEventListener('click',   _openProfile);
    document.getElementById('iotBtnSave').addEventListener('click',   _saveProfile);
    document.getElementById('iotBtnSaveAs').addEventListener('click', _saveProfileAs);
    document.getElementById('iotBtnReset').addEventListener('click',  _resetProfile);
  }

  // ─────────────────────────────────────────────
  // Fields rendering
  // ─────────────────────────────────────────────

  function _renderFields() {
    const container = document.getElementById('iotFieldsContainer');
    container.innerHTML = fields.map(f => _buildFieldRow(f)).join('');

    // Wire field events
    container.querySelectorAll('.iot-fld').forEach(row => {
      const id = row.dataset.fieldId;

      row.querySelector('.fld-check').addEventListener('change', (e) => {
        _updateField(id, 'enabled', e.target.checked);
        row.classList.toggle('disabled', !e.target.checked);
      });

      row.querySelector('.fld-label-inp').addEventListener('input', (e) => {
        _updateField(id, 'label', e.target.value);
      });

      row.querySelector('.fld-key-inp').addEventListener('input', (e) => {
        _updateField(id, 'key', e.target.value);
        _updatePreview();
      });

      row.querySelector('.fld-val-inp')?.addEventListener('input', (e) => {
        _updateField(id, 'value', e.target.value);
        _updatePreview();
      });

      row.querySelector('.fld-bool-toggle')?.addEventListener('click', () => {
        const field = fields.find(f => f.id === id);
        if (!field || field.random) return;
        field.value = field.value === 'true' ? 'false' : 'true';
        _renderFields();
        _updatePreview();
      });

      row.querySelector('.fld-type-sel').addEventListener('change', (e) => {
        _updateField(id, 'type', e.target.value);
        _renderFields(); // re-render to show/hide bool toggle
        _updatePreview();
      });

      row.querySelector('.fld-rnd-trk').addEventListener('click', () => {
        const field = fields.find(f => f.id === id);
        if (!field) return;
        field.random = !field.random;
        _renderFields();
        _updatePreview();
      });

      row.querySelector('.fld-min-inp')?.addEventListener('input', (e) => {
        _updateField(id, 'randomMin', e.target.value);
        _updatePreview();
      });

      row.querySelector('.fld-max-inp')?.addEventListener('input', (e) => {
        _updateField(id, 'randomMax', e.target.value);
        _updatePreview();
      });
    });

    _updateFieldsCount();
  }

  function _buildFieldRow(f) {
    const isBool   = f.type === 'bool';
    const isStr    = f.type === 'string';
    const boolOn   = f.value === 'true' || f.value === true;

    const valueInput = isBool
      ? `<div class="fld-bool-val">
           <div class="toggle fld-bool-toggle" style="width:34px;height:18px">
             <div class="trk ${boolOn ? 'on' : ''}">
               <div class="tth" style="${boolOn ? 'left:19px' : ''}"></div>
             </div>
           </div>
           <span class="iot-bool-badge ${boolOn ? 'on' : 'off'}">${boolOn ? 'true' : 'false'}</span>
         </div>`
      : `<input class="fld-val-inp" value="${window.utils?.esc(String(f.value)) || f.value}" />`;

    const rndCls   = f.random ? 'on' : '';
    const rndThumb = f.random ? 'left:16px' : '';

    const rangeHtml = (f.random && !isStr)
      ? (isBool
          ? `<span class="iot-blink-ind">⟳ true ↔ false</span>`
          : `<div class="fld-rng-wrap">
               <span class="fld-rng-lbl">min</span>
               <input class="fld-min-inp" value="${f.randomMin || '0'}" />
               <span class="fld-rng-lbl">max</span>
               <input class="fld-max-inp" value="${f.randomMax || '100'}" />
             </div>`)
      : `<span class="fld-fixed-hint">${f.random ? '' : 'Valor fijo'}</span>`;

    const typeClass = { float: 'type-float', int: 'type-int', bool: 'type-bool', string: 'type-str' }[f.type] || '';

    return `
      <div class="iot-fld ${f.enabled ? '' : 'disabled'}" data-field-id="${f.id}">
        <input type="checkbox" class="fld-check" ${f.enabled ? 'checked' : ''} />
        <input class="fld-label-inp" value="${window.utils?.esc(f.label) || f.label}" />
        <input class="fld-key-inp" value="${window.utils?.esc(f.key) || f.key}" />
        ${valueInput}
        <select class="fld-type-sel ${typeClass}">
          ${['float','int','bool','string'].map(t =>
            `<option value="${t}" ${t === f.type ? 'selected' : ''}>${t}</option>`
          ).join('')}
        </select>
        <div class="fld-rnd-wrap">
          <span class="fld-rnd-lbl">Random</span>
          <div class="toggle" style="width:30px;height:16px">
            <div class="trk fld-rnd-trk ${rndCls}" style="border-radius:16px">
              <div class="tth" style="width:12px;height:12px;top:2px;left:2px;${rndThumb}"></div>
            </div>
          </div>
        </div>
        ${rangeHtml}
      </div>`;
  }

  function _updateField(id, key, value) {
    const field = fields.find(f => f.id === id);
    if (field) { field[key] = value; _markModified(); }
  }

  function _updateFieldsCount() {
    const enabled = fields.filter(f => f.enabled).length;
    const el = document.getElementById('iotFieldsCount');
    if (el) el.textContent = `${fields.length} campos · ${enabled} habilitados`;
  }

  // ─────────────────────────────────────────────
  // Preview JSON
  // ─────────────────────────────────────────────

  function _updatePreview() {
    const preview = {};

    for (const f of fields) {
      if (!f.enabled) continue;
      switch (f.type) {
        case 'float':  preview[f.key] = parseFloat(f.value) || 0; break;
        case 'int':    preview[f.key] = parseInt(f.value)   || 0; break;
        case 'bool':   preview[f.key] = f.value === 'true';       break;
        case 'string': preview[f.key] = String(f.value);          break;
      }
    }

    const el = document.getElementById('iotPreviewBody');
    if (!el) return;

    el.innerHTML = _syntaxHighlightJson(preview);
  }

  function _syntaxHighlightJson(obj) {
    const lines = ['{'];
    const entries = Object.entries(obj);
    entries.forEach(([k, v], i) => {
      const comma = i < entries.length - 1 ? ',' : '';
      let valHtml;
      if      (typeof v === 'number')  valHtml = `<span class="iot-jv-num">${v}</span>`;
      else if (typeof v === 'boolean') valHtml = `<span class="iot-jv-bool">${v}</span>`;
      else                             valHtml = `<span class="iot-jv-str">"${v}"</span>`;
      lines.push(`  <span class="iot-jk">"${k}"</span>: ${valHtml}${comma}`);
    });
    lines.push('}');

    const disabled = fields.filter(f => !f.enabled).map(f => f.key);
    if (disabled.length) {
      lines.push('');
      lines.push(`<span class="iot-jcomment">// Deshabilitados: ${disabled.join(', ')}</span>`);
    }

    return lines.join('\n');
  }

  // ─────────────────────────────────────────────
  // Start / Stop
  // ─────────────────────────────────────────────

  async function _toggleStartStop() {
    if (state.running) {
      await window.electronAPI.iotStop();
      state.running = false;
    } else {
      const builtCfg = _buildCfg();
      const result   = await window.electronAPI.iotStart(builtCfg);
      if (result.ok) {
        state.running = true;
      } else {
        alert(`Error al iniciar: ${result.error}`);
      }
    }
    _updateHeaderControls();
    _updateStatus();
  }

  function _buildCfg() {
    return {
      brokerUrl: document.getElementById('iotBrokerUrl').value.trim(),
      topic:     document.getElementById('iotTopic').value.trim(),
      clientId:  document.getElementById('iotClientId').value.trim(),
      qos:       parseInt(document.getElementById('iotQos').value),
      interval:  parseInt(document.getElementById('iotInterval').value) || 1000,
      username:  document.getElementById('iotUsername').value.trim(),
      password:  document.getElementById('iotPassword').value,
      bindMode:  cfg.bindMode,
      bindIp:    document.getElementById('iotBindIp')?.value?.trim() || '',
      fields
    };
  }

  // ─────────────────────────────────────────────
  // Subscribe
  // ─────────────────────────────────────────────

  async function _addSubscription() {
    const topic = document.getElementById('iotSubTopic').value.trim();
    const qos   = parseInt(document.getElementById('iotSubQos').value);

    if (!topic) return;
    if (!state.running) { alert('Iniciá la simulación primero para conectarte al broker.'); return; }

    const result = await window.electronAPI.iotSubscribe([{ topic, qos }]);

    if (!result.ok || result.results[0]?.error) {
      alert(result.results?.[0]?.error || result.error);
      return;
    }

    subscriptions.push({ topic, qos, count: 0 });
    _renderSubscriptions();
    document.getElementById('iotSubTopic').value = '';
    _updateSubCount();
  }

  function _renderSubscriptions() {
    const list = document.getElementById('iotSubList');
    list.innerHTML = subscriptions.map(sub => `
      <div class="iot-sub-item" data-topic="${window.utils?.esc(sub.topic) || sub.topic}">
        <div class="iot-sub-info">
          <span class="iot-sub-topic">${window.utils?.esc(sub.topic) || sub.topic}</span>
          <span class="iot-sub-qos">QoS ${sub.qos}</span>
          <span class="iot-sub-msgcount" id="subcount-${_topicId(sub.topic)}">${sub.count} msgs</span>
        </div>
        <button class="iot-sub-unsub btn btn-ghost"
                data-topic="${window.utils?.esc(sub.topic) || sub.topic}">Cancelar</button>
      </div>
    `).join('');

    list.querySelectorAll('.iot-sub-unsub').forEach(btn => {
      btn.addEventListener('click', async () => {
        const topic = btn.dataset.topic;
        await window.electronAPI.iotUnsubscribe(topic);
        subscriptions = subscriptions.filter(s => s.topic !== topic);
        _renderSubscriptions();
        _updateSubCount();
      });
    });
  }

  function _appendSubMessage(msg) {
    const filter  = document.getElementById('iotSubFilter')?.value?.toLowerCase() || '';
    const monitor = document.getElementById('iotMsgMonitor');
    if (!monitor) return;

    const raw = typeof msg.raw === 'string' ? msg.raw : JSON.stringify(msg.payload);

    if (filter && !msg.topic.toLowerCase().includes(filter) && !raw.toLowerCase().includes(filter)) return;

    const ts = new Date(msg.ts).toLocaleTimeString('es-PY', { hour12: false });
    const payloadHtml = msg.isJson
      ? `<pre class="iot-msg-json">${window.utils?.esc(JSON.stringify(msg.parsed, null, 2)) || ''}</pre>`
      : `<span class="iot-msg-raw">${window.utils?.esc(raw) || raw}</span>`;

    const el = document.createElement('div');
    el.className = 'iot-msg-item';
    el.innerHTML = `
      <div class="iot-msg-header">
        <span class="iot-msg-topic">${window.utils?.esc(msg.topic) || msg.topic}</span>
        <span class="iot-msg-ts">${ts}</span>
      </div>
      ${payloadHtml}
    `;

    monitor.prepend(el); // newest first

    // Keep bounded
    while (monitor.children.length > 100) monitor.removeChild(monitor.lastChild);
  }

  function _refreshSubCounts(topic) {
    const sub = subscriptions.find(s => _topicMatches(s.topic, topic));
    if (sub) {
      sub.count++;
      const el = document.getElementById(`subcount-${_topicId(sub.topic)}`);
      if (el) el.textContent = `${sub.count} msgs`;

      // Update badge
      const total  = subscriptions.reduce((a, s) => a + s.count, 0);
      const badge  = document.getElementById('iotSubBadge');
      if (badge) { badge.textContent = total; badge.style.display = 'inline'; }
    }
  }

  function _filterMessages() {
    // Messages are filtered on append — clear and note that filter is active
    const filter = document.getElementById('iotSubFilter').value;
    if (filter) {
      document.getElementById('iotMsgMonitor').innerHTML =
        `<div style="padding:8px;font-size:11px;color:var(--text3)">
          Filtro activo: "${filter}" — nuevos mensajes se filtrarán automáticamente
        </div>`;
    }
  }

  function _updateSubCount() {
    const n  = subscriptions.length;
    const el = document.getElementById('iotSubCount');
    if (el) el.textContent = `${n} / 10`;

    const btn = document.getElementById('iotBtnSubscribe');
    if (btn) btn.disabled = n >= 10;
  }

  function _topicMatches(filter, topic) {
    if (filter === topic) return true;
    const fp = filter.split('/');
    const tp = topic.split('/');
    for (let i = 0; i < fp.length; i++) {
      if (fp[i] === '#') return true;
      if (fp[i] === '+') continue;
      if (fp[i] !== tp[i]) return false;
    }
    return fp.length === tp.length;
  }

  function _topicId(topic) { return topic.replace(/[^a-zA-Z0-9]/g, '_'); }

  // ─────────────────────────────────────────────
  // Status / UI updates
  // ─────────────────────────────────────────────

  function _updateStatus() {
    const dot   = document.getElementById('iotConnDot');
    const label = document.getElementById('iotConnLabel');
    const status = document.getElementById('iotConnStatus');

    if (dot) {
      dot.className = `sdot ${state.connected ? 'on pulse' : 'off'}`;
    }
    if (label) {
      label.textContent = state.running
        ? `Publicando → ${cfg.topic}`
        : state.connected ? 'Conectado' : 'Desconectado';
    }
    if (status) {
      status.className = `iot-conn-status ${state.connected ? 'connected' : 'disconnected'}`;
      status.innerHTML = `<div class="sdot ${state.connected ? 'on' : 'off'}"></div>
        ${state.connected ? `Conectado a ${cfg.brokerUrl}` : 'Desconectado'}`;
    }

    // Stats
    const s = state.stats;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    set('iotPublishedCount', `↑ ${s.published || 0} mensajes`);
    set('sPublished', s.published || 0);
    set('sErrors',    s.errors    || 0);
    set('sLastTs',    s.lastTs ? new Date(s.lastTs).toLocaleTimeString('es-PY', { hour12: false }) : '—');

    if (s.startedAt) {
      const sec = Math.floor((Date.now() - s.startedAt) / 1000);
      const m   = Math.floor(sec / 60);
      const ss  = sec % 60;
      set('sUptime', `${m}m ${ss}s`);
      set('iotUptimeLabel', `Uptime: ${m}m ${ss}s`);
    }
  }

  function _renderHeaderControls() {
    const ctrl = document.getElementById('headerControls');
    if (!ctrl) return;
    ctrl.innerHTML = `
      <div class="srv-badge" id="iotHdrStatus">
        <div class="sdot off" id="iotHdrDot"></div>
        <span id="iotHdrLabel">Detenido</span>
      </div>
      <div class="srv-badge" id="iotHdrMsgs">↑ 0 msgs</div>
      <div class="srv-badge" id="iotHdrInterval">1000ms</div>
      <button class="hbtn start" id="iotHdrBtn" onclick="void(0)">▶ Iniciar</button>
    `;
    document.getElementById('iotHdrBtn').addEventListener('click', _toggleStartStop);
  }

  function _updateHeaderControls() {
    // Only update if IoT tab is active
    const dot   = document.getElementById('iotHdrDot');
    const label = document.getElementById('iotHdrLabel');
    const btn   = document.getElementById('iotHdrBtn');
    if (!dot) return;

    if (state.running) {
      dot.className = 'sdot on pulse';
      label.textContent = 'Publicando';
      btn.textContent   = '■ Detener';
      btn.className     = 'hbtn stop';
    } else {
      dot.className = 'sdot off';
      label.textContent = 'Detenido';
      btn.textContent   = '▶ Iniciar';
      btn.className     = 'hbtn start';
    }
  }

  // ─────────────────────────────────────────────
  // Profile management
  // ─────────────────────────────────────────────

  async function _saveProfile() {
    if (!state.filePath) return _saveProfileAs();
    const data    = _buildProfileData();
    const content = JSON.stringify(data, null, 2);
    await window.electronAPI.writeFile({ filePath: state.filePath, content });
    state.modified = false;
    _updateFooter();
  }

  async function _saveProfileAs() {
    const name = document.getElementById('iotTopic').value.replace(/\//g,'_') || 'iot_profile';
    const fp   = await window.electronAPI.saveDialog({ defaultName: name, ext: 'iotcfg', title: 'Guardar perfil IoT' });
    if (!fp) return;
    state.filePath = fp;
    await _saveProfile();
  }

  async function _openProfile() {
    const result = await window.utils.readProfile(['iotcfg'], 'Abrir perfil IoT');
    if (!result) return;
    _applyProfileData(result.data);
    state.filePath = result.filePath;
    state.modified = false;
    _updateFooter();
  }

  async function _loadProfileFromPath(filePath) {
    if (!filePath.endsWith('.iotcfg')) return;
    const result = await window.electronAPI.readFile({ filePath });
    if (!result.ok) return;
    try {
      _applyProfileData(JSON.parse(result.content));
      state.filePath = filePath;
      state.modified = false;
      _updateFooter();
    } catch (_) {}
  }

  function _newProfile() {
    if (state.modified && !confirm('¿Descartar cambios no guardados?')) return;
    fields        = JSON.parse(JSON.stringify(DEFAULT_FIELDS));
    cfg           = { ...DEFAULT_CFG };
    state.filePath = null;
    state.modified = false;
    _renderFields();
    _updatePreview();
    _updateFooter();
  }

  function _resetProfile() {
    if (!confirm('¿Resetear todos los campos a valores por defecto?')) return;
    _newProfile();
  }

  function _buildProfileData() {
    return {
      meta: { version: '1.0', created: new Date().toISOString() },
      config: {
        brokerUrl: document.getElementById('iotBrokerUrl').value,
        topic:     document.getElementById('iotTopic').value,
        clientId:  document.getElementById('iotClientId').value,
        qos:       parseInt(document.getElementById('iotQos').value),
        interval:  parseInt(document.getElementById('iotInterval').value),
        username:  document.getElementById('iotUsername').value,
        bindMode:  cfg.bindMode,
        bindIp:    document.getElementById('iotBindIp')?.value || ''
      },
      fields
    };
  }

  function _applyProfileData(data) {
    if (data.config) {
      const c = data.config;
      document.getElementById('iotBrokerUrl').value = c.brokerUrl || DEFAULT_CFG.brokerUrl;
      document.getElementById('iotTopic').value     = c.topic     || DEFAULT_CFG.topic;
      document.getElementById('iotClientId').value  = c.clientId  || DEFAULT_CFG.clientId;
      document.getElementById('iotQos').value       = c.qos       ?? 0;
      document.getElementById('iotInterval').value  = c.interval  || 1000;
      document.getElementById('iotUsername').value  = c.username  || '';
      cfg.bindMode = c.bindMode || 'local';

      document.querySelectorAll('#iotBindToggle .bind-opt').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === cfg.bindMode);
      });

      const ipRow = document.getElementById('iotBindIpRow');
      if (ipRow) ipRow.style.display = cfg.bindMode === 'ip' ? 'flex' : 'none';
      if (document.getElementById('iotBindIp')) {
        document.getElementById('iotBindIp').value = c.bindIp || '';
      }
    }

    if (data.fields) {
      fields = data.fields;
      _renderFields();
      _updatePreview();
    }
  }

  function _markModified() {
    state.modified = true;
    _updateFooter();
  }

  function _updateFooter() {
    const fn  = document.getElementById('iotFooterFilename');
    if (!fn) return;

    const name = state.filePath
      ? state.filePath.split(/[\\/]/).pop()
      : 'Sin guardar';

    const modSpan = state.modified
      ? `&nbsp;·&nbsp;<span class="footer-modified">● Sin guardar</span>`
      : state.filePath ? `&nbsp;·&nbsp;<span class="footer-saved">● Guardado</span>` : '';

    fn.innerHTML = name + modSpan;
  }

  return { init };

})();

// Auto-init when IoT tab panel exists
document.addEventListener('DOMContentLoaded', () => {
  const panel = document.getElementById('tab-iot-sim');
  if (panel) IOT.init();
});
