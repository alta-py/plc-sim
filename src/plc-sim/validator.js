// src/plc-sim/validator.js
'use strict';

function validate(config) {
  const errors = [];

  // ── Bits ────────────────────────────────────
  const bitAddrs = new Set();

  for (const bit of (config.bits || [])) {
    if (!bit.enabled) continue;

    const addr = parseInt(bit.address);

    if (isNaN(addr) || addr < 1 || addr > 65535) {
      errors.push({ field: 'bits', address: bit.address, message: `Invalid address: ${bit.address}` });
      continue;
    }

    if (bitAddrs.has(addr)) {
      errors.push({ field: 'bits', address: bit.address, message: `Duplicate address: ${bit.address}` });
    } else {
      bitAddrs.add(addr);
    }
  }

  // ── Registers ───────────────────────────────
  const regOccupied = new Map();

  for (const reg of (config.registers || [])) {
    if (!reg.enabled) continue;

    const addr = parseInt(reg.address);

    if (isNaN(addr) || addr < 40001 || addr > 49999) {
      errors.push({ field: 'registers', address: reg.address, message: `Address must be 40001–49999` });
      continue;
    }

    const regIdx  = addr - 40001;
    const regSize = (reg.dataType === 'INT16') ? 1 : 2;

    for (let i = 0; i < regSize; i++) {
      const idx = regIdx + i;
      if (regOccupied.has(idx)) {
        const prev = regOccupied.get(idx);
        errors.push({
          field:   'registers',
          address: reg.address,
          message: `Address ${addr} overlaps with ${prev.address} (${prev.dataType})`
        });
      } else {
        regOccupied.set(idx, { address: reg.address, dataType: reg.dataType, label: reg.label });
      }
    }
  }

  // ── Signals ─────────────────────────────────
  for (const sig of (config.signals || [])) {
    const addr   = parseInt(sig.address);
    const isCoil = sig.address.startsWith('0');

    if (isCoil) {
      if (isNaN(addr) || addr < 1 || addr > 65535) {
        errors.push({ field: 'signals', address: sig.address, message: `Invalid coil address` });
      }
      if (bitAddrs.has(addr)) {
        errors.push({ field: 'signals', address: sig.address, message: `Conflicts with manual bit ${sig.address}` });
      }
    } else {
      if (isNaN(addr) || addr < 40001 || addr > 49999) {
        errors.push({ field: 'signals', address: sig.address, message: `Address must be 40001–49999` });
      }
      const regIdx = addr - 40001;
      if (regOccupied.has(regIdx)) {
        const prev = regOccupied.get(regIdx);
        errors.push({ field: 'signals', address: sig.address, message: `Conflicts with manual register ${prev.address}` });
      }
    }

    if (['sine','square','triangle','ramp'].includes(sig.signalType)) {
      const { min, max } = sig.params || {};
      if (min !== undefined && max !== undefined && min >= max) {
        errors.push({ field: 'signals', address: sig.address, message: `min (${min}) must be less than max (${max})` });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = { validate };
