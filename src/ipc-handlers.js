// src/ipc-handlers.js
'use strict';

const { ipcMain }        = require('electron');
const { ModbusServer }   = require('./plc-sim/modbus-server');
const { validate }       = require('./plc-sim/validator');
const { ModbusClient }   = require('./modbus-tester/modbus-client');
const { NetworkScanner } = require('./modbus-tester/scanner');
const { MqttPublisher }  = require('./iot-sim/mqtt-publisher');
const { MqttSubscriber } = require('./iot-sim/mqtt-subscriber');

function getWin() {
  const { mainWindow } = require('../electron/main');
  return mainWindow;
}

function send(channel, data) {
  try { getWin()?.webContents.send(channel, data); } catch (_) {}
}

// ═══════════════════════════════════════════════════════
// PLC SIMULATOR
// ═══════════════════════════════════════════════════════

const plcServer = new ModbusServer();

plcServer.onLog((entry)   => send('plc:log',   entry));
plcServer.onState((state) => send('plc:state', state));

ipcMain.handle('plc:start', async (_, cfg) => {
  return plcServer.start(cfg);
});

ipcMain.handle('plc:stop', async () => {
  return plcServer.stop();
});

ipcMain.handle('plc:setValue', async (_, { addr, val, dataType, registerType }) => {
  if (registerType === 'coil') {
    const idx = parseInt(addr) - 1;
    plcServer.setCoil(idx, Boolean(val));
  } else {
    const idx = parseInt(addr) - 40001;
    plcServer.setRegister(idx, Number(val), dataType || 'FLOAT32');
  }
  return { ok: true };
});

ipcMain.handle('plc:toggleBit', async (_, { addr }) => {
  const idx   = parseInt(addr) - 1;
  const value = plcServer.toggleCoil(idx);
  return { ok: true, value };
});

ipcMain.handle('plc:getValues', async (_, config) => {
  return plcServer.getSnapshot(config || {});
});

ipcMain.handle('plc:startSignal', async (_, signalCfg) => {
  return plcServer.startSignal(signalCfg);
});

ipcMain.handle('plc:stopSignal', async (_, { id }) => {
  return plcServer.stopSignal(id);
});

ipcMain.handle('plc:stopAllSignals', async () => {
  plcServer.stopAllSignals();
  return { ok: true };
});

ipcMain.handle('plc:validate', async (_, config) => {
  return validate(config);
});

ipcMain.handle('plc:getStatus', async () => {
  return { running: plcServer.isRunning, clients: plcServer.clientCount, stats: plcServer.stats };
});

// ═══════════════════════════════════════════════════════
// MODBUS TESTER
// ═══════════════════════════════════════════════════════

const mbClient  = new ModbusClient();
const mbScanner = new NetworkScanner();

mbClient.onLog((entry)   => send('mbtester:log',   entry));
mbClient.onState((state) => send('mbtester:state', state));

mbScanner.onResult((result) => send('mbtester:scanResult', result));
mbScanner.onDone((summary)  => send('mbtester:scanDone',   summary));

ipcMain.handle('mbtester:connect', async (_, cfg) => {
  return mbClient.connect(cfg);
});

ipcMain.handle('mbtester:disconnect', async () => {
  return mbClient.disconnect();
});

ipcMain.handle('mbtester:read', async (_, opts) => {
  return mbClient.read(opts);
});

ipcMain.handle('mbtester:write', async (_, opts) => {
  return mbClient.write(opts);
});

ipcMain.handle('mbtester:startPolling', async (_, { opts, intervalMs }) => {
  mbClient.startPolling(opts, intervalMs, (result) => {
    send('mbtester:pollData', result);
  });
  return { ok: true };
});

ipcMain.handle('mbtester:stopPolling', async () => {
  mbClient.stopPolling();
  return { ok: true };
});

ipcMain.handle('mbtester:scan', async (_, opts) => {
  mbScanner.scan(opts);
  return { ok: true };
});

ipcMain.handle('mbtester:scanStop', async () => {
  mbScanner.stop();
  return { ok: true };
});

ipcMain.handle('mbtester:getStatus', async () => {
  return { connected: mbClient.isConnected, polling: mbClient.isPolling, stats: mbClient.stats };
});

// ═══════════════════════════════════════════════════════
// IOT SIMULATOR
// ═══════════════════════════════════════════════════════

const iotPublisher  = new MqttPublisher();
const iotSubscriber = new MqttSubscriber();

iotPublisher.onLog((entry)       => send('iot:log',   entry));
iotPublisher.onState((state)     => send('iot:state', state));
iotSubscriber.onLog((entry)      => send('iot:log',     entry));
iotSubscriber.onMessage((message) => send('iot:message', message));

ipcMain.handle('iot:start', async (_, cfg) => {
  const connResult = await iotPublisher.connect(cfg);
  if (!connResult.ok) return connResult;

  iotSubscriber.setClient(iotPublisher.getClient());

  for (const sub of iotSubscriber.getSubscriptions()) {
    iotSubscriber.subscribe(sub.topic, sub.qos);
  }

  return iotPublisher.startPublishing();
});

ipcMain.handle('iot:stop', async () => {
  iotSubscriber.unsubscribeAll();
  return iotPublisher.stop();
});

ipcMain.handle('iot:updateFields', async (_, fields) => {
  if (iotPublisher._cfg) iotPublisher._cfg.fields = fields;
  return { ok: true };
});

ipcMain.handle('iot:subscribe', async (_, { topics }) => {
  const results = [];
  for (const { topic, qos } of topics) {
    results.push({ topic, ...iotSubscriber.subscribe(topic, qos || 0) });
  }
  return { ok: true, results };
});

ipcMain.handle('iot:unsubscribe', async (_, { topic }) => {
  return iotSubscriber.unsubscribe(topic);
});

ipcMain.handle('iot:getSubscriptions', async () => {
  return {
    subscriptions: iotSubscriber.getSubscriptions(),
    count:         iotSubscriber.subscriptionCount,
    max:           iotSubscriber.maxSubscriptions
  };
});

ipcMain.handle('iot:clearMessages', async (_, { topic }) => {
  if (topic) {
    iotSubscriber.clearMessages(topic);
  } else {
    iotSubscriber.clearAllMessages();
  }
  return { ok: true };
});

ipcMain.handle('iot:getStatus', async () => {
  return { connected: iotPublisher.isConnected, publishing: iotPublisher.isPublishing, stats: iotPublisher.stats };
});
