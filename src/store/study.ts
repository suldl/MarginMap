import { create } from 'zustand';
import type { ColorKey } from '../types';

/** The study view's panes; any combination of them can be shown side by side. */
export type Pane = 'doc' | 'map' | 'board';
/** Left-to-right order of the panes (reversed when `swapped`). */
export const PANES: Pane[] = ['doc', 'map', 'board'];
/** The map pane shows the cards as a mind map or as an indented outline. */
export type MapView = 'mindmap' | 'outline';
/** 'pointer' only clicks highlights and drags the page; 'text' selects text to excerpt; 'area' captures a box. */
export type ReaderTool = 'pointer' | 'text' | 'area';
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
  /** Which panes are showing (always at least one). */
  panes: Record<Pane, boolean>;
  mapView: MapView;
  /** Relative widths of the panes. */
  widths: Record<Pane, number>;
  /** Lay the panes out right to left. */
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
  /** The pane last clicked or focused; title edits open in the map or whiteboard the user is working in. */
  activePane: Pane;
  jump: JumpRequest | null;
  /** Ask the mind map/outline to scroll a card into view. */
  reveal: { cardId: string; nonce: number } | null;
  flash: { cardId: string; nonce: number } | null;
  set(patch: Partial<StudyState>): void;
  /** Shows or hides a pane (toggles without `on`). The last visible pane can't be hidden. */
  showPane(pane: Pane, on?: boolean): void;
  jumpTo(req: Omit<JumpRequest, 'nonce'>): void;
  revealCard(cardId: string): void;
  /** Reveal a card in the map and pulse it (and its highlight) briefly. */
  flashCard(cardId: string): void;
}

const PREFS_KEY = 'marginmap.study.prefs';

function loadPrefs(): Prefs {
  const defaults: Prefs = {
    panes: { doc: true, map: true, board: false },
    mapView: 'mindmap',
    widths: { doc: 1, map: 1, board: 1 },
    swapped: false,
    color: 'yellow',
    inspector: true,
    enlarge: true,
  };
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    const prefs: Prefs = {
      panes: { ...defaults.panes, ...v.panes },
      mapView: v.mapView === 'outline' ? 'outline' : 'mindmap',
      widths: { ...defaults.widths, ...v.widths },
      swapped: v.swapped ?? defaults.swapped,
      color: v.color ?? defaults.color,
      inspector: v.inspector ?? defaults.inspector,
      enlarge: v.enlarge ?? defaults.enlarge,
    };
    // Before 0.7 there was one layout ('split' | 'doc' | 'map') plus one map mode.
    if (!v.panes && v.layout) {
      const board = v.mapMode === 'whiteboard';
      prefs.panes = { doc: v.layout !== 'map', map: v.layout !== 'doc' && !board, board: v.layout !== 'doc' && board };
      if (v.mapMode === 'outline') prefs.mapView = 'outline';
      if (typeof v.split === 'number' && v.split > 0 && v.split < 1) prefs.widths = { ...defaults.widths, doc: v.split / (1 - v.split) };
    }
    if (!PANES.some((p) => prefs.panes[p])) prefs.panes = defaults.panes;
    return prefs;
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
  activePane: 'map',
  jump: null,
  reveal: null,
  flash: null,
  set: (patch) => set(patch),
  showPane(pane, on) {
    const panes = get().panes;
    const next = { ...panes, [pane]: on ?? !panes[pane] };
    if (next[pane] === panes[pane] || !PANES.some((p) => next[p])) return;
    set({ panes: next });
  },
  jumpTo(req) {
    const n = ++nonce;
    const panes = get().panes;
    set({
      jump: { ...req, nonce: n },
      activeDocId: req.docId,
      flash: req.cardId ? { cardId: req.cardId, nonce: n } : get().flash,
      panes: panes.doc ? panes : { ...panes, doc: true },
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

/** Where a title edit opens: the map or the whiteboard the user is working in (a card can show in both). */
export function editSurface(): 'map' | 'board' {
  const { activePane, panes } = useStudy.getState();
  if (activePane === 'board' && panes.board) return 'board';
  if (activePane === 'map' && panes.map) return 'map';
  return panes.map || !panes.board ? 'map' : 'board';
}

useStudy.subscribe((s, prev) => {
  if (
    s.panes !== prev.panes ||
    s.mapView !== prev.mapView ||
    s.widths !== prev.widths ||
    s.swapped !== prev.swapped ||
    s.color !== prev.color ||
    s.inspector !== prev.inspector ||
    s.enlarge !== prev.enlarge
  ) {
    const prefs: Prefs = {
      panes: s.panes,
      mapView: s.mapView,
      widths: s.widths,
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
