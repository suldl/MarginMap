import type { ElectronApi } from '../../electron/preload';
import type { LibraryData, Notebook } from '../types';
import { createElectronBackend } from './electron';
import { createWebBackend } from './web';

export interface OpenFile {
  name: string;
  bytes: Uint8Array;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface AppInfo {
  version: string;
  /** Where the library lives on disk (Electron only). */
  dataDir: string | null;
  electron?: string;
  chrome?: string;
  /** Where update checks look, or null when this build has no update source configured. */
  updateSource: string | null;
}

export interface UpdateResult {
  status: 'available' | 'current' | 'unconfigured' | 'unsupported' | 'error';
  current: string;
  latest?: string;
  /** Release page or installer download (https). */
  url?: string;
  notes?: string;
  publishedAt?: string;
  error?: string;
}

/** Persistence layer. Electron stores files under %APPDATA%; the browser build uses IndexedDB. */
export interface Backend {
  kind: 'electron' | 'web';
  loadLibrary(): Promise<LibraryData | null>;
  saveLibrary(lib: LibraryData): Promise<void>;
  saveDoc(id: string, bytes: Uint8Array): Promise<void>;
  readDoc(id: string): Promise<Uint8Array>;
  deleteDoc(id: string): Promise<void>;
  loadNotebook(id: string): Promise<Notebook | null>;
  saveNotebook(nb: Notebook): Promise<void>;
  deleteNotebook(id: string): Promise<void>;
  putAsset(id: string, blob: Blob): Promise<void>;
  getAsset(id: string): Promise<Blob | null>;
  deleteAsset(id: string): Promise<void>;
  /** Save an exported file. Returns false if the user cancelled. */
  saveFile(defaultName: string, data: string | Uint8Array, filters: FileFilter[]): Promise<boolean>;
  takeOpenFiles(): Promise<OpenFile[]>;
  onOpenFiles(cb: (files: OpenFile[]) => void): () => void;
  setTitleBar(color: string, symbolColor: string, height: number): void;
  /** Interface zoom (no-op in the browser build). */
  setZoom(factor: number): void;
  appInfo(): Promise<AppInfo>;
  checkForUpdates(): Promise<UpdateResult>;
  /** Opens the data folder in Explorer (Electron only). */
  openDataDir(): Promise<void>;
}

declare global {
  interface Window {
    marginmap?: ElectronApi;
  }
}

export const backend: Backend = window.marginmap ? createElectronBackend(window.marginmap) : createWebBackend();
export const isElectron = backend.kind === 'electron';
