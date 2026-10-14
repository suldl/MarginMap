import { contextBridge, ipcRenderer, webFrame } from 'electron';
import type { AppInfo, DataChangeMode, DataChangeResult, DataFolderInfo, DataFolderPick, DataProgress, UpdateEvent, UpdateResult } from '../src/backend';

type OpenFile = { name: string; bytes: Uint8Array };

const api = {
  platform: process.platform,
  loadLibrary: () => ipcRenderer.invoke('lib:load'),
  saveLibrary: (data: unknown) => ipcRenderer.invoke('lib:save', data),
  saveDoc: (id: string, bytes: Uint8Array) => ipcRenderer.invoke('doc:save', id, bytes),
  readDoc: (id: string): Promise<Uint8Array> => ipcRenderer.invoke('doc:read', id),
  deleteDoc: (id: string) => ipcRenderer.invoke('doc:delete', id),
  loadNotebook: (id: string) => ipcRenderer.invoke('nb:load', id),
  saveNotebook: (nb: unknown) => ipcRenderer.invoke('nb:save', nb),
  deleteNotebook: (id: string) => ipcRenderer.invoke('nb:delete', id),
  putAsset: (id: string, bytes: Uint8Array, mime: string) => ipcRenderer.invoke('asset:put', id, bytes, mime),
  getAsset: (id: string): Promise<{ bytes: Uint8Array; mime: string } | null> => ipcRenderer.invoke('asset:get', id),
  deleteAsset: (id: string) => ipcRenderer.invoke('asset:delete', id),
  saveFile: (name: string, data: string | Uint8Array, filters: { name: string; extensions: string[] }[]) =>
    ipcRenderer.invoke('file:save', name, data, filters) as Promise<boolean>,
  takeOpenFiles: (): Promise<OpenFile[]> => ipcRenderer.invoke('open:take'),
  onOpenFiles: (cb: (files: OpenFile[]) => void) => {
    const handler = (_e: unknown, files: OpenFile[]) => cb(files);
    ipcRenderer.on('open:files', handler);
    return () => {
      ipcRenderer.removeListener('open:files', handler);
    };
  },
  setTitleBar: (color: string, symbolColor: string, height: number) => ipcRenderer.invoke('titlebar:set', color, symbolColor, height),
  setZoom: (factor: number) => {
    if (Number.isFinite(factor) && factor >= 0.5 && factor <= 2) webFrame.setZoomFactor(factor);
  },
  appInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
  checkForUpdates: (): Promise<UpdateResult> => ipcRenderer.invoke('updates:check'),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke('updates:download'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('updates:install'),
  onUpdateEvent: (cb: (e: UpdateEvent) => void) => {
    const handler = (_e: unknown, ev: UpdateEvent) => cb(ev);
    ipcRenderer.on('updates:event', handler);
    return () => {
      ipcRenderer.removeListener('updates:event', handler);
    };
  },
  openDataDir: (): Promise<void> => ipcRenderer.invoke('app:openDataDir'),
  dataFolder: (): Promise<DataFolderInfo> => ipcRenderer.invoke('data:status'),
  pickDataFolder: (useDefault: boolean): Promise<DataFolderPick | null> => ipcRenderer.invoke('data:pick', useDefault),
  changeDataFolder: (dir: string, mode: DataChangeMode): Promise<DataChangeResult> => ipcRenderer.invoke('data:change', dir, mode),
  onDataProgress: (cb: (p: DataProgress) => void) => {
    const handler = (_e: unknown, p: DataProgress) => cb(p);
    ipcRenderer.on('data:progress', handler);
    return () => {
      ipcRenderer.removeListener('data:progress', handler);
    };
  },
};

export type ElectronApi = typeof api;

contextBridge.exposeInMainWorld('marginmap', api);
