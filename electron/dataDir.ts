import { app, dialog, type BrowserWindow } from 'electron';
import { existsSync, readFileSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { DataChangeMode, DataChangeResult, DataFolderInfo, DataFolderPick, DataProgress } from '../src/backend';

/**
 * Where the library lives. By default that's the app's own folder (%APPDATA%\MarginMap, or
 * MARGINMAP_DATA_DIR); Settings → Data can put it anywhere else. The choice is kept in
 * data-location.json in the app's own folder, which also holds the browser data (settings)
 * and the logs — those never move with the library.
 */

/** Everything a library consists of; the only things a move copies or removes. */
const LIBRARY_ENTRIES = ['docs', 'notebooks', 'assets', 'library.json'];
const IGNORED_FILES = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);

const appDir = () => app.getPath('userData');
const locationFile = () => path.join(appDir(), 'data-location.json');

let current = '';
let custom = false;
let available = true;
/** True while the library is being moved or switched: storage calls fail instead of writing to the wrong folder. */
let busy = false;
/** The folder last picked in the folder dialog; the only one the renderer may switch to. */
let picked: string | null = null;
const pendingWrites = new Set<Promise<unknown>>();

/** Reads the chosen folder. Call once, after the app folder (userData) is final. */
export function initDataDir() {
  let chosen: string | null = null;
  try {
    const saved = JSON.parse(readFileSync(locationFile(), 'utf8')) as { dataDir?: unknown };
    if (typeof saved.dataDir === 'string' && path.isAbsolute(saved.dataDir)) chosen = path.resolve(saved.dataDir);
  } catch {
    // no choice saved: the app's own folder
  }
  custom = !!chosen && !samePath(chosen, appDir());
  current = custom ? chosen! : appDir();
  refresh();
}

/** A chosen folder can go away: an unplugged drive, an offline network share, a renamed folder. */
function refresh() {
  available = !custom || isDir(current);
}

/** The library folder. Throws while it is unavailable or being moved, so nothing is written to the wrong place. */
export function dataDir(): string {
  if (busy) throw new Error('The library is being moved');
  if (!available) throw new Error(`The data folder is not available: ${current}`);
  return current;
}

export const isDataDirBusy = () => busy;

/** Registers a storage write so a move waits for it to finish. */
export function trackWrite<T>(p: Promise<T>): Promise<T> {
  pendingWrites.add(p);
  const done = () => pendingWrites.delete(p);
  p.then(done, done);
  return p;
}

export async function dataStatus(): Promise<DataFolderInfo> {
  refresh();
  const contents = available ? await summarize(current) : { hasLibrary: false, docs: 0, notebooks: 0, bytes: 0 };
  return { dir: current, defaultDir: appDir(), custom, available, ...contents };
}

/** Asks for a folder (or takes the app's own folder) and reports what is in it. Null when cancelled. */
export async function pickDataDir(win: BrowserWindow | null, useDefault: boolean): Promise<DataFolderPick | null> {
  let dir = appDir();
  if (!useDefault) {
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose a folder for your MarginMap library',
      buttonLabel: 'Select folder',
      defaultPath: custom ? path.dirname(current) : app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || !res.filePaths[0]) return null;
    dir = path.resolve(res.filePaths[0]);
    // Keep the library in a folder of its own instead of spreading it over a drive or a busy folder.
    if (!isLibrary(dir) && !samePath(dir, appDir()) && (isRoot(dir) || !(await isEmptyDir(dir)))) dir = path.join(dir, 'MarginMap');
  }
  picked = dir;
  return inspect(dir);
}

async function inspect(dir: string): Promise<DataFolderPick> {
  const base = { dir, isDefault: samePath(dir, appDir()), hasLibrary: false, docs: 0, notebooks: 0, bytes: 0 };
  if (samePath(dir, current)) return { ...base, error: 'Your library is already in this folder.' };
  if (LIBRARY_ENTRIES.some((e) => within(dir, path.join(current, e)))) return { ...base, error: 'Choose a folder outside the current library.' };
  if (existsSync(dir) && !isDir(dir)) return { ...base, error: 'That is a file, not a folder.' };
  try {
    await probeWritable(dir);
  } catch {
    return { ...base, error: 'MarginMap can’t write to this folder. Choose another one.' };
  }
  return { ...base, ...(await summarize(dir)) };
}

/**
 * 'move' copies the library to `dir` and then removes the old copy, 'switch' opens the library
 * already in `dir`, 'new' starts an empty library there. The renderer reloads afterwards.
 */
export async function changeDataDir(dir: string, mode: DataChangeMode, onProgress: (p: DataProgress) => void): Promise<DataChangeResult> {
  if (busy) throw new Error('The library is already being moved');
  if (!['move', 'switch', 'new'].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
  const target = path.resolve(dir);
  if (!picked || !samePath(target, picked)) throw new Error('Choose the folder first');
  const info = await inspect(target);
  if (info.error) throw new Error(info.error);
  if (mode === 'switch' && !info.hasLibrary) throw new Error('There is no MarginMap library in this folder.');
  if (mode !== 'switch' && info.hasLibrary) throw new Error('This folder already contains a MarginMap library.');
  refresh();
  if (mode === 'move' && !available) throw new Error('The current data folder is not available, so there is nothing to move.');

  busy = true;
  try {
    // Saves that were already under way finish in the old folder (and move with it).
    await Promise.allSettled([...pendingWrites]);
    const from = current;
    if (mode === 'move') await copyLibrary(from, target, onProgress);
    else await fs.mkdir(target, { recursive: true });
    await saveLocation(target);
    current = target;
    custom = !samePath(target, appDir());
    available = true;
    picked = null;
    return { warning: mode === 'move' ? await removeLibrary(from) : undefined };
  } finally {
    busy = false;
  }
}

async function copyLibrary(from: string, to: string, onProgress: (p: DataProgress) => void) {
  const files = await listLibraryFiles(from);
  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  const created = LIBRARY_ENTRIES.filter((e) => !existsSync(path.join(to, e)));
  let bytes = 0;
  let sentAt = 0;
  try {
    await fs.mkdir(to, { recursive: true });
    for (const [i, f] of files.entries()) {
      const dest = path.join(to, f.rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(path.join(from, f.rel), dest);
      if ((await fs.stat(dest)).size !== f.size) throw new Error(`${f.rel} was not copied completely`);
      bytes += f.size;
      if (Date.now() - sentAt > 100 || i === files.length - 1) {
        sentAt = Date.now();
        onProgress({ files: i + 1, totalFiles: files.length, bytes, totalBytes });
      }
    }
  } catch (err) {
    // Leave the new folder as it was; the library stays where it is.
    await Promise.all(created.map((e) => fs.rm(path.join(to, e), { recursive: true, force: true }).catch(() => {})));
    throw new Error(`Could not copy the library: ${(err as Error).message}`);
  }
}

/** Removes the old copy after a move. Failures only leave stray files behind, so they are reported, not thrown. */
async function removeLibrary(dir: string): Promise<string | undefined> {
  const failed: string[] = [];
  // library.json first, so a half-removed folder no longer looks like a library.
  for (const e of [...LIBRARY_ENTRIES].reverse()) {
    await fs.rm(path.join(dir, e), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => failed.push(e));
  }
  // A folder that was chosen for the library goes too once it is empty (never the app's own folder).
  if (!samePath(dir, appDir())) await fs.rmdir(dir).catch(() => {});
  return failed.length ? `Some files could not be removed from the old folder (${failed.join(', ')}): ${dir}` : undefined;
}

async function saveLocation(dir: string) {
  if (samePath(dir, appDir())) await fs.rm(locationFile(), { force: true });
  else {
    await fs.mkdir(appDir(), { recursive: true });
    await fs.writeFile(locationFile(), JSON.stringify({ dataDir: dir }, null, 2));
  }
}

async function summarize(dir: string) {
  let docs = 0;
  let notebooks = 0;
  try {
    const lib = JSON.parse(await fs.readFile(path.join(dir, 'library.json'), 'utf8')) as { docs?: unknown[]; notebooks?: unknown[] };
    docs = lib.docs?.length ?? 0;
    notebooks = lib.notebooks?.length ?? 0;
  } catch {
    // missing or unreadable: counts stay 0
  }
  const bytes = (await listLibraryFiles(dir)).reduce((n, f) => n + f.size, 0);
  return { hasLibrary: isLibrary(dir), docs, notebooks, bytes };
}

/** The library's files, with library.json last so a half-copied folder never looks like a library. */
async function listLibraryFiles(dir: string): Promise<{ rel: string; size: number }[]> {
  const out: { rel: string; size: number }[] = [];
  const walk = async (rel: string) => {
    const abs = path.join(dir, rel);
    const st = await fs.stat(abs).catch(() => null);
    if (st?.isDirectory()) {
      for (const name of await fs.readdir(abs)) await walk(path.join(rel, name));
    } else if (st?.isFile() && !rel.endsWith('.tmp')) {
      out.push({ rel, size: st.size });
    }
  };
  for (const e of LIBRARY_ENTRIES) await walk(e);
  return out;
}

/** Checks the folder (or, if it doesn't exist yet, the closest existing parent) accepts new files. */
async function probeWritable(dir: string) {
  let probe = dir;
  while (!existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  const file = path.join(probe, `.marginmap-${process.pid}.tmp`);
  await fs.writeFile(file, '');
  await fs.rm(file, { force: true });
}

async function isEmptyDir(dir: string) {
  const names = await fs.readdir(dir).catch(() => []);
  return names.every((n) => IGNORED_FILES.has(n.toLowerCase()));
}

const isLibrary = (dir: string) => existsSync(path.join(dir, 'library.json'));
const isRoot = (dir: string) => path.parse(dir).root === dir;

function isDir(dir: string) {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function samePath(a: string, b: string) {
  const norm = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(a) === norm(b);
}

/** `child` is `parent` or somewhere inside it. */
function within(child: string, parent: string) {
  const rel = path.relative(parent, child);
  return !rel || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
