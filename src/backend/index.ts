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
  /**
   * 'auto': the installed app downloads and installs updates itself.
   * 'notify': only reports new versions and links to the download page (portable copy, development runs).
   * 'none': no update source configured.
   */
  updateMode: 'auto' | 'notify' | 'none';
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
  /** The update can be downloaded and installed from inside the app. */
  canInstall?: boolean;
}

/** Progress of an in-app update, pushed from the main process. */
export type UpdateEvent =
  | { type: 'progress'; percent: number; transferred: number; total: number; bytesPerSecond: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string };

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
  /** Downloads the update found by the last check (in-app updates only); progress arrives as UpdateEvents. */
  downloadUpdate(): Promise<void>;
  /** Quits, installs the downloaded update and restarts. */
  installUpdate(): Promise<void>;
  onUpdateEvent(cb: (e: UpdateEvent) => void): () => void;
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
