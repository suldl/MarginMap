import { create } from 'zustand';
import { backend, type OpenFile } from '../backend';
import { openPdf, renderThumbnail } from '../lib/pdf';
import { sha256, stripExt, uid } from '../lib/util';
import type { DocMeta, LibraryData, Notebook, NotebookMeta } from '../types';

interface LibraryState {
  loaded: boolean;
  docs: DocMeta[];
  notebooks: NotebookMeta[];
  load(): Promise<void>;
  importFiles(files: OpenFile[]): Promise<{ docs: DocMeta[]; errors: string[] }>;
  renameDoc(id: string, title: string): void;
  deleteDoc(id: string): Promise<void>;
  createNotebook(title: string, docIds: string[]): Promise<NotebookMeta>;
  upsertNotebookMeta(meta: NotebookMeta): void;
  renameNotebook(id: string, title: string): Promise<void>;
  deleteNotebook(id: string): Promise<void>;
  touchNotebook(id: string): void;
  /** Finds the most recent notebook containing the document, creating one if needed. */
  notebookForDoc(docId: string): Promise<string>;
}

let saveChain = Promise.resolve();

function persist(get: () => LibraryState) {
  const data: LibraryData = { version: 1, docs: get().docs, notebooks: get().notebooks };
  saveChain = saveChain.then(() => backend.saveLibrary(data)).catch((err) => console.error('saveLibrary', err));
}

/** Resolves once the last library save has reached the disk. */
export function waitForLibrarySave(): Promise<void> {
  return saveChain;
}

export function notebookMeta(nb: Notebook, prev?: NotebookMeta): NotebookMeta {
  const cards = Object.values(nb.cards);
  return {
    id: nb.id,
    title: nb.title,
    docIds: nb.docIds,
    cardCount: cards.length,
    reviewDues: cards.filter((c) => c.review).map((c) => c.review!.due),
    createdAt: nb.createdAt,
    updatedAt: nb.updatedAt,
    openedAt: prev?.openedAt ?? nb.updatedAt,
  };
}

export function newNotebook(title: string, docIds: string[]): Notebook {
  const now = Date.now();
  return { version: 1, id: uid(), title, docIds, cards: {}, createdAt: now, updatedAt: now };
}

export const useLibrary = create<LibraryState>((set, get) => ({
  loaded: false,
  docs: [],
  notebooks: [],

  async load() {
    const data = await backend.loadLibrary();
    set({ loaded: true, docs: data?.docs ?? [], notebooks: data?.notebooks ?? [] });
  },

  async importFiles(files) {
    const added: DocMeta[] = [];
    const errors: string[] = [];
    for (const file of files) {
      try {
        const hash = await sha256(file.bytes);
        const existing = get().docs.find((d) => d.hash === hash);
        if (existing) {
          added.push(existing);
          continue;
        }
        const id = uid();
        const size = file.bytes.byteLength;
        // pdf.js transfers (detaches) the buffer it is given, so hand it a copy.
        const pdf = await openPdf(file.bytes.slice());
        let thumbId: string | undefined;
        try {
          const thumb = await renderThumbnail(pdf);
          thumbId = `thumb-${id}`;
          await backend.putAsset(thumbId, thumb);
        } catch (err) {
          console.warn('thumbnail failed', err);
        }
        const meta: DocMeta = {
          id,
          title: stripExt(file.name),
          fileName: file.name,
          pageCount: pdf.numPages,
          size,
          hash,
          thumbId,
          addedAt: Date.now(),
        };
        await pdf.destroy();
        await backend.saveDoc(id, file.bytes);
        set({ docs: [meta, ...get().docs] });
        added.push(meta);
      } catch (err) {
        console.error(err);
        errors.push(`${file.name}: ${(err as Error).message || 'not a readable PDF'}`);
      }
    }
    persist(get);
    return { docs: added, errors };
  },

  renameDoc(id, title) {
    set({ docs: get().docs.map((d) => (d.id === id ? { ...d, title } : d)) });
    persist(get);
  },

  async deleteDoc(id) {
    const doc = get().docs.find((d) => d.id === id);
    set({ docs: get().docs.filter((d) => d.id !== id) });
    // Detach from notebooks; their cards keep their (now dangling) source anchors.
    for (const meta of get().notebooks.filter((n) => n.docIds.includes(id))) {
      const nb = await backend.loadNotebook(meta.id);
      if (nb) {
        nb.docIds = nb.docIds.filter((d) => d !== id);
        await backend.saveNotebook(nb);
        get().upsertNotebookMeta(notebookMeta(nb, meta));
      }
    }
    persist(get);
    await backend.deleteDoc(id);
    if (doc?.thumbId) await backend.deleteAsset(doc.thumbId);
  },

  async createNotebook(title, docIds) {
    const nb = newNotebook(title, docIds);
    await backend.saveNotebook(nb);
    const meta = notebookMeta(nb);
    set({ notebooks: [meta, ...get().notebooks] });
    persist(get);
    return meta;
  },

  upsertNotebookMeta(meta) {
    const list = get().notebooks;
    const idx = list.findIndex((n) => n.id === meta.id);
    set({ notebooks: idx === -1 ? [meta, ...list] : list.map((n) => (n.id === meta.id ? meta : n)) });
    persist(get);
  },

  async renameNotebook(id, title) {
    const nb = await backend.loadNotebook(id);
    if (!nb) return;
    nb.title = title;
    nb.updatedAt = Date.now();
    await backend.saveNotebook(nb);
    get().upsertNotebookMeta(notebookMeta(nb, get().notebooks.find((n) => n.id === id)));
  },

  async deleteNotebook(id) {
    const nb = await backend.loadNotebook(id);
    set({ notebooks: get().notebooks.filter((n) => n.id !== id) });
    persist(get);
    await backend.deleteNotebook(id);
    for (const c of Object.values(nb?.cards ?? {})) if (c.imageId) await backend.deleteAsset(c.imageId);
  },

  touchNotebook(id) {
    set({ notebooks: get().notebooks.map((n) => (n.id === id ? { ...n, openedAt: Date.now() } : n)) });
    persist(get);
  },

  async notebookForDoc(docId) {
    const existing = get()
      .notebooks.filter((n) => n.docIds.includes(docId))
      .sort((a, b) => b.openedAt - a.openedAt)[0];
    if (existing) return existing.id;
    const doc = get().docs.find((d) => d.id === docId);
    const meta = await get().createNotebook(doc?.title ?? 'Untitled', [docId]);
    return meta.id;
  },
}));
