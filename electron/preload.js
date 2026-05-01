// electron/preload.js
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

  // ── Menu events (listen) ──
  onMenuNew:    (cb) => ipcRenderer.on('menu:new',    () => cb()),
  onMenuOpen:   (cb) => ipcRenderer.on('menu:open',   (_, fp) => cb(fp)),
  onMenuSave:   (cb) => ipcRenderer.on('menu:save',   () => cb()),
  onMenuSaveAs: (cb) => ipcRenderer.on('menu:saveAs', () => cb()),

  // ── File dialogs ──
  saveDialog: (opts) => ipcRenderer.invoke('dialog:save', opts),
  openDialog: (opts) => ipcRenderer.invoke('dialog:open', opts),
  writeFile:  (opts) => ipcRenderer.invoke('file:write',  opts),
  readFile:   (opts) => ipcRenderer.invoke('file:read',   opts),

  // ── Network ──
  getLocalIps: () => ipcRenderer.invoke('net:localIps'),

  // ── PLC Simulator ──
  plcStart:         (cfg)                        => ipcRenderer.invoke('plc:start',         cfg),
  plcStop:          ()                           => ipcRenderer.invoke('plc:stop'),
  plcSetValue:      (addr, val, dataType, registerType) => ipcRenderer.invoke('plc:setValue', { addr, val, dataType, registerType }),
  plcToggleBit:     (addr)                       => ipcRenderer.invoke('plc:toggleBit',      { addr }),
  plcGetValues:     (config)                     => ipcRenderer.invoke('plc:getValues',       config),
  plcStartSignal:   (signalCfg)                  => ipcRenderer.invoke('plc:startSignal',    signalCfg),
  plcStopSignal:    (id)                         => ipcRenderer.invoke('plc:stopSignal',     { id }),
  plcStopAllSignals:()                           => ipcRenderer.invoke('plc:stopAllSignals'),
  plcValidate:      (config)                     => ipcRenderer.invoke('plc:validate',       config),
  plcGetStatus:     ()                           => ipcRenderer.invoke('plc:getStatus'),
  onPlcLog:         (cb)                         => ipcRenderer.on('plc:log',   (_, msg) => cb(msg)),
  onPlcState:       (cb)                         => ipcRenderer.on('plc:state', (_, s)   => cb(s)),

  // ── Modbus Tester ──
  modbusConnect:      (cfg)          => ipcRenderer.invoke('mbtester:connect',      cfg),
  modbusDisconnect:   ()             => ipcRenderer.invoke('mbtester:disconnect'),
  modbusRead:         (opts)         => ipcRenderer.invoke('mbtester:read',         opts),
  modbusWrite:        (opts)         => ipcRenderer.invoke('mbtester:write',        opts),
  modbusStartPolling: (opts, intervalMs) => ipcRenderer.invoke('mbtester:startPolling', { opts, intervalMs }),
  modbusStopPolling:  ()             => ipcRenderer.invoke('mbtester:stopPolling'),
  modbusGetStatus:    ()             => ipcRenderer.invoke('mbtester:getStatus'),
  modbusScan:         (opts)         => ipcRenderer.invoke('mbtester:scan',         opts),
  modbusScanStop:     ()             => ipcRenderer.invoke('mbtester:scanStop'),
  onModbusLog:        (cb)           => ipcRenderer.on('mbtester:log',        (_, m) => cb(m)),
  onScanResult:       (cb)           => ipcRenderer.on('mbtester:scanResult', (_, r) => cb(r)),

  // ── IoT Simulator ──
  iotStart:         (cfg)        => ipcRenderer.invoke('iot:start',          cfg),
  iotStop:          ()           => ipcRenderer.invoke('iot:stop'),
  iotSubscribe:     (topics)     => ipcRenderer.invoke('iot:subscribe',       { topics }),
  iotUnsubscribe:   (topic)      => ipcRenderer.invoke('iot:unsubscribe',     { topic }),
  iotClearMessages: (opts)       => ipcRenderer.invoke('iot:clearMessages',   opts || {}),
  onIotLog:         (cb)         => ipcRenderer.on('iot:log',     (_, m) => cb(m)),
  onIotMessage:     (cb)         => ipcRenderer.on('iot:message', (_, m) => cb(m)),
  onIotState:       (cb)         => ipcRenderer.on('iot:state',   (_, s) => cb(s))
});
