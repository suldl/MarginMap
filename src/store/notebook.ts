import { create } from 'zustand';
import { backend } from '../backend';
import { newReviewState } from '../lib/srs';
import { ancestors, buildTree, childrenOf, descendantIds, isDescendant } from '../lib/tree';
import { debounce, uid } from '../lib/util';
import { EMPTY_BOARD, type Board, type BoardItem, type Card, type CardGroup, type CardMap, type ColorKey, type Notebook } from '../types';
import { notebookMeta, useLibrary } from './library';

export interface NewCard {
  title?: string;
  excerpt?: string;
  imageId?: string;
  imageText?: string;
  comment?: string;
  color?: ColorKey;
  source?: Card['source'];
  mapPos?: Card['mapPos'];
}

/** One undo step: cards, groups and whiteboard together. */
interface Snapshot {
  cards: CardMap;
  board: Board;
  groups: CardGroup[];
}

const NO_GROUPS: CardGroup[] = [];

interface NotebookState {
  nb: Notebook | null;
  /** The focused card (shown in the card panel, target of keyboard commands). */
  selectedId: string | null;
  /** Every selected card, including `selectedId`. */
  selectedIds: string[];
  editingId: string | null;
  past: Snapshot[];
  future: Snapshot[];
  histKey: string | null;
  histAt: number;

  open(id: string): Promise<boolean>;
  close(): Promise<void>;
  flush(): Promise<void>;
  setTitle(title: string): void;
  addDoc(docId: string): void;
  removeDoc(docId: string): void;

  select(id: string | null): void;
  /** Selects several cards; `primary` (default: the last one) becomes the focused card. */
  setSelection(ids: string[], primary?: string | null): void;
  /** Ctrl+click: adds a card to the selection, or removes it. */
  toggleSelected(id: string): void;
  setEditing(id: string | null): void;

  /** Adds a card; by default it becomes the selection (pass select: false to keep the current one). */
  addCard(
    init: NewCard,
    where: { parentId: string | null; index?: number },
    opts?: { select?: boolean; boardAt?: { x: number; y: number; w?: number } },
  ): string;
  updateCard(id: string, patch: Partial<Card>, coalesceKey?: string): void;
  /** Updates several cards in one undo step. */
  updateCards(patches: Record<string, Partial<Card>>, coalesceKey?: string): void;
  deleteCards(ids: string[]): void;
  moveCard(id: string, parentId: string | null, index: number): void;
  /** Moves several cards (in the given order) under one parent, starting at `index`, in one undo step. */
  moveCards(ids: string[], parentId: string | null, index: number): void;
  indent(id: string): void;
  outdent(id: string): void;
  toggleCollapsed(id: string): void;
  setCollapsedAll(collapsed: boolean): void;
  expandTo(id: string): void;
  toggleReview(ids: string[], on?: boolean): void;
  addTag(ids: string[], tag: string): void;
  removeTag(ids: string[], tag: string): void;

  /** Groups: cards that belong together, drawn as a labelled frame. A card is in at most one group. */
  createGroup(cardIds: string[], init?: Partial<Omit<CardGroup, 'id'>>): string;
  updateGroup(id: string, patch: Partial<Omit<CardGroup, 'id'>>): void;
  ungroup(id: string): void;

  /** Whiteboard edits (all undoable). */
  boardAdd(items: BoardItem[]): void;
  /** Replaces items that share an id with the given ones. */
  boardReplace(items: BoardItem[], coalesceKey?: string): void;
  /** Removes items; arrows attached to them go too. */
  boardRemove(ids: string[]): void;
  boardReorder(ids: string[], to: 'front' | 'back'): void;
  undo(): void;
  redo(): void;
}

// Saves are chained so writes never overlap and readers can wait for them.
let saveChain: Promise<void> = Promise.resolve();
const saveNow = (nb: Notebook) => {
  saveChain = saveChain
    .then(() => backend.saveNotebook(nb))
    .then(() => {
      const lib = useLibrary.getState();
      lib.upsertNotebookMeta(notebookMeta(nb, lib.notebooks.find((n) => n.id === nb.id)));
    })
    .catch((err) => console.error('saveNotebook', err));
  return saveChain;
};
const scheduleSave = debounce((nb: Notebook) => void saveNow(nb), 400);

/** Resolves once every pending notebook write has reached the disk. */
export function waitForSaves(): Promise<void> {
  scheduleSave.flush();
  return saveChain;
}

export function boardOf(nb: Notebook | null): Board {
  return nb?.board ?? EMPTY_BOARD;
}

export function groupsOf(nb: Notebook | null): CardGroup[] {
  return nb?.groups ?? NO_GROUPS;
}

const snapshot = (nb: Notebook): Snapshot => ({ cards: nb.cards, board: boardOf(nb), groups: groupsOf(nb) });

/** Drops groups that no longer have any member card. */
function pruneGroups(groups: CardGroup[], cards: CardMap): CardGroup[] {
  if (!groups.length) return groups;
  const used = new Set<string>();
  for (const c of Object.values(cards)) if (c.groupId) used.add(c.groupId);
  const next = groups.filter((g) => used.has(g.id));
  return next.length === groups.length ? groups : next;
}

/** Drops board items whose ids are in `removed`, plus arrows attached to them. */
function pruneBoard(board: Board, removed: Set<string>): Board {
  if (!removed.size) return board;
  const items = board.items.filter(
    (it) =>
      !removed.has(it.id) &&
      !(it.type === 'arrow' && ((it.from.itemId && removed.has(it.from.itemId)) || (it.to.itemId && removed.has(it.to.itemId)))),
  );
  return items.length === board.items.length ? board : { items };
}

/** Renumbers `order` for siblings after inserting/moving `card` at `index`. */
function placeAmongSiblings(cards: CardMap, card: Card, parentId: string | null, index: number): CardMap {
  const tree = buildTree(cards);
  const siblings = childrenOf(tree, parentId).filter((c) => c.id !== card.id);
  const at = Math.max(0, Math.min(index, siblings.length));
  siblings.splice(at, 0, card);
  const next = { ...cards };
  siblings.forEach((s, i) => {
    const base = s.id === card.id ? card : next[s.id];
    if (s.id === card.id || base.order !== i || base.parentId !== parentId) {
      next[s.id] = { ...base, order: i, parentId };
    }
  });
  return next;
}

export const useNotebook = create<NotebookState>((set, get) => {
  /** Applies a change with undo history (consecutive edits sharing a key coalesce). */
  const commit = (cards: CardMap, key?: string, extra?: Partial<NotebookState>, board?: Board, groups?: CardGroup[]) => {
    const s = get();
    if (!s.nb) return;
    const now = Date.now();
    const coalesce = !!key && s.histKey === key && now - s.histAt < 2000;
    const nextGroups = pruneGroups(groups ?? groupsOf(s.nb), cards);
    const nb = { ...s.nb, cards, board: board ?? s.nb.board, groups: nextGroups.length ? nextGroups : undefined, updatedAt: now };
    set({
      nb,
      past: coalesce ? s.past : [...s.past.slice(-99), snapshot(s.nb)],
      future: [],
      histKey: key ?? null,
      histAt: now,
      ...extra,
    });
    scheduleSave(nb);
  };

  /** Applies a change without recording undo history (view state like collapse). */
  const silent = (cards: CardMap) => {
    const s = get();
    if (!s.nb) return;
    const nb = { ...s.nb, cards };
    set({ nb });
    scheduleSave(nb);
  };

  const updateNb = (patch: Partial<Notebook>) => {
    const s = get();
    if (!s.nb) return;
    const nb = { ...s.nb, ...patch, updatedAt: Date.now() };
    set({ nb });
    scheduleSave(nb);
  };

  /** Restores an undo/redo snapshot, keeping whatever selection still exists. */
  const restore = (snap: Snapshot, past: Snapshot[], future: Snapshot[]) => {
    const s = get();
    if (!s.nb) return;
    const nb = { ...s.nb, cards: snap.cards, board: snap.board, groups: snap.groups.length ? snap.groups : undefined, updatedAt: Date.now() };
    set({
      nb,
      past,
      future,
      histKey: null,
      editingId: null,
      selectedId: s.selectedId && snap.cards[s.selectedId] ? s.selectedId : null,
      selectedIds: s.selectedIds.filter((id) => snap.cards[id]),
    });
    scheduleSave(nb);
  };

  return {
    nb: null,
    selectedId: null,
    selectedIds: [],
    editingId: null,
    past: [],
    future: [],
    histKey: null,
    histAt: 0,

    async open(id) {
      await get().close();
      const nb = await backend.loadNotebook(id);
      if (!nb) return false;
      set({ nb, selectedId: null, selectedIds: [], editingId: null, past: [], future: [], histKey: null });
      useLibrary.getState().touchNotebook(id);
      return true;
    },

    async close() {
      await get().flush();
      set({ nb: null, selectedId: null, selectedIds: [], editingId: null, past: [], future: [] });
    },

    async flush() {
      scheduleSave.flush();
      await saveChain;
    },

    setTitle: (title) => updateNb({ title }),
    addDoc(docId) {
      const nb = get().nb;
      if (nb && !nb.docIds.includes(docId)) updateNb({ docIds: [...nb.docIds, docId] });
    },
    removeDoc(docId) {
      const nb = get().nb;
      if (nb) updateNb({ docIds: nb.docIds.filter((d) => d !== docId) });
    },

    select: (id) => set({ selectedId: id, selectedIds: id ? [id] : [], editingId: get().editingId === id ? id : null }),
    setSelection(ids, primary) {
      const uniq = [...new Set(ids)];
      set({ selectedIds: uniq, selectedId: primary === undefined ? (uniq.at(-1) ?? null) : primary, editingId: null });
    },
    toggleSelected(id) {
      const s = get();
      if (s.selectedIds.includes(id)) {
        const ids = s.selectedIds.filter((x) => x !== id);
        set({ selectedIds: ids, selectedId: s.selectedId === id ? (ids.at(-1) ?? null) : s.selectedId, editingId: null });
      } else {
        set({ selectedIds: [...s.selectedIds, id], selectedId: id, editingId: null });
      }
    },
    setEditing: (id) => {
      const s = get();
      set({
        editingId: id,
        selectedId: id ?? s.selectedId,
        selectedIds: id && !s.selectedIds.includes(id) ? [id] : s.selectedIds,
      });
    },

    addCard(init, where, opts) {
      const nb = get().nb;
      if (!nb) return '';
      const now = Date.now();
      const card: Card = {
        id: uid(),
        parentId: where.parentId,
        order: 0,
        title: init.title ?? '',
        excerpt: init.excerpt ?? '',
        imageId: init.imageId,
        imageText: init.imageText,
        comment: init.comment ?? '',
        color: init.color ?? 'yellow',
        tags: [],
        source: init.source,
        mapPos: init.mapPos,
        createdAt: now,
        updatedAt: now,
      };
      let cards = nb.cards;
      // Adding under a collapsed parent should make the new card visible.
      if (where.parentId && cards[where.parentId]?.collapsed) {
        cards = { ...cards, [where.parentId]: { ...cards[where.parentId], collapsed: false } };
      }
      const index = where.index ?? childrenOf(buildTree(cards), where.parentId).length;
      // Optionally place it on the whiteboard in the same undo step.
      const at = opts?.boardAt;
      const board = at
        ? { items: [...boardOf(nb).items, { id: uid(), type: 'card' as const, cardId: card.id, x: at.x, y: at.y, w: at.w ?? 260 }] }
        : undefined;
      commit(
        placeAmongSiblings(cards, card, where.parentId, index),
        undefined,
        opts?.select === false ? {} : { selectedId: card.id, selectedIds: [card.id] },
        board,
      );
      return card.id;
    },

    updateCard(id, patch, coalesceKey) {
      const nb = get().nb;
      const card = nb?.cards[id];
      if (!nb || !card) return;
      commit({ ...nb.cards, [id]: { ...card, ...patch, updatedAt: Date.now() } }, coalesceKey ? `${id}:${coalesceKey}` : undefined);
    },

    updateCards(patches, coalesceKey) {
      const nb = get().nb;
      if (!nb) return;
      const cards = { ...nb.cards };
      const now = Date.now();
      let changed = false;
      for (const [id, patch] of Object.entries(patches)) {
        if (!cards[id]) continue;
        cards[id] = { ...cards[id], ...patch, updatedAt: now };
        changed = true;
      }
      if (changed) commit(cards, coalesceKey ? `bulk:${coalesceKey}` : undefined);
    },

    deleteCards(ids) {
      const nb = get().nb;
      if (!nb) return;
      const tree = buildTree(nb.cards);
      const doomed = new Set<string>();
      for (const id of ids) {
        if (!nb.cards[id]) continue;
        doomed.add(id);
        for (const d of descendantIds(tree, id)) doomed.add(d);
      }
      if (!doomed.size) return;
      // Select a sensible neighbour afterwards.
      const first = nb.cards[ids[0]];
      let nextSel: string | null = null;
      if (first) {
        const sibs = childrenOf(tree, first.parentId).filter((c) => !doomed.has(c.id));
        const idx = childrenOf(tree, first.parentId).findIndex((c) => c.id === first.id);
        nextSel = sibs[Math.min(idx, sibs.length - 1)]?.id ?? first.parentId;
        if (nextSel && doomed.has(nextSel)) nextSel = null;
      }
      const cards = { ...nb.cards };
      for (const id of doomed) delete cards[id];
      // Cards placed on the whiteboard leave it with them.
      const board = boardOf(nb);
      const placed = new Set(board.items.filter((it) => it.type === 'card' && doomed.has(it.cardId)).map((it) => it.id));
      commit(cards, undefined, { selectedId: nextSel, selectedIds: nextSel ? [nextSel] : [], editingId: null }, pruneBoard(board, placed));
      // Images are kept on disk so undo can restore them.
    },

    moveCard(id, parentId, index) {
      get().moveCards([id], parentId, index);
    },

    moveCards(ids, parentId, index) {
      const nb = get().nb;
      if (!nb) return;
      // Never move a card into itself or its own subtree.
      const valid = ids.filter((id) => nb.cards[id] && id !== parentId && !(parentId && isDescendant(nb.cards, parentId, id)));
      if (!valid.length) return;
      let cards = nb.cards;
      if (parentId && cards[parentId]?.collapsed) cards = { ...cards, [parentId]: { ...cards[parentId], collapsed: false } };
      let at = index;
      for (const id of valid) {
        // When moving down within the same parent, the removal shifts the target index.
        const sibs = childrenOf(buildTree(cards), parentId);
        const cur = sibs.findIndex((c) => c.id === id);
        const target = cur !== -1 && cur < at ? at - 1 : at;
        // A free position is relative to the old parent, so it does not survive a move.
        cards = placeAmongSiblings(cards, { ...cards[id], mapPos: undefined, updatedAt: Date.now() }, parentId, target);
        at = target + 1;
      }
      commit(cards);
    },

    indent(id) {
      const nb = get().nb;
      const card = nb?.cards[id];
      if (!nb || !card) return;
      const sibs = childrenOf(buildTree(nb.cards), card.parentId);
      const idx = sibs.findIndex((c) => c.id === id);
      if (idx <= 0) return;
      const newParent = sibs[idx - 1];
      get().moveCard(id, newParent.id, childrenOf(buildTree(nb.cards), newParent.id).length);
    },

    outdent(id) {
      const nb = get().nb;
      const card = nb?.cards[id];
      if (!nb || !card?.parentId) return;
      const parent = nb.cards[card.parentId];
      const sibs = childrenOf(buildTree(nb.cards), parent.parentId);
      const idx = sibs.findIndex((c) => c.id === parent.id);
      get().moveCard(id, parent.parentId, idx + 1);
    },

    toggleCollapsed(id) {
      const nb = get().nb;
      const card = nb?.cards[id];
      if (!nb || !card) return;
      silent({ ...nb.cards, [id]: { ...card, collapsed: !card.collapsed } });
    },

    setCollapsedAll(collapsed) {
      const nb = get().nb;
      if (!nb) return;
      const tree = buildTree(nb.cards);
      const cards = { ...nb.cards };
      for (const [id, kids] of tree.children) if (kids.length) cards[id] = { ...cards[id], collapsed };
      silent(cards);
    },

    expandTo(id) {
      const nb = get().nb;
      if (!nb?.cards[id]) return;
      const collapsed = ancestors(nb.cards, id).filter((a) => nb.cards[a].collapsed);
      if (!collapsed.length) return;
      const cards = { ...nb.cards };
      for (const a of collapsed) cards[a] = { ...cards[a], collapsed: false };
      silent(cards);
    },

    toggleReview(ids, on) {
      const nb = get().nb;
      if (!nb) return;
      const cards = { ...nb.cards };
      const enable = on ?? !ids.every((id) => cards[id]?.review);
      for (const id of ids) {
        const c = cards[id];
        if (!c) continue;
        if (enable && !c.review) cards[id] = { ...c, review: newReviewState() };
        if (!enable && c.review) cards[id] = { ...c, review: undefined };
      }
      commit(cards);
    },

    addTag(ids, tag) {
      const nb = get().nb;
      const t = tag.trim().replace(/^#/, '');
      if (!nb || !t) return;
      const patches: Record<string, Partial<Card>> = {};
      for (const id of ids) {
        const c = nb.cards[id];
        if (c && !c.tags.includes(t)) patches[id] = { tags: [...c.tags, t] };
      }
      get().updateCards(patches);
    },

    removeTag(ids, tag) {
      const nb = get().nb;
      if (!nb) return;
      const patches: Record<string, Partial<Card>> = {};
      for (const id of ids) {
        const c = nb.cards[id];
        if (c?.tags.includes(tag)) patches[id] = { tags: c.tags.filter((x) => x !== tag) };
      }
      get().updateCards(patches);
    },

    createGroup(cardIds, init) {
      const nb = get().nb;
      if (!nb) return '';
      const ids = cardIds.filter((id) => nb.cards[id]);
      if (!ids.length) return '';
      const groups = groupsOf(nb);
      let n = groups.length + 1;
      while (groups.some((g) => g.name === `Group ${n}`)) n++;
      const group: CardGroup = { id: uid(), name: init?.name?.trim() || `Group ${n}`, color: init?.color ?? nb.cards[ids[0]].color };
      const cards = { ...nb.cards };
      for (const id of ids) cards[id] = { ...cards[id], groupId: group.id };
      commit(cards, undefined, undefined, undefined, [...groups, group]);
      return group.id;
    },

    updateGroup(id, patch) {
      const nb = get().nb;
      if (!nb) return;
      commit(nb.cards, undefined, undefined, undefined, groupsOf(nb).map((g) => (g.id === id ? { ...g, ...patch } : g)));
    },

    ungroup(id) {
      const nb = get().nb;
      if (!nb) return;
      const cards = { ...nb.cards };
      for (const c of Object.values(cards)) if (c.groupId === id) cards[c.id] = { ...c, groupId: undefined };
      commit(cards, undefined, undefined, undefined, groupsOf(nb).filter((g) => g.id !== id));
    },

    boardAdd(items) {
      const nb = get().nb;
      if (!nb || !items.length) return;
      commit(nb.cards, undefined, undefined, { items: [...boardOf(nb).items, ...items] });
    },

    boardReplace(items, coalesceKey) {
      const nb = get().nb;
      if (!nb || !items.length) return;
      const byId = new Map(items.map((it) => [it.id, it]));
      const next = { items: boardOf(nb).items.map((it) => byId.get(it.id) ?? it) };
      commit(nb.cards, coalesceKey ? `board:${coalesceKey}` : undefined, undefined, next);
    },

    boardRemove(ids) {
      const nb = get().nb;
      if (!nb || !ids.length) return;
      const board = boardOf(nb);
      const next = pruneBoard(board, new Set(ids));
      if (next !== board) commit(nb.cards, undefined, undefined, next);
    },

    boardReorder(ids, to) {
      const nb = get().nb;
      if (!nb || !ids.length) return;
      const set_ = new Set(ids);
      const items = boardOf(nb).items;
      const moving = items.filter((it) => set_.has(it.id));
      const rest = items.filter((it) => !set_.has(it.id));
      commit(nb.cards, undefined, undefined, { items: to === 'front' ? [...rest, ...moving] : [...moving, ...rest] });
    },

    undo() {
      const s = get();
      if (!s.nb || !s.past.length) return;
      restore(s.past[s.past.length - 1], s.past.slice(0, -1), [snapshot(s.nb), ...s.future]);
    },

    redo() {
      const s = get();
      if (!s.nb || !s.future.length) return;
      restore(s.future[0], [...s.past, snapshot(s.nb)], s.future.slice(1));
    },
  };
});

window.addEventListener('beforeunload', () => {
  scheduleSave.flush();
});
