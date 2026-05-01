// src/plc-sim/modbus-server.js
'use strict';

const net      = require('net');
const jsmodbus = require('jsmodbus');
const { SignalEngine } = require('./signal-engine');

class ModbusServer {
  constructor() {
    this._server       = null;
    this._modbusServer = null;
    this._running      = false;
    this._clients      = 0;

    this._coils    = Buffer.alloc(256, 0);
    this._holdRegs = Buffer.alloc(512, 0);

    this._signalEngine = new SignalEngine(this);
    this._logCb  = null;
    this._stateCb = null;

    this.stats = { reads: 0, writes: 0, errors: 0, clients: 0 };
  }

  // ─────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────

  start(cfg = {}) {
    if (this._running) return { ok: false, error: 'Already running' };

    const host = cfg.bindMode === 'ip' ? cfg.bindIp : '127.0.0.1';
    const port = cfg.port || 502;

    this._byteOrder = cfg.byteOrder || 'BE';

    try {
      const serverOptions = { holding: this._holdRegs, coils: this._coils };
      this._server = new net.Server();
      this._modbusServer = new jsmodbus.server.TCP(this._server, serverOptions);

      this._modbusServer.on('preWriteSingleCoil', (req) => {
        this._log(`FC5 WriteCoil ${req.address} = ${req.value}`);
        this.stats.writes++;
      });

      this._modbusServer.on('preWriteMultipleCoils', (req) => {
        this._log(`FC15 WriteCoils ${req.address} count=${req.values.length}`);
        this.stats.writes++;
      });

      this._modbusServer.on('preWriteSingleRegister', (req) => {
        this._log(`FC6 WriteReg ${40001 + req.address} = ${req.value}`);
        this.stats.writes++;
      });

      this._modbusServer.on('preWriteMultipleRegisters', (req) => {
        this._log(`FC16 WriteRegs ${40001 + req.address} count=${req.values.length}`);
        this.stats.writes++;
      });

      this._modbusServer.on('preReadHoldingRegisters', () => { this.stats.reads++; });
      this._modbusServer.on('preReadCoils',             () => { this.stats.reads++; });
      this._modbusServer.on('preReadDiscreteInputs',    () => { this.stats.reads++; });
      this._modbusServer.on('preReadInputRegisters',    () => { this.stats.reads++; });

      this._server.on('connection', (socket) => {
        this._clients++;
        this.stats.clients = this._clients;
        this._log(`Client connected: ${socket.remoteAddress}:${socket.remotePort}`, 'conn');
        this._emitState();

        socket.on('close', () => {
          this._clients = Math.max(0, this._clients - 1);
          this.stats.clients = this._clients;
          this._log(`Client disconnected: ${socket.remoteAddress}`);
          this._emitState();
        });
      });

      this._server.listen(port, host, () => {
        this._running = true;
        this._log(`Server started on ${host}:${port}`, 'ok');
        this._emitState();
      });

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  stop() {
    this._signalEngine.stopAll();

    if (this._server) {
      this._server.close();
      this._server = null;
    }

    this._modbusServer = null;
    this._running      = false;
    this._clients      = 0;
    this.stats.clients = 0;

    this._log('Server stopped');
    this._emitState();
    return { ok: true };
  }

  get isRunning()    { return this._running; }
  get clientCount()  { return this._clients; }

  // ─────────────────────────────────────────────
  // Manual value setters
  // ─────────────────────────────────────────────

  setCoil(address, value) {
    const byteIdx = Math.floor(address / 8);
    const bitIdx  = address % 8;
    if (value) {
      this._coils[byteIdx] |= (1 << bitIdx);
    } else {
      this._coils[byteIdx] &= ~(1 << bitIdx);
    }
  }

  getCoil(address) {
    const byteIdx = Math.floor(address / 8);
    const bitIdx  = address % 8;
    return !!(this._coils[byteIdx] & (1 << bitIdx));
  }

  toggleCoil(address) {
    this.setCoil(address, !this.getCoil(address));
    return this.getCoil(address);
  }

  setRegister(regAddress, value, dataType) {
    const byteOffset = regAddress * 2;

    switch (dataType) {
      case 'INT16': {
        const buf = Buffer.alloc(2);
        buf.writeInt16BE(Math.round(value), 0);
        this._applyByteOrder(buf, 2).copy(this._holdRegs, byteOffset);
        break;
      }
      case 'FLOAT32': {
        const buf = Buffer.alloc(4);
        buf.writeFloatBE(value, 0);
        this._applyByteOrder(buf, 4).copy(this._holdRegs, byteOffset);
        break;
      }
      case 'DINT32': {
        const buf = Buffer.alloc(4);
        buf.writeInt32BE(Math.round(value), 0);
        this._applyByteOrder(buf, 4).copy(this._holdRegs, byteOffset);
        break;
      }
    }
  }

  getRegister(regAddress, dataType) {
    const byteOffset = regAddress * 2;
    let buf;

    switch (dataType) {
      case 'INT16': {
        buf = this._holdRegs.slice(byteOffset, byteOffset + 2);
        buf = this._reverseByteOrder(Buffer.from(buf), 2);
        return buf.readInt16BE(0);
      }
      case 'FLOAT32': {
        buf = this._holdRegs.slice(byteOffset, byteOffset + 4);
        buf = this._reverseByteOrder(Buffer.from(buf), 4);
        return buf.readFloatBE(0);
      }
      case 'DINT32': {
        buf = this._holdRegs.slice(byteOffset, byteOffset + 4);
        buf = this._reverseByteOrder(Buffer.from(buf), 4);
        return buf.readInt32BE(0);
      }
      default: return 0;
    }
  }

  // ─────────────────────────────────────────────
  // Signal engine proxy
  // ─────────────────────────────────────────────

  startSignal(signalCfg) { return this._signalEngine.start(signalCfg); }
  stopSignal(id)         { return this._signalEngine.stop(id); }
  stopAllSignals()       { this._signalEngine.stopAll(); }

  // ─────────────────────────────────────────────
  // Snapshot for UI refresh
  // ─────────────────────────────────────────────

  getSnapshot(config) {
    const result = { bits: [], registers: [], signals: [] };

    if (config.bits) {
      for (const bit of config.bits) {
        const addr = parseInt(bit.address) - 1;
        result.bits.push({ address: bit.address, value: this.getCoil(addr) });
      }
    }

    if (config.registers) {
      for (const reg of config.registers) {
        const addr = parseInt(reg.address) - 40001;
        result.registers.push({
          address:  reg.address,
          value:    this.getRegister(addr, reg.dataType),
          dataType: reg.dataType
        });
      }
    }

    if (config.signals) {
      for (const sig of config.signals) {
        if (sig.registerType === 'coil') {
          const addr = parseInt(sig.address) - 1;
          result.signals.push({ address: sig.address, value: this.getCoil(addr) });
        } else {
          const addr = parseInt(sig.address) - 40001;
          result.signals.push({
            address:  sig.address,
            value:    this.getRegister(addr, sig.dataType),
            dataType: sig.dataType
          });
        }
      }
    }

    return result;
  }

  // ─────────────────────────────────────────────
  // Byte order helpers
  // ─────────────────────────────────────────────

  _applyByteOrder(buf, size) {
    switch (this._byteOrder) {
      case 'LE':    return size === 4 ? Buffer.from([buf[1],buf[0],buf[3],buf[2]]) : Buffer.from([buf[1],buf[0]]);
      case 'BE_BS': return size === 4 ? Buffer.from([buf[1],buf[0],buf[3],buf[2]]) : buf;
      case 'LE_BS': return size === 4 ? Buffer.from([buf[3],buf[2],buf[1],buf[0]]) : buf;
      default:      return buf;
    }
  }

  _reverseByteOrder(buf, size) { return this._applyByteOrder(buf, size); }

  // ─────────────────────────────────────────────
  // Callbacks
  // ─────────────────────────────────────────────

  onLog(cb)   { this._logCb   = cb; }
  onState(cb) { this._stateCb = cb; }

  _log(msg, type = 'info') {
    if (this._logCb) this._logCb({ ts: new Date().toISOString(), msg, type });
  }

  _emitState() {
    if (this._stateCb) {
      this._stateCb({ running: this._running, clients: this._clients, stats: this.stats });
    }
  }
}

module.exports = { ModbusServer };
