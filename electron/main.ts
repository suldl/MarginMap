import { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, shell, Menu } from 'electron';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import pkg from '../package.json';
import { canAutoUpdate, checkAuto, downloadAuto, installAuto } from './autoUpdate';
import { checkForUpdates, describeFeed, resolveFeed } from './updates';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIR = path.join(__dirname, '..', 'dist');

// Optional override (portable installs, automated tests).
if (process.env.MARGINMAP_DATA_DIR) app.setPath('userData', path.resolve(process.env.MARGINMAP_DATA_DIR));

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

// ---------------------------------------------------------------------------
// Storage layout (inside %APPDATA%/MarginMap):
//   library.json            document + notebook index
//   docs/<id>.pdf           imported documents
//   notebooks/<id>.json     cards, mind map and review state
//   assets/<id>.<ext>       area-excerpt images and thumbnails
// ---------------------------------------------------------------------------

const dataDir = () => app.getPath('userData');
const docPath = (id: string) => path.join(dataDir(), 'docs', `${safeId(id)}.pdf`);
const notebookPath = (id: string) => path.join(dataDir(), 'notebooks', `${safeId(id)}.json`);
const assetDir = () => path.join(dataDir(), 'assets');
const libraryPath = () => path.join(dataDir(), 'library.json');

const MIME_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function safeId(id: string): string {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error(`Invalid id: ${id}`);
  return id;
}

let tmpSeq = 0;

async function writeAtomic(file: string, data: string | Uint8Array) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${++tmpSeq}.tmp`;
  await fs.writeFile(tmp, data);
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, file);
      return;
    } catch (err) {
      // Antivirus / indexers on Windows can briefly lock the target file.
      if (attempt >= 4) {
        await fs.copyFile(tmp, file);
        await fs.rm(tmp, { force: true });
        return;
      }
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
      void err;
    }
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function registerIpc() {
  ipcMain.handle('lib:load', () => readJson(libraryPath()));
  ipcMain.handle('lib:save', (_e, data: unknown) => writeAtomic(libraryPath(), JSON.stringify(data)));

  ipcMain.handle('doc:save', (_e, id: string, bytes: Uint8Array) => writeAtomic(docPath(id), bytes));
  ipcMain.handle('doc:read', async (_e, id: string) => new Uint8Array(await fs.readFile(docPath(id))));
  ipcMain.handle('doc:delete', (_e, id: string) => fs.rm(docPath(id), { force: true }));

  ipcMain.handle('nb:load', (_e, id: string) => readJson(notebookPath(id)));
  ipcMain.handle('nb:save', (_e, nb: { id: string }) => writeAtomic(notebookPath(nb.id), JSON.stringify(nb)));
  ipcMain.handle('nb:delete', (_e, id: string) => fs.rm(notebookPath(id), { force: true }));

  ipcMain.handle('asset:put', (_e, id: string, bytes: Uint8Array, mime: string) =>
    writeAtomic(path.join(assetDir(), `${safeId(id)}.${MIME_EXT[mime] ?? 'bin'}`), bytes),
  );
  ipcMain.handle('asset:get', async (_e, id: string) => {
    safeId(id);
    for (const [mime, ext] of Object.entries(MIME_EXT)) {
      const file = path.join(assetDir(), `${id}.${ext}`);
      if (existsSync(file)) return { bytes: new Uint8Array(await fs.readFile(file)), mime };
    }
    return null;
  });
  ipcMain.handle('asset:delete', async (_e, id: string) => {
    safeId(id);
    await Promise.all(Object.values(MIME_EXT).map((ext) => fs.rm(path.join(assetDir(), `${id}.${ext}`), { force: true })));
  });

  ipcMain.handle(
    'file:save',
    async (e, defaultName: string, data: string | Uint8Array, filters: Electron.FileFilter[]) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      const opts = { defaultPath: path.join(app.getPath('documents'), defaultName), filters };
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (res.canceled || !res.filePath) return false;
      await fs.writeFile(res.filePath, data);
      return true;
    },
  );

  ipcMain.handle('open:take', async () => {
    const files = await readPdfArgs(pendingOpenPaths.splice(0));
    return files;
  });

  ipcMain.handle('titlebar:set', (e, color: string, symbolColor: string, height?: number) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    // The overlay height follows the interface zoom so the window buttons line up with the title bar.
    const h = Math.round(Math.min(80, Math.max(24, Number(height) || 40)));
    if (win && process.platform === 'win32') win.setTitleBarOverlay({ color, symbolColor, height: h });
  });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dataDir: dataDir(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    updateSource: process.env.MARGINMAP_UPDATE_GENERIC && canAutoUpdate(false) ? process.env.MARGINMAP_UPDATE_GENERIC : describeFeed(updateFeed()),
    updateMode: updateMode(),
  }));
  // Installed builds update themselves; the portable copy and dev runs only point to the release page.
  ipcMain.handle('updates:check', () =>
    updateMode() === 'auto' ? checkAuto(app.getVersion(), releasePage()) : checkForUpdates(app.getVersion(), updateFeed()),
  );
  ipcMain.handle('updates:download', () => downloadAuto());
  ipcMain.handle('updates:install', () => installAuto());
  ipcMain.handle('app:openDataDir', async () => {
    await fs.mkdir(dataDir(), { recursive: true });
    await shell.openPath(dataDir());
  });
}

// ---------------------------------------------------------------------------
// Updates. The GitHub repository comes from package.json → build.publish (the same
// setting electron-builder publishes to); "OWNER" is the placeholder until it is set.
// ---------------------------------------------------------------------------

const githubRepo = (() => {
  const publish = (pkg as { build?: { publish?: { provider: string; owner?: string; repo?: string }[] } }).build?.publish ?? [];
  const gh = publish.find((p) => p.provider === 'github');
  return gh?.owner && gh.repo && gh.owner !== 'OWNER' ? `${gh.owner}/${gh.repo}` : undefined;
})();

/** Feed for the notify-only check (MARGINMAP_UPDATE_URL overrides it). */
const updateFeed = () => resolveFeed(githubRepo);
const releasePage = () => (githubRepo ? `https://github.com/${githubRepo}/releases` : undefined);

function updateMode(): 'auto' | 'notify' | 'none' {
  // An explicit notify feed (tests) wins over the installed app's own updater.
  if (!process.env.MARGINMAP_UPDATE_URL && canAutoUpdate(!!githubRepo)) return 'auto';
  return updateFeed() ? 'notify' : 'none';
}

// ---------------------------------------------------------------------------
// "Open with…" / file association support
// ---------------------------------------------------------------------------

const pendingOpenPaths: string[] = pdfPathsFromArgv(process.argv);

function pdfPathsFromArgv(argv: string[]): string[] {
  return argv.slice(1).filter((a) => !a.startsWith('-') && a.toLowerCase().endsWith('.pdf') && existsSync(a));
}

async function readPdfArgs(paths: string[]) {
  const out: { name: string; bytes: Uint8Array }[] = [];
  for (const p of paths) {
    try {
      out.push({ name: path.basename(p), bytes: new Uint8Array(await fs.readFile(p)) });
    } catch {
      // unreadable file: skip
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'MarginMap',
    backgroundColor: dark ? '#1b1b1f' : '#f4f4f6',
    titleBarStyle: 'hidden',
    titleBarOverlay:
      process.platform === 'win32'
        ? { color: dark ? '#1b1b1f' : '#f4f4f6', symbolColor: dark ? '#e8e8ea' : '#2a2a2e', height: 40 }
        : undefined,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow = win;

  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('app://');
    if (!allowed) event.preventDefault();
  });
  win.webContents.on('before-input-event', (event, input) => {
    const devtools = input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i');
    if (input.type === 'keyDown' && devtools) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadURL('app://bundle/index.html');
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const file = path.normalize(path.join(RENDERER_DIR, rel));
    if (!file.startsWith(RENDERER_DIR)) return new Response('Forbidden', { status: 403 });
    try {
      const data = await fs.readFile(file);
      const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      return new Response(new Uint8Array(data), { headers: { 'content-type': type } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', async (_event, argv) => {
    const win = mainWindow;
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const files = await readPdfArgs(pdfPathsFromArgv(argv));
    if (files.length) win.webContents.send('open:files', files);
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('app.marginmap.desktop');
    Menu.setApplicationMenu(null);
    registerAppProtocol();
    registerIpc();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
