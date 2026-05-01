// src/modbus-tester/scanner.js
'use strict';

const net = require('net');

class NetworkScanner {
  constructor() {
    this._running   = false;
    this._onResult  = null;
    this._onDone    = null;
    this._cancelled = false;
  }

  async scan(opts) {
    if (this._running) return { ok: false, error: 'Scan already running' };

    this._running   = true;
    this._cancelled = false;

    const port       = opts.port       || 502;
    const timeout    = opts.timeout    || 500;
    const concurrent = opts.concurrent || 20;

    const ips   = this._expandRange(opts.startIp, opts.endIp);
    const found = [];

    for (let i = 0; i < ips.length && !this._cancelled; i += concurrent) {
      const batch   = ips.slice(i, i + concurrent);
      const results = await Promise.all(batch.map(ip => this._probe(ip, port, timeout)));

      for (const result of results) {
        if (result.open) {
          found.push(result);
          if (this._onResult) this._onResult(result);
        }
      }
    }

    this._running = false;
    if (this._onDone) this._onDone({ found, cancelled: this._cancelled });

    return { ok: true, found };
  }

  stop() {
    this._cancelled = true;
    this._running   = false;
  }

  onResult(cb) { this._onResult = cb; }
  onDone(cb)   { this._onDone   = cb; }

  _probe(ip, port, timeout) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const t0 = Date.now();

      const timer = setTimeout(() => {
        socket.destroy();
        resolve({ ip, port, open: false });
      }, timeout);

      socket.connect(port, ip, () => {
        clearTimeout(timer);
        const ms = Date.now() - t0;
        socket.destroy();
        resolve({ ip, port, open: true, ms });
      });

      socket.on('error', () => {
        clearTimeout(timer);
        resolve({ ip, port, open: false });
      });
    });
  }

  _expandRange(startIp, endIp) {
    const start = this._ipToInt(startIp);
    const end   = this._ipToInt(endIp);
    const ips   = [];
    for (let i = start; i <= end; i++) ips.push(this._intToIp(i));
    return ips;
  }

  _ipToInt(ip) {
    return ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct), 0) >>> 0;
  }

  _intToIp(int) {
    return [(int >>> 24) & 255, (int >>> 16) & 255, (int >>> 8) & 255, int & 255].join('.');
  }
}

module.exports = { NetworkScanner };
