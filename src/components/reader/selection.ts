import { normalizeExcerpt } from '../../lib/util';
import type { PageRect } from '../../types';

interface PxRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Merges per-glyph-run rectangles into one rectangle per line segment. */
export function mergeRects(rects: PxRect[]): PxRect[] {
  const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left);
  const out: PxRect[] = [];
  for (const r of sorted) {
    const h = r.bottom - r.top;
    const m = out.find((o) => {
      const oh = o.bottom - o.top;
      const overlap = Math.min(o.bottom, r.bottom) - Math.max(o.top, r.top);
      const gap = Math.max(oh, h) * 0.9;
      return overlap > 0.5 * Math.min(oh, h) && r.left <= o.right + gap && r.right >= o.left - gap;
    });
    if (m) {
      m.left = Math.min(m.left, r.left);
      m.right = Math.max(m.right, r.right);
      m.top = Math.min(m.top, r.top);
      m.bottom = Math.max(m.bottom, r.bottom);
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

function textNodesIn(range: Range): Text[] {
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) return [root as Text];
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) if (range.intersectsNode(n)) out.push(n as Text);
  return out;
}

export interface SelectionInfo {
  text: string;
  page: number;
  rects: PageRect[];
  /** Toolbar anchor, relative to the pages container. */
  anchor: { x: number; y: number };
}

/** Reads the current text selection inside the reader as page-normalized rectangles. */
export function readSelection(pagesEl: HTMLElement): SelectionInfo | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!pagesEl.contains(range.commonAncestorContainer)) return null;

  const byPage = new Map<number, { el: HTMLElement; rects: PxRect[] }>();
  for (const node of textNodesIn(range)) {
    const parent = node.parentElement;
    const pageEl = parent?.closest<HTMLElement>('.pdf-page');
    if (!parent || !pageEl || !parent.closest('.textLayer')) continue;
    const page = Number(pageEl.dataset.page);
    const r = document.createRange();
    r.selectNodeContents(node);
    if (node === range.startContainer) r.setStart(node, range.startOffset);
    if (node === range.endContainer) r.setEnd(node, range.endOffset);
    let entry = byPage.get(page);
    if (!entry) byPage.set(page, (entry = { el: pageEl, rects: [] }));
    for (const cr of r.getClientRects()) {
      if (cr.width > 0.5 && cr.height > 0.5) entry.rects.push({ left: cr.left, top: cr.top, right: cr.right, bottom: cr.bottom });
    }
  }
  if (!byPage.size) return null;

  const rects: PageRect[] = [];
  let last: PxRect | null = null;
  for (const [page, { el, rects: px }] of [...byPage].sort((a, b) => a[0] - b[0])) {
    const pr = el.getBoundingClientRect();
    for (const m of mergeRects(px)) {
      rects.push({
        page,
        x: (m.left - pr.left) / pr.width,
        y: (m.top - pr.top) / pr.height,
        w: (m.right - m.left) / pr.width,
        h: (m.bottom - m.top) / pr.height,
      });
      last = m;
    }
  }
  const text = normalizeExcerpt(sel.toString());
  if (!text || !rects.length || !last) return null;
  const base = pagesEl.getBoundingClientRect();
  return {
    text,
    page: rects[0].page,
    rects,
    anchor: { x: (last.left + last.right) / 2 - base.left, y: last.bottom - base.top + 8 },
  };
}

/** Text of the text-layer spans whose centre lies inside a normalized page rectangle. */
export function textInArea(pageEl: HTMLElement, rect: { x: number; y: number; w: number; h: number }): string {
  const pr = pageEl.getBoundingClientRect();
  const items: { text: string; cx: number; cy: number; h: number }[] = [];
  for (const span of pageEl.querySelectorAll<HTMLElement>('.textLayer span')) {
    if (span.classList.contains('markedContent') || !span.textContent) continue;
    const r = span.getBoundingClientRect();
    const cx = (r.left + r.width / 2 - pr.left) / pr.width;
    const cy = (r.top + r.height / 2 - pr.top) / pr.height;
    if (cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h) {
      items.push({ text: span.textContent, cx, cy, h: r.height / pr.height });
    }
  }
  const lines: (typeof items)[] = [];
  for (const it of items) {
    const line = lines.find((l) => Math.abs(l[0].cy - it.cy) < Math.max(l[0].h, it.h) * 0.5);
    if (line) line.push(it);
    else lines.push([it]);
  }
  lines.sort((a, b) => a[0].cy - b[0].cy);
  return normalizeExcerpt(
    lines
      .map((l) =>
        l
          .sort((a, b) => a.cx - b.cx)
          .map((i) => i.text)
          .join(' ')
          .replace(/\s+/g, ' '),
      )
      .join('\n'),
  );
}

/** Finds the card whose highlight contains a normalized point on a page. */
export function hitTest(
  highlights: { cardId: string; rects: PageRect[] }[],
  x: number,
  y: number,
  pad = 0.003,
): string | null {
  let best: { id: string; area: number } | null = null;
  for (const h of highlights) {
    for (const r of h.rects) {
      if (x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad) {
        const area = r.w * r.h;
        if (!best || area < best.area) best = { id: h.cardId, area };
      }
    }
  }
  return best?.id ?? null;
}
