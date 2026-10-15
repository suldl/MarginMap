import type { Card, CardMap } from '../types';

export interface Tree {
  roots: Card[];
  children: Map<string, Card[]>;
}

const cache = new WeakMap<CardMap, Tree>();

/** Parent → ordered children index, memoized per (immutable) card map. */
export function buildTree(cards: CardMap): Tree {
  const hit = cache.get(cards);
  if (hit) return hit;
  const children = new Map<string, Card[]>();
  const roots: Card[] = [];
  for (const c of Object.values(cards)) {
    if (c.parentId && cards[c.parentId]) {
      let arr = children.get(c.parentId);
      if (!arr) children.set(c.parentId, (arr = []));
      arr.push(c);
    } else {
      roots.push(c);
    }
  }
  const byOrder = (a: Card, b: Card) => a.order - b.order || a.createdAt - b.createdAt;
  roots.sort(byOrder);
  for (const arr of children.values()) arr.sort(byOrder);
  const tree = { roots, children };
  cache.set(cards, tree);
  return tree;
}

export function childrenOf(tree: Tree, id: string | null): Card[] {
  return id === null ? tree.roots : (tree.children.get(id) ?? []);
}

export function descendantIds(tree: Tree, id: string): string[] {
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of tree.children.get(cur) ?? []) {
      out.push(c.id);
      stack.push(c.id);
    }
  }
  return out;
}

export function isDescendant(cards: CardMap, id: string, ancestorId: string): boolean {
  let cur = cards[id]?.parentId ?? null;
  while (cur) {
    if (cur === ancestorId) return true;
    cur = cards[cur]?.parentId ?? null;
  }
  return false;
}

export function ancestors(cards: CardMap, id: string): string[] {
  const out: string[] = [];
  let cur = cards[id]?.parentId ?? null;
  while (cur && cards[cur]) {
    out.push(cur);
    cur = cards[cur].parentId;
  }
  return out;
}

/** Depth-first order of all cards, respecting sibling order. */
export function flatten(tree: Tree, skipCollapsed = false): { card: Card; depth: number }[] {
  const out: { card: Card; depth: number }[] = [];
  const walk = (list: Card[], depth: number) => {
    for (const c of list) {
      out.push({ card: c, depth });
      if (!(skipCollapsed && c.collapsed)) walk(tree.children.get(c.id) ?? [], depth + 1);
    }
  };
  walk(tree.roots, 0);
  return out;
}

export function cardLabel(c: Card, max = 80): string {
  const s = c.title.trim() || c.excerpt.trim() || c.comment.trim() || (c.imageId ? 'Image excerpt' : 'Untitled');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function matchesQuery(c: Card, q: string): boolean {
  const needle = q.toLowerCase();
  return [c.title, c.excerpt, c.comment, c.imageText ?? '', c.tags.join(' '), ...(c.answers ?? []).map((a) => a.text)].some((s) =>
    s.toLowerCase().includes(needle),
  );
}
