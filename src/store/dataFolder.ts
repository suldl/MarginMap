import { create } from 'zustand';
import { backend, type DataChangeMode, type DataFolderInfo, type DataFolderPick, type DataProgress } from '../backend';
import { waitForLibrarySave } from './library';
import { useNotebook, waitForSaves } from './notebook';
import { useUi } from './ui';

/** Survives the reload that follows a change, so the new window can say what happened. */
const CHANGED_KEY = 'marginmap.dataFolderChanged';

interface Changed {
  mode: DataChangeMode;
  dir: string;
  warning?: string;
  /** Reopen Settings → Data (the change was made from there). */
  reopen: boolean;
}

interface DataFolderState {
  /** The folder being switched to; the dialog is open while it is set. */
  pick: DataFolderPick | null;
  /** The library being left, as it was when the folder was picked. */
  from: DataFolderInfo | null;
  phase: 'choose' | 'working' | 'error';
  progress: DataProgress | null;
  error: string | null;
  /** Asks for a folder (or takes the default one) and opens the dialog for it. */
  choose(useDefault?: boolean): Promise<void>;
  apply(mode: DataChangeMode): Promise<void>;
  cancel(): void;
}

/** Electron prefixes errors thrown in the main process with "Error invoking remote method …". */
const cleanError = (err: unknown) => ((err as Error)?.message ?? String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export const useDataFolder = create<DataFolderState>((set, get) => ({
  pick: null,
  from: null,
  phase: 'choose',
  progress: null,
  error: null,

  async choose(useDefault = false) {
    try {
      const pick = await backend.pickDataFolder(useDefault);
      if (!pick) return;
      if (pick.error) {
        useUi.getState().toast(pick.error, 'error');
        return;
      }
      set({ pick, from: await backend.dataFolder(), phase: 'choose', progress: null, error: null });
    } catch (err) {
      useUi.getState().toast(cleanError(err), 'error');
    }
  },

  async apply(mode) {
    const pick = get().pick;
    if (!pick || get().phase === 'working') return;
    set({ phase: 'working', progress: null, error: null });
    const reopen = !!useUi.getState().settings;
    try {
      // Close the open notebook and let every pending save reach the disk before the files move.
      useUi.getState().navigate({ name: 'library' });
      await useNotebook.getState().close();
      await new Promise((r) => setTimeout(r, 50)); // views flush their own debounced saves when they unmount
      await waitForSaves();
      await waitForLibrarySave();
      const res = await backend.changeDataFolder(pick.dir, mode);
      const changed: Changed = { mode, dir: pick.dir, warning: res.warning, reopen };
      sessionStorage.setItem(CHANGED_KEY, JSON.stringify(changed));
      // Start over from the new folder: every store and cache reloads.
      location.reload();
    } catch (err) {
      set({ phase: 'error', error: cleanError(err) });
    }
  },

  cancel() {
    if (get().phase !== 'working') set({ pick: null, from: null, progress: null, error: null });
  },
}));

/** After the reload that follows a change: say where the library is now. */
export function announceDataFolderChange() {
  let changed: Changed | null = null;
  try {
    changed = JSON.parse(sessionStorage.getItem(CHANGED_KEY) ?? 'null') as Changed | null;
    sessionStorage.removeItem(CHANGED_KEY);
  } catch {
    return;
  }
  if (!changed) return;
  const ui = useUi.getState();
  if (changed.reopen) ui.openSettings('data');
  ui.toast(
    changed.mode === 'move'
      ? `Library moved to ${changed.dir}`
      : changed.mode === 'switch'
        ? `Opened the library in ${changed.dir}`
        : `Started a new library in ${changed.dir}`,
  );
  if (changed.warning) ui.toast(changed.warning, 'error');
}
