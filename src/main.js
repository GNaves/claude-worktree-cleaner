'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog, Notification } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const core = require('./core');

let tray = null;
let win = null;
let lastScan = [];

// ---------- configuração simples em JSON ----------
const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
function loadCfg() {
  try { return { ...core.DEFAULTS, ...JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) }; }
  catch { return { ...core.DEFAULTS }; }
}
function saveCfg(c) {
  fs.mkdirSync(path.dirname(cfgFile()), { recursive: true });
  fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 2));
}

// ---------- ícone ----------
// macOS: iconTemplate.png (+@2x) é "template" (preto + alpha) e o sistema adapta ao tema.
// Linux: icon.png colorido (laranja), legível em painel claro e escuro.
function trayIcon() {
  const dir = path.join(__dirname, 'assets');
  if (process.platform === 'darwin') {
    const img = nativeImage.createFromPath(path.join(dir, 'iconTemplate.png'));
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromPath(path.join(dir, 'icon.png')).resize({ width: 22, height: 22 });
}

// ---------- janela ----------
function createWindow() {
  win = new BrowserWindow({
    width: 760,
    height: 560,
    show: false,
    frame: process.platform !== 'darwin' ? true : false,
    resizable: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // no macOS, esconde ao perder foco (comportamento de popover)
  if (process.platform === 'darwin') win.on('blur', () => win && !win.webContents.isDevToolsOpened() && win.hide());
  win.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); win.hide(); } });
}

function showWindow() {
  if (!win) createWindow();
  if (tray && process.platform === 'darwin') {
    const b = tray.getBounds();
    const w = win.getBounds();
    win.setPosition(Math.round(b.x + b.width / 2 - w.width / 2), b.y + b.height + 4, false);
  } else {
    win.center();
  }
  win.show();
  win.focus();
}

function toggleWindow() {
  if (win && win.isVisible()) win.hide(); else showWindow();
}

// ---------- tray ----------
function updateTray() {
  if (!tray) return;
  const cleanable = lastScan.filter((i) => i.status === 'stale').length;
  tray.setToolTip(`Claude Worktrees: ${lastScan.length} no total, ${cleanable} para limpar`);
  if (process.platform === 'darwin') tray.setTitle(cleanable ? ` ${cleanable}` : '');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Abrir (${cleanable} para limpar)`, click: showWindow },
    { label: 'Atualizar', click: () => doScan() },
    { type: 'separator' },
    { label: 'Sair', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

async function doScan() {
  lastScan = await core.scan(loadCfg());
  updateTray();
  if (win && !win.isDestroyed()) win.webContents.send('scan-updated', lastScan);
  return lastScan;
}

// ---------- IPC ----------
ipcMain.handle('scan', () => doScan());
ipcMain.handle('get-config', () => loadCfg());
ipcMain.handle('set-config', async (_e, patch) => {
  const c = { ...loadCfg(), ...patch };
  c.staleDays = Math.max(0, Number(c.staleDays) || 0);
  c.extraRoots = (c.extraRoots || []).filter(Boolean);
  saveCfg(c);
  return doScan().then(() => c);
});
ipcMain.handle('add-root', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return loadCfg();
  const c = loadCfg();
  if (!c.extraRoots.includes(r.filePaths[0])) c.extraRoots.push(r.filePaths[0]);
  saveCfg(c);
  await doScan();
  return c;
});

ipcMain.handle('remove', async (_e, { paths, force, deleteBranch }) => {
  // Revalida no main: usa os dados do último scan, nunca o que veio do renderer.
  const items = lastScan.filter((i) => paths.includes(i.path));
  if (force) {
    const ok = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Cancelar', 'Remover mesmo assim'],
      defaultId: 0,
      cancelId: 0,
      message: 'Forçar remoção?',
      detail: 'Alterações não commitadas e commits que só existem nessas worktrees serão PERDIDOS.',
    });
    if (ok.response !== 1) return [];
  }
  const results = await core.removeMany(items, { force: !!force, deleteBranch: deleteBranch !== false });
  await doScan();
  const done = results.filter((r) => r.removed).length;
  if (Notification.isSupported()) new Notification({ title: 'Claude Worktree Cleaner', body: `${done} de ${results.length} removida(s)` }).show();
  return results;
});

// ---------- ciclo de vida ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', showWindow);
  app.whenReady().then(async () => {
    if (process.platform === 'darwin') app.dock.hide();
    tray = new Tray(trayIcon());
    tray.on('click', toggleWindow);
    createWindow();
    updateTray();
    await doScan();
    setInterval(doScan, 30 * 60 * 1000); // reescaneia a cada 30 min
  });
  app.on('window-all-closed', (e) => e.preventDefault()); // continua na bandeja
}
