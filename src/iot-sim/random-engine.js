// src/iot-sim/random-engine.js
'use strict';

function randomFloat(min, max, decimals = 1) {
  const val = Math.random() * (max - min) + min;
  return parseFloat(val.toFixed(decimals));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomBool(state) {
  return !state;
}

module.exports = { randomFloat, randomInt, randomBool };
