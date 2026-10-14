import type { Card } from '../../types';
import type { Tree } from '../../lib/tree';
import type { EdgeStyle } from '../../store/settings';

export interface NodeBox {
  id: string;
  parentId: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
}

export interface MapLayout {
  nodes: Map<string, NodeBox>;
  edges: { from: NodeBox; to: NodeBox; color: string }[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export const H_GAP = 56;
export const V_GAP = 14;
const ROOT_GAP = 40;
const DEFAULT_SIZE = { w: 180, h: 44 };

/**
 * Horizontal tree layout: roots stacked on the left, children fanned out to the
 * right, each parent vertically centred on its block of children.
 *
 * Cards with a `mapPos` are placed freely instead: a root at that absolute position,
 * a child at that offset from its parent (so it follows the parent around). Free
 * cards leave no gap among their siblings, and their own children are laid out
 * automatically again.
 */
export function layoutTree(tree: Tree, sizes: Map<string, { w: number; h: number }>): MapLayout {
  const nodes = new Map<string, NodeBox>();
  const edges: MapLayout['edges'] = [];
  const subtreeH = new Map<string, number>();
  const size = (id: string) => sizes.get(id) ?? DEFAULT_SIZE;
  const kids = (c: Card) => (c.collapsed ? [] : (tree.children.get(c.id) ?? []));
  const stacked = (c: Card) => kids(c).filter((k) => !k.mapPos);

  const measure = (c: Card): number => {
    const k = stacked(c);
    const own = size(c.id).h;
    let total = 0;
    for (const ch of k) total += measure(ch);
    total += V_GAP * Math.max(0, k.length - 1);
    const h = Math.max(own, total);
    subtreeH.set(c.id, h);
    return h;
  };

  const place = (c: Card, x: number, top: number, depth: number) => {
    const { w, h } = size(c.id);
    const H = subtreeH.get(c.id)!;
    const box: NodeBox = { id: c.id, parentId: c.parentId, x, y: top + (H - h) / 2, w, h, depth };
    nodes.set(c.id, box);
    const k = stacked(c);
    let childTotal = V_GAP * Math.max(0, k.length - 1);
    for (const ch of k) childTotal += subtreeH.get(ch.id)!;
    let cy = top + (H - childTotal) / 2;
    for (const ch of k) {
      place(ch, x + w + H_GAP, cy, depth + 1);
      edges.push({ from: box, to: nodes.get(ch.id)!, color: ch.color });
      cy += subtreeH.get(ch.id)! + V_GAP;
    }
    for (const ch of kids(c)) {
      if (!ch.mapPos) continue;
      placeFree(ch, box.x + ch.mapPos.x, box.y + ch.mapPos.y, depth + 1);
      edges.push({ from: box, to: nodes.get(ch.id)!, color: ch.color });
    }
  };

  /** Places a subtree so that its top card's corner lands exactly at (x, y). */
  const placeFree = (c: Card, x: number, y: number, depth: number) => {
    const H = measure(c);
    place(c, x, y - (H - size(c.id).h) / 2, depth);
  };

  let top = 0;
  for (const r of tree.roots) {
    if (r.mapPos) continue;
    const H = measure(r);
    place(r, 0, top, 0);
    top += H + ROOT_GAP;
  }
  for (const r of tree.roots) if (r.mapPos) placeFree(r, r.mapPos.x, r.mapPos.y, 0);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes.values()) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }
  if (!nodes.size) minX = minY = maxX = maxY = 0;
  return { nodes, edges, bounds: { minX, minY, maxX, maxY } };
}

type Box = { x: number; y: number; w: number; h: number };

/**
 * Connector between a parent and a child card. It leaves the side of the parent that
 * faces the child (right, left, or top/bottom when they overlap horizontally).
 */
export function edgePath(from: Box, to: Box, style: EdgeStyle = 'curve') {
  const GAP = 8;
  let horizontal = true;
  let x1: number, y1: number, x2: number, y2: number;
  if (to.x >= from.x + from.w + GAP) {
    [x1, y1, x2, y2] = [from.x + from.w, from.y + from.h / 2, to.x, to.y + to.h / 2];
  } else if (to.x + to.w <= from.x - GAP) {
    [x1, y1, x2, y2] = [from.x, from.y + from.h / 2, to.x + to.w, to.y + to.h / 2];
  } else {
    horizontal = false;
    const down = to.y + to.h / 2 >= from.y + from.h / 2;
    [x1, y1, x2, y2] = down
      ? [from.x + from.w / 2, from.y + from.h, to.x + to.w / 2, to.y]
      : [from.x + from.w / 2, from.y, to.x + to.w / 2, to.y + to.h];
  }
  if (style === 'straight') return `M${x1},${y1} L${x2},${y2}`;
  if (style === 'curve') {
    if (horizontal) {
      const dx = (x2 - x1) / 2;
      return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
    }
    const dy = (y2 - y1) / 2;
    return `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
  }
  // Elbow with rounded corners.
  if (horizontal) {
    const xm = (x1 + x2) / 2;
    const sx = Math.sign(x2 - x1) || 1;
    const sy = Math.sign(y2 - y1);
    const r = Math.min(8, Math.abs(y2 - y1) / 2, Math.abs(xm - x1));
    if (!sy || r < 0.5) return `M${x1},${y1} H${xm} V${y2} H${x2}`;
    return `M${x1},${y1} H${xm - r * sx} Q${xm},${y1} ${xm},${y1 + r * sy} V${y2 - r * sy} Q${xm},${y2} ${xm + r * sx},${y2} H${x2}`;
  }
  const ym = (y1 + y2) / 2;
  const sy = Math.sign(y2 - y1) || 1;
  const sx = Math.sign(x2 - x1);
  const r = Math.min(8, Math.abs(x2 - x1) / 2, Math.abs(ym - y1));
  if (!sx || r < 0.5) return `M${x1},${y1} V${ym} H${x2} V${y2}`;
  return `M${x1},${y1} V${ym - r * sy} Q${x1},${ym} ${x1 + r * sx},${ym} H${x2 - r * sx} Q${x2},${ym} ${x2},${ym + r * sy} V${y2}`;
}
