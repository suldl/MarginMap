import { create } from 'zustand';
import { backend, type UpdateResult } from '../backend';
import { useSettings } from './settings';
import { useUi } from './ui';

interface UpdateState {
  checking: boolean;
  result: UpdateResult | null;
  checkedAt: number;
  check(): Promise<UpdateResult | null>;
}

export const useUpdates = create<UpdateState>((set, get) => ({
  checking: false,
  result: null,
  checkedAt: 0,
  async check() {
    if (get().checking) return null;
    set({ checking: true });
    try {
      const result = await backend.checkForUpdates();
      const now = Date.now();
      set({ result, checkedAt: now });
      if (result.status === 'available' || result.status === 'current') useSettings.getState().set({ lastUpdateCheck: now });
      return result;
    } catch (err) {
      const result: UpdateResult = { status: 'error', current: __APP_VERSION__, error: (err as Error).message };
      set({ result, checkedAt: Date.now() });
      return result;
    } finally {
      set({ checking: false });
    }
  },
}));

const DAY = 20 * 3600e3;

/** Quietly checks once a day at startup (if enabled) and offers the new version in a toast. */
export async function autoCheckForUpdates() {
  const s = useSettings.getState();
  if (!s.autoUpdate || backend.kind !== 'electron' || Date.now() - s.lastUpdateCheck < DAY) return;
  const info = await backend.appInfo().catch(() => null);
  if (!info?.updateSource) return;
  const res = await useUpdates.getState().check();
  if (res?.status === 'available') {
    useUi.getState().toast(`MarginMap ${res.latest} is available`, 'info', {
      label: 'Details',
      run: () => useUi.getState().openSettings('updates'),
    });
  }
}
