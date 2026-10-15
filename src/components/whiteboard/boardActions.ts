import { uid } from '../../lib/util';
import { boardOf, useNotebook } from '../../store/notebook';
import { useStudy } from '../../store/study';
import { useUi } from '../../store/ui';
import type { BoardCardItem } from '../../types';
import { boxesOverlap, DEFAULT_CARD_W, itemBox, type Box, type Pt, type Sizes } from './geometry';

/**
 * Small registry the mounted whiteboard keeps up to date, so code outside it
 * (reader, mind map menus) can place cards somewhere sensible.
 */
export const boardRegistry: { center: Pt | null; sizes: Sizes } = { center: null, sizes: new Map() };

export function isWhiteboardActive() {
  return useStudy.getState().panes.board;
}

/** First spot at or below `start` where a card of width `w` doesn't overlap other cards, text or shapes. */
export function findFreeSpot(start: Pt, w = DEFAULT_CARD_W, h = 140): Pt {
  const items = boardOf(useNotebook.getState().nb).items.filter((it) => it.type !== 'stroke' && it.type !== 'arrow');
  const boxes: Box[] = items.map((it) => itemBox(it, boardRegistry.sizes));
  const spot = { x: start.x, y: start.y };
  for (let i = 0; i < 300; i++) {
    const cand = { x: spot.x, y: spot.y, w, h };
    const hit = boxes.find((b) => boxesOverlap(cand, b, 16));
    if (!hit) return spot;
    spot.y = hit.y + hit.h + 20;
  }
  return spot;
}

/** Where new cards go when no position is given: the visible centre, or right of existing content. */
export function defaultSpot(): Pt {
  if (boardRegistry.center) return findFreeSpot({ x: boardRegistry.center.x - DEFAULT_CARD_W / 2, y: boardRegistry.center.y - 80 });
  const items = boardOf(useNotebook.getState().nb).items;
  if (!items.length) return { x: 40, y: 40 };
  const right = Math.max(...items.map((it) => {
    const b = itemBox(it, boardRegistry.sizes);
    return b.x + b.w;
  }));
  return findFreeSpot({ x: right + 60, y: 40 });
}

export function placedCardIds(): Set<string> {
  return new Set(
    boardOf(useNotebook.getState().nb)
      .items.filter((it): it is BoardCardItem => it.type === 'card')
      .map((it) => it.cardId),
  );
}

/** Places cards on the whiteboard (skipping ones already there). Returns the new board item ids. */
export function placeCards(cardIds: string[], at?: Pt): string[] {
  const placed = placedCardIds();
  const todo = cardIds.filter((id) => !placed.has(id));
  if (!todo.length) return [];
  const items: BoardCardItem[] = [];
  // Several cards are laid out in a grid of up to 4 columns.
  const base = at ?? defaultSpot();
  const cols = Math.min(4, todo.length);
  const colY: number[] = new Array(cols).fill(base.y);
  todo.forEach((cardId, i) => {
    const col = i % cols;
    items.push({ id: uid(), type: 'card', cardId, x: base.x + col * (DEFAULT_CARD_W + 30), y: colY[col], w: DEFAULT_CARD_W });
    colY[col] += 170;
  });
  useNotebook.getState().boardAdd(items);
  return items.map((i) => i.id);
}

/** "Add to whiteboard" from the mind map / outline menus. */
export function addCardToBoard(cardId: string) {
  if (placedCardIds().has(cardId)) {
    useStudy.getState().showPane('board', true);
    useStudy.getState().revealCard(cardId);
    return;
  }
  placeCards([cardId]);
  useUi.getState().toast('Added to the whiteboard');
}
