import { createStore, del, get, set } from 'idb-keyval';
import type { LibraryData, Notebook } from '../types';
import type { Backend } from './index';

/** Browser fallback (used by `npm run dev:web`) backed by IndexedDB. */
export function createWebBackend(): Backend {
  const store = createStore('marginmap', 'kv');
  return {
    kind: 'web',
    loadLibrary: async () => (await get<LibraryData>('library', store)) ?? null,
    saveLibrary: (lib) => set('library', lib, store),
    saveDoc: (id, bytes) => set(`doc:${id}`, bytes, store),
    async readDoc(id) {
      const bytes = await get<Uint8Array>(`doc:${id}`, store);
      if (!bytes) throw new Error('Document file is missing');
      return bytes;
    },
    deleteDoc: (id) => del(`doc:${id}`, store),
    loadNotebook: async (id) => (await get<Notebook>(`nb:${id}`, store)) ?? null,
    saveNotebook: (nb) => set(`nb:${nb.id}`, nb, store),
    deleteNotebook: (id) => del(`nb:${id}`, store),
    putAsset: (id, blob) => set(`asset:${id}`, blob, store),
    getAsset: async (id) => (await get<Blob>(`asset:${id}`, store)) ?? null,
    deleteAsset: (id) => del(`asset:${id}`, store),
    async saveFile(name, data) {
      const blob = new Blob([data as BlobPart]);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      return true;
    },
    takeOpenFiles: async () => [],
    onOpenFiles: () => () => {},
    setTitleBar() {},
    setZoom() {},
    appInfo: async () => ({ version: __APP_VERSION__, dataDir: null, updateSource: null, updateMode: 'none' }),
    checkForUpdates: async () => ({ status: 'unsupported', current: __APP_VERSION__ }),
    downloadUpdate: async () => {},
    installUpdate: async () => {},
    onUpdateEvent: () => () => {},
    openDataDir: async () => {},
    dataFolder: async () => null,
    pickDataFolder: async () => null,
    changeDataFolder: async () => {
      throw new Error('The browser version keeps its data in the browser');
    },
    onDataProgress: () => () => {},
  };
}
