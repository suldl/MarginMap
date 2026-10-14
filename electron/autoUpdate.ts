import { app, BrowserWindow } from 'electron';
import { autoUpdater, type Logger, type UpdateInfo } from 'electron-updater';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { UpdateEvent, UpdateResult } from '../src/backend';

/**
 * In-app updates for the installed (NSIS) build, with electron-updater. electron-builder
 * publishes the installer, its .blockmap and latest.yml to a GitHub release and puts
 * app-update.yml (the repository to watch) into the installed app. Here we check, download
 * on request (the user clicks "Download update") and install on restart or on quit.
 *
 * MARGINMAP_UPDATE_GENERIC=<base url> points the updater at a folder that holds latest.yml and
 * the installer instead of GitHub (local testing).
 */

const genericFeed = () => process.env.MARGINMAP_UPDATE_GENERIC?.trim() || '';

/** True when this copy can replace itself: a packaged, installed (not portable) Windows build. */
export function canAutoUpdate(githubConfigured: boolean): boolean {
  if (!app.isPackaged || process.platform !== 'win32' || process.env.PORTABLE_EXECUTABLE_DIR) return false;
  if (genericFeed()) return true;
  return githubConfigured && existsSync(path.join(process.resourcesPath, 'app-update.yml'));
}

let wired = false;
let lastInfo: UpdateInfo | null = null;

function send(e: UpdateEvent) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('updates:event', e);
}

/** electron-updater's log goes to <data>/logs/updater.log, which helps when an update misbehaves. */
function fileLogger(): Logger {
  const file = path.join(app.getPath('userData'), 'logs', 'updater.log');
  const write = (level: string) => (message?: unknown) => {
    const line = `${new Date().toISOString()} ${level} ${message instanceof Error ? message.stack : String(message)}\n`;
    void fs
      .mkdir(path.dirname(file), { recursive: true })
      .then(() => fs.appendFile(file, line))
      .catch(() => {});
  };
  return { info: write('info'), warn: write('warn'), error: write('error'), debug: write('debug') };
}

function wire() {
  if (wired) return;
  wired = true;
  autoUpdater.logger = fileLogger();
  autoUpdater.autoDownload = false; // the user decides when to download
  autoUpdater.autoInstallOnAppQuit = true; // a downloaded update installs when the app quits
  autoUpdater.allowPrerelease = false;
  const generic = genericFeed();
  if (generic) autoUpdater.setFeedURL({ provider: 'generic', url: generic });
  autoUpdater.on('download-progress', (p) =>
    send({ type: 'progress', percent: p.percent, transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond }),
  );
  autoUpdater.on('update-downloaded', (info) => send({ type: 'downloaded', version: info.version }));
  autoUpdater.on('error', (err) => send({ type: 'error', message: friendlyError(err) }));
}

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ETIMEDOUT|ENOTFOUND/.test(msg)) {
    return 'Could not reach the update server — are you online?';
  }
  if (/404|Cannot find latest\.yml|No published versions/i.test(msg)) return 'No published release was found';
  // electron-updater errors can carry whole HTTP responses; keep the first line.
  return msg.split('\n')[0].slice(0, 300);
}

/** Release notes arrive as HTML (GitHub) or per-version entries; the settings page shows plain text. */
function plainNotes(notes: UpdateInfo['releaseNotes']): string | undefined {
  if (!notes) return undefined;
  const html = typeof notes === 'string' ? notes : notes.map((n) => `${n.version}\n${n.note ?? ''}`).join('\n\n');
  const text = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<\/\s*(p|li|h\d|div|ul|ol)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text ? text.slice(0, 4000) : undefined;
}

export async function checkAuto(current: string, releasePage?: string): Promise<UpdateResult> {
  wire();
  try {
    const res = await autoUpdater.checkForUpdates();
    if (!res) return { status: 'error', current, error: 'Updates are not available in this build' };
    lastInfo = res.updateInfo;
    const latest = res.updateInfo.version;
    return {
      status: res.isUpdateAvailable ? 'available' : 'current',
      current,
      latest,
      notes: plainNotes(res.updateInfo.releaseNotes),
      publishedAt: res.updateInfo.releaseDate,
      url: releasePage ? `${releasePage}/tag/v${latest}` : undefined,
      canInstall: res.isUpdateAvailable,
    };
  } catch (err) {
    return { status: 'error', current, error: friendlyError(err) };
  }
}

export async function downloadAuto(): Promise<void> {
  wire();
  if (!lastInfo) throw new Error('Check for updates first');
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    throw new Error(friendlyError(err));
  }
}

/** Quits and runs the downloaded installer silently, then starts the new version. */
export function installAuto() {
  wire();
  // Give the reply to the renderer a moment to go out before the windows close.
  setTimeout(() => autoUpdater.quitAndInstall(true, true), 150);
}
