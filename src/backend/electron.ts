import type { ElectronApi } from '../../electron/preload';
import type { Backend } from './index';

export function createElectronBackend(api: ElectronApi): Backend {
  return {
    kind: 'electron',
    loadLibrary: () => api.loadLibrary(),
    saveLibrary: (lib) => api.saveLibrary(lib),
    saveDoc: (id, bytes) => api.saveDoc(id, bytes),
    readDoc: (id) => api.readDoc(id),
    deleteDoc: (id) => api.deleteDoc(id),
    loadNotebook: (id) => api.loadNotebook(id),
    saveNotebook: (nb) => api.saveNotebook(nb),
    deleteNotebook: (id) => api.deleteNotebook(id),
    async putAsset(id, blob) {
      await api.putAsset(id, new Uint8Array(await blob.arrayBuffer()), blob.type);
    },
    async getAsset(id) {
      const res = await api.getAsset(id);
      return res ? new Blob([res.bytes as Uint8Array<ArrayBuffer>], { type: res.mime }) : null;
    },
    deleteAsset: (id) => api.deleteAsset(id),
    saveFile: (name, data, filters) => api.saveFile(name, data, filters),
    takeOpenFiles: () => api.takeOpenFiles(),
    onOpenFiles: (cb) => api.onOpenFiles(cb),
    async capturePage(rect) {
      return new Blob([(await api.capturePage(rect)) as Uint8Array<ArrayBuffer>], { type: 'image/png' });
    },
    setTitleBar(color, symbolColor, height) {
      void api.setTitleBar(color, symbolColor, height);
    },
    setZoom: (factor) => api.setZoom(factor),
    appInfo: () => api.appInfo(),
    checkForUpdates: () => api.checkForUpdates(),
    downloadUpdate: () => api.downloadUpdate(),
    installUpdate: () => api.installUpdate(),
    onUpdateEvent: (cb) => api.onUpdateEvent(cb),
    openDataDir: () => api.openDataDir(),
    dataFolder: () => api.dataFolder(),
    pickDataFolder: (useDefault) => api.pickDataFolder(useDefault),
    changeDataFolder: (dir, mode) => api.changeDataFolder(dir, mode),
    onDataProgress: (cb) => api.onDataProgress(cb),
  };
}
