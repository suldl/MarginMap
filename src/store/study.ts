import { create } from 'zustand';
import type { ColorKey } from '../types';

export type StudyLayout = 'split' | 'doc' | 'map';
export type MapMode = 'mindmap' | 'outline' | 'whiteboard';
export type ReaderTool = 'text' | 'area';
export type ReaderSidebar = 'none' | 'toc' | 'search' | 'cards';

export interface JumpRequest {
  docId: string;
  page: number;
  /** Normalized y within the page to bring into view. */
  y: number;
  cardId?: string;
  nonce: number;
}

interface Prefs {
  layout: StudyLayout;
  mapMode: MapMode;
  split: number;
  swapped: boolean;
  color: ColorKey;
  inspector: boolean;
  /** Show an enlarged view of a picture card when it is double-clicked. */
  enlarge: boolean;
}

interface StudyState extends Prefs {
  activeDocId: string | null;
  tool: ReaderTool;
  sidebar: ReaderSidebar;
  jump: JumpRequest | null;
  /** Ask the mind map/outline to scroll a card into view. */
  reveal: { cardId: string; nonce: number } | null;
  flash: { cardId: string; nonce: number } | null;
  set(patch: Partial<StudyState>): void;
  jumpTo(req: Omit<JumpRequest, 'nonce'>): void;
  revealCard(cardId: string): void;
  /** Reveal a card in the map and pulse it (and its highlight) briefly. */
  flashCard(cardId: string): void;
}

const PREFS_KEY = 'marginmap.study.prefs';

function loadPrefs(): Prefs {
  const defaults: Prefs = { layout: 'split', mapMode: 'mindmap', split: 0.5, swapped: false, color: 'yellow', inspector: true, enlarge: true };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

let nonce = 0;

export const useStudy = create<StudyState>((set, get) => ({
  ...loadPrefs(),
  activeDocId: null,
  tool: 'text',
  sidebar: 'none',
  jump: null,
  reveal: null,
  flash: null,
  set: (patch) => set(patch),
  jumpTo(req) {
    const n = ++nonce;
    set({
      jump: { ...req, nonce: n },
      activeDocId: req.docId,
      flash: req.cardId ? { cardId: req.cardId, nonce: n } : get().flash,
      layout: get().layout === 'map' ? 'split' : get().layout,
    });
  },
  revealCard(cardId) {
    set({ reveal: { cardId, nonce: ++nonce } });
  },
  flashCard(cardId) {
    const n = ++nonce;
    set({ reveal: { cardId, nonce: n }, flash: { cardId, nonce: n } });
  },
}));

useStudy.subscribe((s, prev) => {
  if (
    s.layout !== prev.layout ||
    s.mapMode !== prev.mapMode ||
    s.split !== prev.split ||
    s.swapped !== prev.swapped ||
    s.color !== prev.color ||
    s.inspector !== prev.inspector ||
    s.enlarge !== prev.enlarge
  ) {
    const prefs: Prefs = {
      layout: s.layout,
      mapMode: s.mapMode,
      split: s.split,
      swapped: s.swapped,
      color: s.color,
      inspector: s.inspector,
      enlarge: s.enlarge,
    };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // storage unavailable
    }
  }
});

/** Per-document reading position, kept in localStorage (not worth an undo entry). */
export function loadReadingPos(notebookId: string, docId: string): { page: number; scale: number | null } {
  try {
    const v = JSON.parse(localStorage.getItem(`marginmap.pos.${notebookId}.${docId}`) ?? 'null');
    if (v && typeof v.page === 'number') return { page: v.page, scale: typeof v.scale === 'number' ? v.scale : null };
  } catch {
    // ignore
  }
  return { page: 1, scale: null };
}

export function saveReadingPos(notebookId: string, docId: string, page: number, scale: number | null) {
  try {
    localStorage.setItem(`marginmap.pos.${notebookId}.${docId}`, JSON.stringify({ page, scale }));
  } catch {
    // ignore
  }
}
