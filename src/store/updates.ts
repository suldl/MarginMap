import { create } from 'zustand';
import { backend, type UpdateEvent, type UpdateResult } from '../backend';
import { waitForSaves } from './notebook';
import { useSettings } from './settings';
import { useUi } from './ui';

export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';

interface UpdateState {
  phase: UpdatePhase;
  result: UpdateResult | null;
  checkedAt: number;
  progress: { percent: number; bytesPerSecond: number; total: number } | null;
  /** Problem while downloading (the check result stays visible). */
  downloadError: string | null;
  check(): Promise<UpdateResult | null>;
  /** Downloads the update in the background (installed app only). */
  download(): Promise<void>;
  /** Saves everything, then quits, installs and restarts. */
  install(): Promise<void>;
}

export const useUpdates = create<UpdateState>((set, get) => ({
  phase: 'idle',
  result: null,
  checkedAt: 0,
  progress: null,
  downloadError: null,

  async check() {
    const { phase } = get();
    if (phase === 'checking' || phase === 'downloading' || phase === 'ready') return get().result;
    set({ phase: 'checking', downloadError: null });
    let result: UpdateResult;
    try {
      result = await backend.checkForUpdates();
    } catch (err) {
      result = { status: 'error', current: __APP_VERSION__, error: (err as Error).message };
    }
    const now = Date.now();
    set({ result, checkedAt: now, phase: result.status === 'available' ? 'available' : result.status === 'error' ? 'error' : 'idle' });
    if (result.status === 'available' || result.status === 'current') useSettings.getState().set({ lastUpdateCheck: now });
    return result;
  },

  async download() {
    const { phase, result } = get();
    if (phase !== 'available' || !result?.canInstall) return;
    set({ phase: 'downloading', progress: { percent: 0, bytesPerSecond: 0, total: 0 }, downloadError: null });
    try {
      await backend.downloadUpdate();
      // 'downloaded' normally arrives as an event first; this covers an already-cached download.
      if (get().phase === 'downloading') set({ phase: 'ready', progress: null });
    } catch (err) {
      set({ phase: 'available', progress: null, downloadError: (err as Error).message });
    }
  },

  async install() {
    if (get().phase !== 'ready') return;
    await waitForSaves();
    await backend.installUpdate();
  },
}));

function onEvent(e: UpdateEvent) {
  const s = useUpdates.getState();
  if (e.type === 'progress') {
    if (s.phase === 'downloading') useUpdates.setState({ progress: { percent: e.percent, bytesPerSecond: e.bytesPerSecond, total: e.total } });
  } else if (e.type === 'downloaded') {
    useUpdates.setState({ phase: 'ready', progress: null });
    const ui = useUi.getState();
    if (ui.settings !== 'updates') {
      ui.toast(`MarginMap ${e.version} is ready to install`, 'info', { label: 'Restart', run: () => void useUpdates.getState().install() });
    }
  } else if (e.type === 'error' && s.phase === 'downloading') {
    useUpdates.setState({ phase: 'available', progress: null, downloadError: e.message });
  }
}

/** Listens for progress from the main process; call once at startup. */
export function initUpdates() {
  return backend.onUpdateEvent(onEvent);
}

const DAY = 20 * 3600e3;

/** Quietly checks once a day at startup (if enabled) and offers the new version in a toast. */
export async function autoCheckForUpdates() {
  const s = useSettings.getState();
  if (!s.autoUpdate || backend.kind !== 'electron' || Date.now() - s.lastUpdateCheck < DAY) return;
  const info = await backend.appInfo().catch(() => null);
  if (!info || info.updateMode === 'none') return;
  const res = await useUpdates.getState().check();
  if (res?.status !== 'available') return;
  const ui = useUi.getState();
  if (res.canInstall) {
    ui.toast(`MarginMap ${res.latest} is available`, 'info', {
      label: 'Update',
      run: () => {
        void useUpdates.getState().download();
        useUi.getState().openSettings('updates');
      },
    });
  } else {
    ui.toast(`MarginMap ${res.latest} is available`, 'info', { label: 'Details', run: () => useUi.getState().openSettings('updates') });
  }
}
