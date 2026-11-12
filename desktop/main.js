'use strict';

// The window (phase 0). An ordinary window - NOT full screen and never maximised by itself (the owner, 2026-11-12):
// 1280x800 in the middle of the screen at the first start, then the size and place it was closed at
// (data/window.json). F11 full screen, Ctrl+Shift+I DevTools, Ctrl+R / F5 reload. The server runs inside this process on
// 127.0.0.1:38517 (the next free port if that is taken), on the owner's library beside the program - library/ - unless
// MUSIC_LIBRARY_DIR names another (a test). Chromium's profile lives in the library too, so one library is one copy of
// the app. MUSIC_NO_FOCUS=1 shows the window without taking the focus (tests).

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Menu, shell, screen, dialog } = require('electron');

const APP_DIR = path.resolve(__dirname, '..');
if (!process.env.MUSIC_LIBRARY_DIR) process.env.MUSIC_LIBRARY_DIR = path.join(APP_DIR, 'library');
const LIBRARY_DIR = path.resolve(process.env.MUSIC_LIBRARY_DIR);
const WINDOW_FILE = path.join(LIBRARY_DIR, 'data', 'window.json');

const { writeJsonAtomic } = require('../lib/atomic-write');

const TITLE = 'UGC Music Studio';
const PORT = 38517;
const FIRST = { width: 1280, height: 800 };
const MIN = { width: 960, height: 620 };
const BG = '#0f0f10';

app.setName(TITLE);
app.setPath('userData', path.join(LIBRARY_DIR, 'cache', 'profile'));

let win = null;
let origin = '';

// ── Size and place ──────────────────────────────────────────────────────────

function _saved() {
  try {
    const b = JSON.parse(fs.readFileSync(WINDOW_FILE, 'utf8'));
    if ([b.x, b.y, b.width, b.height].every(Number.isFinite)) return b;
  } catch { /* first start, or a broken file: the first size */ }
  return null;
}

// A saved place is used only while its head is on a screen that is still there (a second monitor unplugged since).
function _onScreen(b) {
  return screen.getAllDisplays().some(d => {
    const a = d.workArea;
    const w = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x);
    const h = Math.min(b.y + 40, a.y + a.height) - Math.max(b.y, a.y);
    return w >= 120 && h >= 20;
  });
}

function startBounds() {
  const s = _saved();
  if (s && _onScreen(s)) {
    return { x: s.x, y: s.y, width: Math.max(MIN.width, s.width), height: Math.max(MIN.height, s.height) };
  }
  const a = screen.getPrimaryDisplay().workArea;
  const width = Math.min(FIRST.width, a.width);
  const height = Math.min(FIRST.height, a.height);
  return { x: a.x + Math.round((a.width - width) / 2), y: a.y + Math.round((a.height - height) / 2), width, height };
}

// The ordinary size and place - the one before a maximise; nothing is written while in full screen.
function saveBounds() {
  if (!win || win.isDestroyed() || win.isFullScreen()) return;
  const b = win.getNormalBounds();
  try {
    writeJsonAtomic(WINDOW_FILE, { x: b.x, y: b.y, width: b.width, height: b.height });
  } catch (e) {
    console.error('[window] could not remember the size: ' + e.message);
  }
}

let _saveTimer = null;
function saveSoon() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveBounds, 600);
}

// ── The window ──────────────────────────────────────────────────────────────

function _keys(event, input) {
  if (input.type !== 'keyDown') return;
  const k = String(input.key || '').toLowerCase();
  if (input.key === 'F11') {
    event.preventDefault();
    win.setFullScreen(!win.isFullScreen());
  } else if (input.control && input.shift && k === 'i') {
    event.preventDefault();
    win.webContents.toggleDevTools();
  } else if (input.key === 'F5' || (input.control && !input.shift && k === 'r')) {
    event.preventDefault();
    win.webContents.reload();
  }
}

// The right button on a field: the edit menu (the window has no menu bar to give it); on selected text: Copy. A page that
// draws its own menu prevents the event and this one never opens.
function _contextMenu(event, p) {
  const items = [];
  if (p.isEditable) {
    const f = p.editFlags || {};
    items.push(
      { role: 'undo', enabled: f.canUndo }, { role: 'redo', enabled: f.canRedo }, { type: 'separator' },
      { role: 'cut', enabled: f.canCut }, { role: 'copy', enabled: f.canCopy }, { role: 'paste', enabled: f.canPaste },
      { type: 'separator' }, { role: 'selectAll' },
    );
  } else if (p.selectionText && p.selectionText.trim()) {
    items.push({ role: 'copy' });
  }
  if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
}

// A link out of the app opens in the person's browser; the window itself never leaves the app.
function _external(url) {
  if (/^https?:\/\//i.test(url) && !url.startsWith(origin + '/')) shell.openExternal(url);
}

async function boot() {
  Menu.setApplicationMenu(null);
  let started;
  try {
    started = await require('../server').start({ port: PORT, tryNext: true });
  } catch (e) {
    dialog.showErrorBox(TITLE + ' cannot start', e.message + '\n\nLibrary: ' + LIBRARY_DIR);
    app.quit();
    return;
  }
  origin = started.url.replace(/\/$/, '');

  win = new BrowserWindow({
    ...startBounds(),
    minWidth: MIN.width,
    minHeight: MIN.height,
    show: false,
    title: TITLE,
    backgroundColor: BG,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.webContents.on('before-input-event', _keys);
  win.webContents.on('context-menu', _contextMenu);
  win.webContents.setWindowOpenHandler(({ url }) => { _external(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(origin + '/')) return;
    event.preventDefault();
    _external(url);
  });
  win.on('resize', saveSoon);
  win.on('move', saveSoon);
  win.on('close', () => { clearTimeout(_saveTimer); saveBounds(); });
  win.on('closed', () => { win = null; });
  win.once('ready-to-show', () => {
    if (process.env.MUSIC_NO_FOCUS === '1') win.showInactive();
    else win.show();
  });
  win.loadURL(started.url);
}

if (!app.requestSingleInstanceLock()) {
  // Another copy is open on this library: it comes forward (second-instance below) and this one goes.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(boot);
}
