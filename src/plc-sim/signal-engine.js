// src/plc-sim/signal-engine.js
'use strict';

class SignalEngine {
  constructor(modbusServer) {
    this._server  = modbusServer;
    this._signals = new Map();
  }

  start(cfg) {
    this.stop(cfg.id);

    let t = 0;

    const timer = setInterval(() => {
      const value = this._generate(cfg.signalType, cfg.params, t);
      this._write(cfg, value);
      t++;
    }, cfg.interval || 1000);

    this._signals.set(cfg.id, { timer, cfg, t: 0 });
    return { ok: true };
  }

  stop(id) {
    const sig = this._signals.get(id);
    if (!sig) return;
    clearInterval(sig.timer);
    this._signals.delete(id);
  }

  stopAll() {
    for (const [id] of this._signals) this.stop(id);
  }

  isRunning(id) { return this._signals.has(id); }

  // ─────────────────────────────────────────────
  // Value generators
  // ─────────────────────────────────────────────

  _generate(type, p, t) {
    switch (type) {

      case 'sine': {
        const { min = 0, max = 100, period = 30 } = p;
        const mid  = (min + max) / 2;
        const amp  = (max - min) / 2;
        const freq = (2 * Math.PI) / period;
        return mid + amp * Math.sin(freq * t);
      }

      case 'square': {
        const { low = 0, high = 100, period = 20 } = p;
        return (t % period) < (period / 2) ? high : low;
      }

      case 'triangle': {
        const { min = 0, max = 100, period = 60 } = p;
        const half  = period / 2;
        const phase = t % period;
        if (phase < half) {
          return min + (max - min) * (phase / half);
        } else {
          return max - (max - min) * ((phase - half) / half);
        }
      }

      case 'ramp': {
        const { min = 0, max = 100, period = 60 } = p;
        return min + (max - min) * ((t % period) / period);
      }

      case 'randomWalk': {
        if (!this._rwValues) this._rwValues = {};
        const key = JSON.stringify(p);
        if (this._rwValues[key] === undefined) {
          this._rwValues[key] = p.initial ?? (p.min + p.max) / 2;
        }
        const { delta = 1, min = 0, max = 100 } = p;
        this._rwValues[key] += (Math.random() * 2 - 1) * delta;
        this._rwValues[key]  = Math.max(min, Math.min(max, this._rwValues[key]));
        return this._rwValues[key];
      }

      case 'blink':
      case 'blinkFast':
      case 'blinkSlow':
        return (t % 2) === 0;

      case 'counter': {
        const { increment = 1, max = 9999 } = p;
        return (t * increment) % (max + 1);
      }

      case 'step': {
        const { steps = [0, 25, 50, 75, 100], stepTime = 10 } = p;
        const idx = Math.floor(t / stepTime) % steps.length;
        return steps[idx];
      }

      default: return 0;
    }
  }

  _write(cfg, value) {
    if (cfg.registerType === 'coil') {
      const addr = parseInt(cfg.address) - 1;
      this._server.setCoil(addr, Boolean(value));
    } else {
      const addr = parseInt(cfg.address) - 40001;
      this._server.setRegister(addr, Number(value), cfg.dataType || 'FLOAT32');
    }
  }
}

const SIGNAL_TYPES = [
  'sine', 'square', 'triangle', 'ramp',
  'randomWalk', 'blink', 'blinkFast', 'blinkSlow',
  'counter', 'step'
];

module.exports = { SignalEngine, SIGNAL_TYPES };
