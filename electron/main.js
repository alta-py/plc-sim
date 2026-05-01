// electron/main.js
'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs   = require('fs');

const isDev = process.env.NODE_ENV === 'development';

let mainWindow = null;

// ─────────────────────────────────────────────
// Window
// ─────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1280,
    height: 820,
    minWidth:  900,
    minHeight: 640,
    title: 'Synkro Dev Tools',
    icon: path.join(__dirname, '../ui/assets/icon.ico'),
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../ui/index.html'));

  if (isDev) mainWindow.webContents.openDevTools();
}

// ─────────────────────────────────────────────
// App lifecycle
// ─────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  buildMenu();
  require('../src/ipc-handlers');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─────────────────────────────────────────────
// Menu
// ─────────────────────────────────────────────

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Simulation',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow.webContents.send('menu:new')
        },
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const { canceled, filePaths } = await dialog.showOpenDialog({
              filters: [
                { name: 'Synkro Dev Tools Profiles', extensions: ['plcsim','iotcfg','modbusprofile'] },
                { name: 'All Files', extensions: ['*'] }
              ],
              properties: ['openFile']
            });
            if (!canceled && filePaths[0]) {
              mainWindow.webContents.send('menu:open', filePaths[0]);
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow.webContents.send('menu:save')
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow.webContents.send('menu:saveAs')
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Synkro Dev Tools',
          click: () => {
            dialog.showMessageBox({
              title:   'Synkro Dev Tools',
              message: 'Synkro Dev Tools v1.0.0\nAlta Ingeniería SRL\nPLC Simulator · Modbus Tester · IoT Simulator',
              type:    'info'
            });
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─────────────────────────────────────────────
// File dialog IPC handlers
// ─────────────────────────────────────────────

ipcMain.handle('dialog:save', async (event, { defaultName, ext, title }) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title:       title || 'Save',
    defaultPath: defaultName || 'profile',
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
  });
  return canceled ? null : filePath;
});

ipcMain.handle('dialog:open', async (event, { exts, title }) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title:   title || 'Open',
    filters: [{ name: 'Profile', extensions: exts }],
    properties: ['openFile']
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('file:write', async (event, { filePath, content }) => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('file:read', async (event, { filePath }) => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ─────────────────────────────────────────────
// Network info
// ─────────────────────────────────────────────

ipcMain.handle('net:localIps', async () => {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  const ips = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        ips.push({ ip: addr.address, name });
      }
    }
  }

  return ips;
});

module.exports = { mainWindow };
