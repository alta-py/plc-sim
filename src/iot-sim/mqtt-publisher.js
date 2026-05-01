// src/iot-sim/mqtt-publisher.js
'use strict';

const mqtt = require('mqtt');

class MqttPublisher {
  constructor() {
    this._client    = null;
    this._connected = false;
    this._timer     = null;
    this._cfg       = null;
    this._logCb     = null;
    this._stateCb   = null;
    this._onMessage = null;

    this.stats = { published: 0, errors: 0, startedAt: null, lastTs: null };
  }

  // ─────────────────────────────────────────────
  // Connect
  // ─────────────────────────────────────────────

  async connect(cfg) {
    if (this._client) await this.stop();

    this._cfg = cfg;

    return new Promise((resolve) => {
      const options = {
        clientId:       cfg.clientId || `iot-sim-${Date.now()}`,
        clean:          true,
        connectTimeout: cfg.timeout || 5000
      };

      if (cfg.username) options.username = cfg.username;
      if (cfg.password) options.password = cfg.password;

      try {
        this._client = mqtt.connect(cfg.brokerUrl, options);

        const timeout = setTimeout(() => {
          resolve({ ok: false, error: 'Connection timeout' });
        }, cfg.timeout || 5000);

        this._client.on('connect', () => {
          clearTimeout(timeout);
          this._connected = true;
          this._log(`Connected to ${cfg.brokerUrl}`, 'conn');
          this._emitState();
          resolve({ ok: true });
        });

        this._client.on('error', (err) => {
          clearTimeout(timeout);
          this._connected = false;
          this._log(`Error: ${err.message}`, 'err');
          this._emitState();
          resolve({ ok: false, error: err.message });
        });

        this._client.on('close', () => {
          this._connected = false;
          this._log('Disconnected from broker');
          this._emitState();
        });

        this._client.on('message', (topic, payload) => {
          if (this._onMessage) {
            try {
              const parsed = JSON.parse(payload.toString());
              this._onMessage({ topic, payload: parsed, raw: payload.toString(), ts: new Date().toISOString() });
            } catch (_) {
              this._onMessage({ topic, payload: null, raw: payload.toString(), ts: new Date().toISOString() });
            }
          }
        });

      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    });
  }

  // ─────────────────────────────────────────────
  // Start / Stop publishing
  // ─────────────────────────────────────────────

  startPublishing() {
    if (!this._connected) return { ok: false, error: 'Not connected' };
    this.stopPublishing();

    this.stats.startedAt = Date.now();

    this._timer = setInterval(() => { this._publish(); }, this._cfg.interval || 1000);
    this._publish();

    return { ok: true };
  }

  stopPublishing() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  get isPublishing() { return this._timer !== null; }

  async stop() {
    this.stopPublishing();
    if (this._client) {
      this._client.end(true);
      this._client    = null;
      this._connected = false;
    }
    this._emitState();
    return { ok: true };
  }

  get isConnected() { return this._connected; }

  // ─────────────────────────────────────────────
  // Publish
  // ─────────────────────────────────────────────

  _publish() {
    if (!this._connected || !this._client) return;

    const payload = this._buildPayload();
    const topic   = this._cfg.topic;
    const qos     = this._cfg.qos || 0;

    this._client.publish(topic, JSON.stringify(payload), { qos }, (err) => {
      if (err) {
        this.stats.errors++;
        this._log(`Publish error: ${err.message}`, 'err');
      } else {
        this.stats.published++;
        this.stats.lastTs = new Date().toISOString();
        this._log(`PUBLISH ${topic} → ${JSON.stringify(payload)}`, 'pub');
        this._emitState();
      }
    });
  }

  _buildPayload() {
    const payload = {};
    for (const field of (this._cfg.fields || [])) {
      if (!field.enabled) continue;
      payload[field.key] = field.random
        ? this._randomValue(field)
        : this._castValue(field.value, field.type);
    }
    return payload;
  }

  _randomValue(field) {
    switch (field.type) {
      case 'float': {
        const min = parseFloat(field.randomMin ?? -100);
        const max = parseFloat(field.randomMax ??  100);
        return parseFloat((Math.random() * (max - min) + min).toFixed(1));
      }
      case 'int': {
        const min = parseInt(field.randomMin ?? 0);
        const max = parseInt(field.randomMax ?? 100);
        return Math.floor(Math.random() * (max - min + 1)) + min;
      }
      case 'bool': {
        field._boolState = !field._boolState;
        return field._boolState;
      }
      default: return field.value;
    }
  }

  _castValue(value, type) {
    switch (type) {
      case 'float':  return parseFloat(value) || 0;
      case 'int':    return parseInt(value)   || 0;
      case 'bool':   return value === true || value === 'true' || value === 1;
      case 'string': return String(value);
      default:       return value;
    }
  }

  set onMessage(cb) { this._onMessage = cb; }

  getClient() { return this._client; }

  onLog(cb)   { this._logCb   = cb; }
  onState(cb) { this._stateCb = cb; }

  _log(msg, type = 'info') {
    if (this._logCb) this._logCb({ ts: new Date().toISOString(), msg, type });
  }

  _emitState() {
    if (this._stateCb) {
      this._stateCb({ connected: this._connected, publishing: this.isPublishing, stats: this.stats });
    }
  }
}

module.exports = { MqttPublisher };
