// src/modbus-tester/modbus-client.js
'use strict';

const net      = require('net');
const jsmodbus = require('jsmodbus');

class ModbusClient {
  constructor() {
    this._socket    = null;
    this._client    = null;
    this._connected = false;
    this._cfg       = null;
    this._pollTimer = null;
    this._logCb     = null;
    this._stateCb   = null;

    this.stats = { requests: 0, errors: 0, lastMs: null, minMs: null, maxMs: null, totalMs: 0 };
  }

  // ─────────────────────────────────────────────
  // Connect / Disconnect
  // ─────────────────────────────────────────────

  async connect(cfg) {
    if (this._connected) await this.disconnect();

    this._cfg = cfg;

    return new Promise((resolve) => {
      try {
        this._socket = new net.Socket();
        this._client = new jsmodbus.client.TCP(this._socket, cfg.unitId || 1);

        const timeout = setTimeout(() => {
          this._socket.destroy();
          resolve({ ok: false, error: `Timeout (${cfg.timeout || 3000}ms)` });
        }, cfg.timeout || 3000);

        this._socket.on('connect', () => {
          clearTimeout(timeout);
          this._connected = true;
          this._log(`Connected: ${cfg.ip}:${cfg.port} Unit:${cfg.unitId}`, 'conn');
          this._emitState();
          resolve({ ok: true });
        });

        this._socket.on('error', (err) => {
          clearTimeout(timeout);
          this._connected = false;
          this._log(`Error: ${err.message}`, 'err');
          this._emitState();
          if (!this._connected) resolve({ ok: false, error: err.message });
        });

        this._socket.on('close', () => {
          this._connected = false;
          this._log('Disconnected');
          this._emitState();
        });

        this._socket.connect({ host: cfg.ip, port: cfg.port || 502 });

      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    });
  }

  async disconnect() {
    this.stopPolling();
    if (this._socket) {
      this._socket.destroy();
      this._socket = null;
    }
    this._client    = null;
    this._connected = false;
    this._emitState();
    return { ok: true };
  }

  get isConnected() { return this._connected; }

  // ─────────────────────────────────────────────
  // Read
  // ─────────────────────────────────────────────

  async read(opts) {
    if (!this._connected) return { ok: false, error: 'Not connected' };

    const t0 = Date.now();

    try {
      let response;
      const addr  = this._normalizeAddress(opts.address, opts.registerType);
      const count = this._registerCount(opts.count, opts.dataType);

      switch (opts.registerType) {
        case 'holding':  response = await this._client.readHoldingRegisters(addr, count); break;
        case 'input':    response = await this._client.readInputRegisters(addr, count);   break;
        case 'coil':     response = await this._client.readCoils(addr, opts.count);       break;
        case 'discrete': response = await this._client.readDiscreteInputs(addr, opts.count); break;
        default: return { ok: false, error: `Unknown register type: ${opts.registerType}` };
      }

      const ms = Date.now() - t0;
      this._updateStats(ms);

      const values = this._parseValues(response, opts);
      this._log(`FC${this._fc(opts.registerType)} Read ${opts.address} count=${opts.count} → OK (${ms}ms)`, 'read');

      return { ok: true, values, ms, raw: response.response.body.valuesAsArray };

    } catch (err) {
      this.stats.errors++;
      this._log(`Read error: ${err.message}`, 'err');
      return { ok: false, error: err.message };
    }
  }

  // ─────────────────────────────────────────────
  // Write
  // ─────────────────────────────────────────────

  async write(opts) {
    if (!this._connected) return { ok: false, error: 'Not connected' };

    const t0 = Date.now();

    try {
      const addr = this._normalizeAddress(opts.address, opts.registerType);

      if (opts.registerType === 'coil') {
        await this._client.writeSingleCoil(addr, Boolean(opts.value));
      } else {
        const words = this._encodeValue(opts.value, opts.dataType, opts.byteOrder || 'BE');
        if (words.length === 1) {
          await this._client.writeSingleRegister(addr, words[0]);
        } else {
          await this._client.writeMultipleRegisters(addr, words);
        }
      }

      const ms = Date.now() - t0;
      this._log(`FC${opts.registerType === 'coil' ? '5' : '6'} Write ${opts.address} = ${opts.value} → OK (${ms}ms)`, 'write');
      return { ok: true, ms };

    } catch (err) {
      this.stats.errors++;
      this._log(`Write error: ${err.message}`, 'err');
      return { ok: false, error: err.message };
    }
  }

  // ─────────────────────────────────────────────
  // Polling
  // ─────────────────────────────────────────────

  startPolling(opts, intervalMs, onValue) {
    this.stopPolling();
    this._pollTimer = setInterval(async () => {
      const result = await this.read(opts);
      if (result.ok) onValue(result);
    }, intervalMs || 1000);
  }

  stopPolling() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
  }

  get isPolling() { return this._pollTimer !== null; }

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────

  _normalizeAddress(address, registerType) {
    const addr = parseInt(address);
    switch (registerType) {
      case 'holding':  return addr >= 40001 ? addr - 40001 : addr;
      case 'input':    return addr >= 30001 ? addr - 30001 : addr;
      case 'coil':     return addr >= 1     ? addr - 1     : addr;
      case 'discrete': return addr >= 10001 ? addr - 10001 : addr;
      default:         return addr;
    }
  }

  _registerCount(valueCount, dataType) {
    const wordsPerValue = (dataType === 'FLOAT32' || dataType === 'DINT32') ? 2 : 1;
    return valueCount * wordsPerValue;
  }

  _parseValues(response, opts) {
    const raw    = response.response.body.valuesAsArray;
    const result = [];

    let i = 0;
    for (let v = 0; v < opts.count; v++) {
      const addr = parseInt(opts.address) + v * this._wordSize(opts.dataType);
      let value;

      if (opts.registerType === 'coil' || opts.registerType === 'discrete') {
        value = Boolean(raw[v]);
        result.push({ address: addr, value, hex: value ? '0x01' : '0x00', bin: value ? '1' : '0' });
      } else {
        value = this._decodeValue(raw, i, opts.dataType, opts.byteOrder || 'BE');
        const hex = this._toHex(raw, i, opts.dataType);
        const bin = this._toBin(raw, i, opts.dataType);
        result.push({ address: addr, value, hex, bin });
        i += this._wordSize(opts.dataType);
      }
    }

    return result;
  }

  _wordSize(dataType) {
    return (dataType === 'FLOAT32' || dataType === 'DINT32') ? 2 : 1;
  }

  _decodeValue(words, offset, dataType, byteOrder) {
    const buf     = this._wordsToBuf(words, offset, dataType);
    const ordered = this._applyByteOrder(buf, byteOrder, buf.length);

    switch (dataType) {
      case 'INT16':   return ordered.readInt16BE(0);
      case 'UINT16':  return ordered.readUInt16BE(0);
      case 'FLOAT32': return parseFloat(ordered.readFloatBE(0).toFixed(4));
      case 'DINT32':  return ordered.readInt32BE(0);
      default:        return words[offset];
    }
  }

  _encodeValue(value, dataType, byteOrder) {
    let buf;
    switch (dataType) {
      case 'INT16':   buf = Buffer.alloc(2); buf.writeInt16BE(Math.round(value));    break;
      case 'UINT16':  buf = Buffer.alloc(2); buf.writeUInt16BE(Math.round(value));   break;
      case 'FLOAT32': buf = Buffer.alloc(4); buf.writeFloatBE(parseFloat(value));    break;
      case 'DINT32':  buf = Buffer.alloc(4); buf.writeInt32BE(Math.round(value));    break;
      default:        buf = Buffer.alloc(2); buf.writeUInt16BE(Math.round(value));
    }

    buf = this._applyByteOrder(buf, byteOrder, buf.length);
    const words = [];
    for (let i = 0; i < buf.length; i += 2) words.push(buf.readUInt16BE(i));
    return words;
  }

  _wordsToBuf(words, offset, dataType) {
    const size = this._wordSize(dataType) * 2;
    const buf  = Buffer.alloc(size);
    for (let i = 0; i < size / 2; i++) buf.writeUInt16BE(words[offset + i] || 0, i * 2);
    return buf;
  }

  _applyByteOrder(buf, order, size) {
    switch (order) {
      case 'LE':    return size === 4 ? Buffer.from([buf[1],buf[0],buf[3],buf[2]]) : Buffer.from([buf[1],buf[0]]);
      case 'BE_BS': return size === 4 ? Buffer.from([buf[1],buf[0],buf[3],buf[2]]) : buf;
      case 'LE_BS': return size === 4 ? Buffer.from([buf[3],buf[2],buf[1],buf[0]]) : buf;
      default:      return buf;
    }
  }

  _toHex(words, offset, dataType) {
    const size = this._wordSize(dataType);
    let hex = '0x';
    for (let i = 0; i < size; i++) {
      hex += ((words[offset + i] || 0) >>> 0).toString(16).toUpperCase().padStart(4, '0');
    }
    return hex;
  }

  _toBin(words, offset, dataType) {
    const size = this._wordSize(dataType);
    let bin = '';
    for (let i = 0; i < size; i++) {
      const w = (words[offset + i] || 0).toString(2).padStart(16, '0');
      bin += (i > 0 ? ' ' : '') + w.match(/.{4}/g).join(' ');
    }
    return bin;
  }

  _fc(registerType) {
    return { holding: '3', input: '4', coil: '1', discrete: '2' }[registerType] || '?';
  }

  _updateStats(ms) {
    this.stats.requests++;
    this.stats.lastMs   = ms;
    this.stats.totalMs += ms;
    if (this.stats.minMs === null || ms < this.stats.minMs) this.stats.minMs = ms;
    if (this.stats.maxMs === null || ms > this.stats.maxMs) this.stats.maxMs = ms;
  }

  onLog(cb)   { this._logCb   = cb; }
  onState(cb) { this._stateCb = cb; }

  _log(msg, type = 'info') {
    if (this._logCb) this._logCb({ ts: new Date().toISOString(), msg, type });
  }

  _emitState() {
    if (this._stateCb) this._stateCb({ connected: this._connected, stats: this.stats });
  }
}

module.exports = { ModbusClient };
