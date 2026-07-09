// ============================================================
// IFFYWARE SYSTEMS — Electron main process
// Envuelve servidor.js + pvdelivery.html en una app de escritorio.
// El servidor Node corre embebido; la ventana apunta a localhost.
// ============================================================
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const http = require('http');

const PORT = process.env.PORT || 3000;
let win;

// Arranca servidor.js dentro del MISMO proceso de Electron (no un child_process
// separado) para evitar problemas de empaquetado con node embebido de electron-builder.
function arrancarServidor() {
  process.env.PORT = String(PORT);
  require(path.join(__dirname, '..', 'servidor.js'));
}

function esperarServidor(intentos = 30) {
  return new Promise((resolve, reject) => {
    const check = (n) => {
      http.get(`http://localhost:${PORT}/ping`, res => {
        if (res.statusCode === 200) return resolve();
        reintentar(n);
      }).on('error', () => reintentar(n));
    };
    const reintentar = (n) => {
      if (n <= 0) return reject(new Error('El servidor local no respondió a tiempo'));
      setTimeout(() => check(n - 1), 300);
    };
    check(intentos);
  });
}

function crearVentana() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0e14',
    icon: path.join(__dirname, '..', 'public', 'icons', 'icon-512.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  Menu.setApplicationMenu(null);
  win.loadURL(`http://localhost:${PORT}`);
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url); // links externos (ej. checkout Mercado Pago) al navegador
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  arrancarServidor();
  try {
    await esperarServidor();
  } catch (e) {
    console.error(e);
  }
  crearVentana();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) crearVentana(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
