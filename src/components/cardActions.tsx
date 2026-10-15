import { buildTree, cardLabel, childrenOf } from '../lib/tree';
import { uid } from '../lib/util';
import { useLibrary } from '../store/library';
import { groupsOf, useNotebook } from '../store/notebook';
import { useStudy } from '../store/study';
import { useUi, type MenuItem } from '../store/ui';
import { COLORS, type AnswerCard, type Card, type ColorKey, type SourceAnchor } from '../types';
import { addCardToBoard, placeCards, placedCardIds } from './whiteboard/boardActions';

/** Shared card commands used by the mind map, outline, inspector and menus. */

export function addChild(parentId: string | null) {
  const nb = useNotebook.getState();
  const id = nb.addCard({ color: parentId ? nb.nb?.cards[parentId]?.color : undefined }, { parentId });
  nb.setEditing(id);
  return id;
}

export function addSibling(id: string | null) {
  const nb = useNotebook.getState();
  const card = id ? nb.nb?.cards[id] : null;
  if (!nb.nb || !card) return addChild(null);
  const sibs = childrenOf(buildTree(nb.nb.cards), card.parentId);
  const idx = sibs.findIndex((c) => c.id === card.id);
  const newId = nb.addCard({ color: card.color }, { parentId: card.parentId, index: idx + 1 });
  nb.setEditing(newId);
  return newId;
}

export function deleteWithUndoHint(ids: string[]) {
  const nb = useNotebook.getState();
  if (!nb.nb || !ids.length) return;
  const count = ids.length;
  nb.deleteCards(ids);
  useUi.getState().toast(`Deleted ${count === 1 ? 'card' : `${count} cards`} · Ctrl+Z to undo`);
}

/** Scrolls the reader to a card's excerpt, adding its document to the notebook if needed. */
export function locateCard(card: Card, opts: { silent?: boolean } = {}) {
  return card.source ? locateSource(card.source, card.id, opts) : false;
}

/** Scrolls the reader to an excerpt's place (flashing the card's highlight when `cardId` is given). */
export function locateSource(src: SourceAnchor, cardId?: string, opts: { silent?: boolean } = {}) {
  const nb = useNotebook.getState();
  const doc = useLibrary.getState().docs.find((d) => d.id === src.docId);
  if (!doc) {
    if (!opts.silent) useUi.getState().toast('The source document was removed from the library', 'error');
    return false;
  }
  if (!nb.nb?.docIds.includes(src.docId)) nb.addDoc(src.docId);
  const top = Math.min(...src.rects.filter((r) => r.page === src.page).map((r) => r.y));
  useStudy.getState().jumpTo({ docId: src.docId, page: src.page, y: Number.isFinite(top) ? top : 0, cardId });
  return true;
}

/** Adds an answer card to a card (undoable). Returns the answer's id. */
export function addAnswer(cardId: string, init: Omit<AnswerCard, 'id' | 'createdAt'>): string {
  const nb = useNotebook.getState();
  const card = nb.nb?.cards[cardId];
  if (!card) return '';
  const answer: AnswerCard = { id: uid(), createdAt: Date.now(), ...init };
  nb.updateCard(cardId, { answers: [...(card.answers ?? []), answer] });
  return answer.id;
}

export function updateAnswer(cardId: string, answerId: string, patch: Partial<Omit<AnswerCard, 'id'>>) {
  const nb = useNotebook.getState();
  const card = nb.nb?.cards[cardId];
  if (!card?.answers) return;
  nb.updateCard(cardId, { answers: card.answers.map((a) => (a.id === answerId ? { ...a, ...patch } : a)) });
}

export function removeAnswer(cardId: string, answerId: string) {
  const nb = useNotebook.getState();
  const card = nb.nb?.cards[cardId];
  if (!card?.answers) return;
  const answers = card.answers.filter((a) => a.id !== answerId);
  nb.updateCard(cardId, { answers: answers.length ? answers : undefined });
}

/** Alt+drop onto a card: the dragged cards become its answer cards (one undo step). */
export function makeAnswers(ids: string[], targetId: string) {
  const store = useNotebook.getState();
  const target = store.nb?.cards[targetId];
  if (!target) return;
  const n = store.convertToAnswers(ids, targetId);
  const ui = useUi.getState();
  if (!n) {
    ui.toast('Empty cards can’t become answers');
    return;
  }
  ui.toast(`${n === 1 ? 'Card' : `${n} cards`} turned into answer${n === 1 ? '' : 's'} of “${cardLabel(target, 40)}” · Ctrl+Z to undo`, 'info', {
    label: 'Show',
    run: () => useUi.getState().openAnswers(targetId),
  });
}

/** Menu entry that opens a card's answers (or starts its first one). */
export function answersMenuItem(card: Card): MenuItem {
  const n = card.answers?.length ?? 0;
  return n
    ? { label: `Answers (${n})…`, onClick: () => useUi.getState().openAnswers(card.id) }
    : { label: 'Add answer…', onClick: () => useUi.getState().openAnswers(card.id, true) };
}

function colorRow(current: ColorKey | null, onPick: (c: ColorKey) => void): MenuItem {
  return {
    render: (close) => (
      <div className="swatches">
        {COLORS.map((c) => (
          <button
            key={c}
            className={`swatch ${current === c ? 'on' : ''}`}
            style={{ '--sw': `var(--c-${c})` } as React.CSSProperties}
            title={c}
            onClick={() => {
              onPick(c);
              close();
            }}
          />
        ))}
      </div>
    ),
  };
}

/** Puts cards in a new group, asking for its name. Returns the group id (or null if cancelled). */
export async function groupSelection(ids: string[]): Promise<string | null> {
  const store = useNotebook.getState();
  const cards = store.nb?.cards;
  const valid = ids.filter((id) => cards?.[id]);
  if (!valid.length) return null;
  const groups = groupsOf(store.nb);
  let n = groups.length + 1;
  while (groups.some((g) => g.name === `Group ${n}`)) n++;
  const name = await useUi.getState().prompt({ title: `Group ${valid.length} card${valid.length === 1 ? '' : 's'}`, label: 'Group name', value: `Group ${n}`, confirmLabel: 'Group' });
  if (!name) return null;
  const id = useNotebook.getState().createGroup(valid, { name });
  useUi.getState().toast(`Grouped ${valid.length} card${valid.length === 1 ? '' : 's'} as “${name}”`);
  return id;
}

export async function renameGroup(groupId: string) {
  const g = groupsOf(useNotebook.getState().nb).find((x) => x.id === groupId);
  if (!g) return;
  const name = await useUi.getState().prompt({ title: 'Rename group', value: g.name, confirmLabel: 'Rename' });
  if (name) useNotebook.getState().updateGroup(groupId, { name });
}

export function groupMemberIds(groupId: string): string[] {
  return Object.values(useNotebook.getState().nb?.cards ?? {})
    .filter((c) => c.groupId === groupId)
    .map((c) => c.id);
}

/** Right-click menu of a group frame's label. */
export function openGroupMenu(x: number, y: number, groupId: string, extra: MenuItem[] = []) {
  const store = useNotebook.getState();
  const g = groupsOf(store.nb).find((x) => x.id === groupId);
  if (!g) return;
  const members = groupMemberIds(groupId);
  useUi.getState().openMenu(x, y, [
    { header: `${g.name} · ${members.length} card${members.length === 1 ? '' : 's'}` },
    { separator: true },
    { label: 'Select cards', onClick: () => useNotebook.getState().setSelection(members) },
    { label: 'Rename group…', onClick: () => void renameGroup(groupId) },
    colorRow(g.color, (c) => useNotebook.getState().updateGroup(groupId, { color: c })),
    { label: 'Add cards to review', onClick: () => useNotebook.getState().toggleReview(members, true) },
    ...extra,
    { separator: true },
    { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', onClick: () => useNotebook.getState().ungroup(groupId) },
  ]);
}

/** Context menu for several selected cards at once. */
export function openSelectionMenu(x: number, y: number, ids: string[], extra: MenuItem[] = []) {
  const store = useNotebook.getState();
  const cards = store.nb?.cards ?? {};
  const sel = ids.filter((id) => cards[id]);
  if (!sel.length) return;
  const colors = new Set(sel.map((id) => cards[id].color));
  const groups = new Set(sel.map((id) => cards[id].groupId));
  const sharedGroup = groups.size === 1 ? [...groups][0] : undefined;
  const allReview = sel.every((id) => cards[id].review);
  const onBoard = placedCardIds();
  const unplaced = sel.filter((id) => !onBoard.has(id));
  useUi.getState().openMenu(x, y, [
    { header: `${sel.length} cards selected` },
    colorRow(colors.size === 1 ? [...colors][0] : null, (c) =>
      useNotebook.getState().updateCards(Object.fromEntries(sel.map((id) => [id, { color: c }]))),
    ),
    { separator: true },
    { label: 'Group…', shortcut: 'Ctrl+G', onClick: () => void groupSelection(sel) },
    ...(sharedGroup ? [{ label: 'Ungroup', shortcut: 'Ctrl+Shift+G', onClick: () => useNotebook.getState().ungroup(sharedGroup) }] : []),
    {
      label: 'Add tag…',
      onClick: async () => {
        const tag = await useUi.getState().prompt({ title: `Tag ${sel.length} cards`, label: 'Tag', value: '', confirmLabel: 'Add tag' });
        if (tag) useNotebook.getState().addTag(sel, tag);
      },
    },
    { label: allReview ? 'Remove from review' : 'Add to review', onClick: () => useNotebook.getState().toggleReview(sel, !allReview) },
    {
      label: unplaced.length ? `Add to whiteboard (${unplaced.length})` : 'All on the whiteboard',
      disabled: !unplaced.length,
      onClick: () => {
        placeCards(unplaced);
        useUi.getState().toast(`Added ${unplaced.length} card${unplaced.length === 1 ? '' : 's'} to the whiteboard`);
      },
    },
    ...extra,
    { separator: true },
    { label: `Delete ${sel.length} cards`, shortcut: 'Del', danger: true, onClick: () => deleteWithUndoHint(sel) },
  ]);
}

export function openCardMenu(x: number, y: number, id: string, extra: MenuItem[] = []) {
  const nbState = useNotebook.getState();
  const card = nbState.nb?.cards[id];
  if (!card) return;
  if (nbState.selectedIds.length > 1 && nbState.selectedIds.includes(id)) {
    openSelectionMenu(x, y, nbState.selectedIds, extra);
    return;
  }
  nbState.select(id);
  const hasKids = (buildTree(nbState.nb!.cards).children.get(id) ?? []).length > 0;
  const group = card.groupId ? groupsOf(nbState.nb).find((g) => g.id === card.groupId) : undefined;
  useUi.getState().openMenu(x, y, [
    { label: 'Add child card', shortcut: 'Tab', onClick: () => addChild(id) },
    { label: 'Add sibling card', shortcut: 'Enter', onClick: () => addSibling(id) },
    { label: 'Edit title', shortcut: 'F2', onClick: () => useNotebook.getState().setEditing(id) },
    answersMenuItem(card),
    colorRow(card.color, (c) => useNotebook.getState().updateCard(id, { color: c })),
    { separator: true },
    {
      label: card.review ? 'Remove from review' : 'Add to review',
      onClick: () => useNotebook.getState().toggleReview([id]),
    },
    ...(hasKids
      ? [
          {
            label: 'Add with all children to review',
            onClick: () => {
              const tree = buildTree(useNotebook.getState().nb!.cards);
              const ids = [id];
              for (let i = 0; i < ids.length; i++) for (const c of tree.children.get(ids[i]) ?? []) ids.push(c.id);
              useNotebook.getState().toggleReview(ids, true);
              useUi.getState().toast(`${ids.length} cards added to review`);
            },
          },
        ]
      : []),
    { label: 'Locate in document', disabled: !card.source, onClick: () => locateCard(card) },
    { label: placedCardIds().has(id) ? 'Show on whiteboard' : 'Add to whiteboard', onClick: () => addCardToBoard(id) },
    group
      ? { label: `Remove from “${group.name}”`, onClick: () => useNotebook.getState().updateCard(id, { groupId: undefined }) }
      : { label: 'Group…', shortcut: 'Ctrl+G', onClick: () => void groupSelection([id]) },
    ...(hasKids
      ? [{ label: card.collapsed ? 'Expand' : 'Collapse', onClick: () => useNotebook.getState().toggleCollapsed(id) }]
      : []),
    ...extra,
    { separator: true },
    { label: 'Delete', shortcut: 'Del', danger: true, onClick: () => deleteWithUndoHint([id]) },
  ]);
}

/** Arrow-key navigation over the card tree. */
export function navigate(dir: 'left' | 'right' | 'up' | 'down') {
  const nb = useNotebook.getState();
  if (!nb.nb) return;
  const tree = buildTree(nb.nb.cards);
  const cur = nb.selectedId ? nb.nb.cards[nb.selectedId] : null;
  if (!cur) {
    if (tree.roots[0]) nb.select(tree.roots[0].id);
    return;
  }
  let next: string | null = null;
  if (dir === 'left') next = cur.parentId;
  else if (dir === 'right') {
    const kids = tree.children.get(cur.id) ?? [];
    if (kids.length) {
      if (cur.collapsed) nb.toggleCollapsed(cur.id);
      next = kids[0].id;
    }
  } else {
    const sibs = childrenOf(tree, cur.parentId);
    const idx = sibs.findIndex((c) => c.id === cur.id);
    next = sibs[idx + (dir === 'up' ? -1 : 1)]?.id ?? null;
  }
  if (next) {
    nb.select(next);
    useStudy.getState().revealCard(next);
  }
}
