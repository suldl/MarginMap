import type { ArrowEnd, BoardArrow, BoardItem, BoardStroke, InkColor } from '../../types';

export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Sizes = Map<string, { w: number; h: number }>;

export const DEFAULT_CARD_W = 260;
export const DEFAULT_TEXT_W = 240;
const DEFAULT_CARD_H = 120;

/** Stroke widths for the three size presets, per tool. */
export const SIZE_PRESETS = {
  pen: [2, 4, 8],
  marker: [12, 20, 30],
  shape: [1.5, 3, 5],
  text: [16, 22, 32],
} as const;

export function inkVar(color: InkColor) {
  return color === 'ink' ? 'var(--text)' : `var(--c-${color})`;
}

const strokeBoxes = new WeakMap<number[], Box>();

function strokeBox(s: BoardStroke): Box {
  let b = strokeBoxes.get(s.points);
  if (!b) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < s.points.length; i += 2) {
      minX = Math.min(minX, s.points[i]);
      maxX = Math.max(maxX, s.points[i]);
      minY = Math.min(minY, s.points[i + 1]);
      maxY = Math.max(maxY, s.points[i + 1]);
    }
    b = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    strokeBoxes.set(s.points, b);
  }
  const pad = s.size / 2;
  return { x: s.x + b.x - pad, y: s.y + b.y - pad, w: b.w + s.size, h: b.h + s.size };
}

/** Bounding box of any item. `resolve` gives the boxes of items arrows are attached to. */
export function itemBox(it: BoardItem, sizes: Sizes, resolve?: (id: string) => Box | null): Box {
  switch (it.type) {
    case 'card':
      return { x: it.x, y: it.y, w: it.w, h: sizes.get(it.id)?.h ?? DEFAULT_CARD_H };
    case 'text':
      return { x: it.x, y: it.y, w: it.w, h: sizes.get(it.id)?.h ?? it.fontSize * 1.5 };
    case 'shape':
      return { x: it.x, y: it.y, w: it.w, h: it.h };
    case 'stroke':
      return strokeBox(it);
    case 'arrow': {
      const [a, b] = arrowPoints(it, resolve ?? (() => null));
      return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
    }
  }
}

export function center(b: Box): Pt {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Point where the ray from the box centre towards `toward` leaves the box (plus a small gap). */
function clipToBox(b: Box, toward: Pt, gap = 6): Pt {
  const c = center(b);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return c;
  const tx = dx ? b.w / 2 / Math.abs(dx) : Infinity;
  const ty = dy ? b.h / 2 / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  const len = Math.hypot(dx, dy);
  return { x: c.x + dx * t + (dx / len) * gap, y: c.y + dy * t + (dy / len) * gap };
}

/** Actual start/end points of an arrow, following attached items. */
export function arrowPoints(a: BoardArrow, resolve: (id: string) => Box | null): [Pt, Pt] {
  const boxA = a.from.itemId ? resolve(a.from.itemId) : null;
  const boxB = a.to.itemId ? resolve(a.to.itemId) : null;
  const refA = boxA ? center(boxA) : a.from;
  const refB = boxB ? center(boxB) : a.to;
  return [boxA ? clipToBox(boxA, refB) : { x: a.from.x, y: a.from.y }, boxB ? clipToBox(boxB, refA) : { x: a.to.x, y: a.to.y }];
}

export function arrowHead(a: Pt, b: Pt, size: number): string {
  const len = 8 + size * 2.5;
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const p1 = { x: b.x - len * Math.cos(ang - 0.45), y: b.y - len * Math.sin(ang - 0.45) };
  const p2 = { x: b.x - len * Math.cos(ang + 0.45), y: b.y - len * Math.sin(ang + 0.45) };
  return `${b.x},${b.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`;
}

/** Smooth SVG path through stroke points (quadratic curves through midpoints). */
export function strokePath(points: number[]): string {
  const n = points.length / 2;
  if (n === 0) return '';
  if (n === 1) return `M${points[0]},${points[1]} l0.01,0`;
  if (n === 2) return `M${points[0]},${points[1]} L${points[2]},${points[3]}`;
  let d = `M${points[0]},${points[1]}`;
  for (let i = 1; i < n - 1; i++) {
    const x = points[i * 2];
    const y = points[i * 2 + 1];
    const mx = (x + points[i * 2 + 2]) / 2;
    const my = (y + points[i * 2 + 3]) / 2;
    d += ` Q${x},${y} ${mx},${my}`;
  }
  return d + ` L${points[n * 2 - 2]},${points[n * 2 - 1]}`;
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function inBox(p: Pt, b: Box, pad = 0) {
  return p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;
}

/** Whether point `p` touches the item (tolerance in canvas units). */
export function hitItem(it: BoardItem, p: Pt, tol: number, sizes: Sizes, resolve: (id: string) => Box | null): boolean {
  switch (it.type) {
    case 'card':
    case 'text':
      return inBox(p, itemBox(it, sizes), tol / 2);
    case 'shape': {
      const b = itemBox(it, sizes);
      if (!inBox(p, b, tol + it.size)) return false;
      if (it.fill) return true;
      const edge = tol + it.size / 2;
      if (it.shape === 'rect') {
        return (
          Math.abs(p.x - b.x) <= edge ||
          Math.abs(p.x - b.x - b.w) <= edge ||
          Math.abs(p.y - b.y) <= edge ||
          Math.abs(p.y - b.y - b.h) <= edge
        );
      }
      const rx = b.w / 2;
      const ry = b.h / 2;
      const c = center(b);
      const r = Math.hypot((p.x - c.x) / rx, (p.y - c.y) / ry);
      return Math.abs(r - 1) * Math.min(rx, ry) <= edge;
    }
    case 'stroke': {
      if (!inBox(p, itemBox(it, sizes), tol)) return false;
      const reach = tol + it.size / 2;
      const pts = it.points;
      if (pts.length === 2) return Math.hypot(p.x - it.x - pts[0], p.y - it.y - pts[1]) <= reach;
      for (let i = 0; i < pts.length - 2; i += 2) {
        const a = { x: it.x + pts[i], y: it.y + pts[i + 1] };
        const b = { x: it.x + pts[i + 2], y: it.y + pts[i + 3] };
        if (distToSegment(p, a, b) <= reach) return true;
      }
      return false;
    }
    case 'arrow': {
      const [a, b] = arrowPoints(it, resolve);
      return distToSegment(p, a, b) <= tol + it.size / 2 + 2;
    }
  }
}

export function boxContains(outer: Box, inner: Box) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

export function boxesOverlap(a: Box, b: Box, pad = 0) {
  return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
}

export function normBox(a: Pt, b: Pt): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** Moves an item by (dx, dy). Arrow ends attached to other items stay attached. */
export function translateItem<T extends BoardItem>(it: T, dx: number, dy: number): T {
  if (it.type === 'arrow') {
    const move = (e: ArrowEnd): ArrowEnd => (e.itemId ? e : { x: e.x + dx, y: e.y + dy });
    return { ...it, from: move(it.from), to: move(it.to) };
  }
  return { ...it, x: it.x + dx, y: it.y + dy };
}

export function round1(v: number) {
  return Math.round(v * 10) / 10;
}
