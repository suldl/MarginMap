import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { backend, isElectron } from '../../backend';
import { useSizes } from '../../hooks/useSizes';
import { clamp, debounce, uid } from '../../lib/util';
import { boardOf, groupsOf, useNotebook } from '../../store/notebook';
import { useStudy } from '../../store/study';
import { gridSpacing, useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { COLORS, type ArrowEnd, type BoardCardItem, type BoardItem, type BoardText, type InkColor } from '../../types';
import { deleteWithUndoHint, groupSelection, locateCard, openGroupMenu, renameGroup } from '../cardActions';
import { CardPreview, canEnlarge } from '../CardPreview';
import { Icon, type IconName } from '../Icon';
import { useLatexAssist } from '../LatexAssist';
import { ArrowView, BoardCard, BoardTextView, ShapeView, StrokeView } from './BoardItems';
import { boardRegistry, findFreeSpot, placeCards } from './boardActions';
import { CARD_DRAG_MIME, CardTray } from './CardTray';
import {
  arrowHead,
  boxContains,
  boxesOverlap,
  center,
  DEFAULT_CARD_W,
  DEFAULT_TEXT_W,
  hitItem,
  inkVar,
  itemBox,
  normBox,
  round1,
  SIZE_PRESETS,
  strokePath,
  translateItem,
  type Box,
  type Pt,
} from './geometry';

type Tool = 'select' | 'hand' | 'pen' | 'marker' | 'eraser' | 'rect' | 'ellipse' | 'arrow' | 'text' | 'capture';

interface Style {
  color: InkColor;
  size: 0 | 1 | 2;
  fill: boolean;
}

type Interaction =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'move'; ids: string[]; start: Pt; dx: number; dy: number; moved: boolean; clickedId: string; shift: boolean }
  | { kind: 'resize'; id: string; start: Pt; dx: number; dy: number }
  | { kind: 'marquee'; start: Pt; end: Pt; base: string[] }
  | { kind: 'draw'; points: number[]; marker: boolean }
  | { kind: 'erase'; ids: Set<string>; last: Pt }
  | { kind: 'shape'; shape: 'rect' | 'ellipse'; start: Pt; end: Pt; square: boolean }
  | { kind: 'arrow'; from: ArrowEnd; end: Pt; toItem: string | null }
  | { kind: 'capture'; start: Pt; end: Pt };

const TOOLS: { tool: Tool; icon: IconName; label: string; key: string }[] = [
  { tool: 'select', icon: 'cursor', label: 'Select & move', key: 'V' },
  { tool: 'hand', icon: 'hand', label: 'Pan (or hold Space)', key: 'H' },
  { tool: 'pen', icon: 'pen', label: 'Pen', key: 'P' },
  { tool: 'marker', icon: 'marker', label: 'Highlighter', key: 'M' },
  { tool: 'eraser', icon: 'eraser', label: 'Eraser — press E again to go back to the pen', key: 'E' },
  { tool: 'rect', icon: 'square', label: 'Rectangle', key: 'R' },
  { tool: 'ellipse', icon: 'circle', label: 'Ellipse', key: 'O' },
  { tool: 'arrow', icon: 'arrow', label: 'Arrow — drag between cards to connect them', key: 'A' },
  { tool: 'text', icon: 'text', label: 'Text', key: 'T' },
  { tool: 'capture', icon: 'area', label: 'Area excerpt — drag a box to turn that part of the board into a picture card', key: 'C' },
];

const INKS: InkColor[] = ['ink', ...COLORS];
const MIN_K = 0.1;
const MAX_K = 3;
const STYLE_KEY = 'marginmap.board.style';
const viewKey = (nbId: string) => `marginmap.board.view.${nbId}`;

/**
 * Eraser radius in screen pixels. The eraser cursor is drawn by the board itself rather than
 * with CSS `cursor`, because Windows hides the system cursor while a pen touches the tablet.
 */
const ERASER_R = 10;
/** Pointer Events `buttons` bit of a pen's eraser end / eraser button. */
const PEN_ERASER = 32;

function loadJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable
  }
}

function resizeItem(it: BoardItem, dx: number, dy: number): BoardItem {
  switch (it.type) {
    case 'card':
      return { ...it, w: Math.max(140, it.w + dx) };
    case 'text':
      return { ...it, w: Math.max(60, it.w + dx) };
    case 'shape':
      return { ...it, w: Math.max(8, it.w + dx), h: Math.max(8, it.h + dy) };
    default:
      return it;
  }
}

const resizable = (it: BoardItem | undefined) => !!it && (it.type === 'card' || it.type === 'text' || it.type === 'shape');
const attachable = (it: BoardItem) => it.type === 'card' || it.type === 'shape' || it.type === 'text';

export function Whiteboard() {
  const nb = useNotebook((s) => s.nb!);
  /** Title being edited on the board (not one edited in the mind map next to it). */
  const editingId = useNotebook((s) => (s.editingIn === 'board' ? s.editingId : null));
  const selectedIds = useNotebook((s) => s.selectedIds);
  const reveal = useStudy((s) => s.reveal);
  const flash = useStudy((s) => s.flash);
  const enlarge = useStudy((s) => s.enlarge);
  const canvasBg = useSettings((s) => s.canvasBg);
  const cards = nb.cards;
  const items = boardOf(nb).items;
  const groups = groupsOf(nb);

  const [view, setView] = useState(() => loadJson(viewKey(nb.id), { x: 60, y: 60, k: 1 }));
  const [tool, setTool] = useState<Tool>('select');
  /** The drawing tool E returns to from the eraser. */
  const lastDrawTool = useRef<'pen' | 'marker'>('pen');
  useEffect(() => {
    if (tool === 'pen' || tool === 'marker') lastDrawTool.current = tool;
  }, [tool]);
  /** True while a pen's eraser end (or eraser button) is in use, whatever the tool. */
  const [penErasing, setPenErasing] = useState(false);
  const cursorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tool !== 'eraser' && cursorRef.current) cursorRef.current.style.display = 'none';
  }, [tool]);
  const [style, setStyle] = useState<Style>(() => loadJson(STYLE_KEY, { color: 'ink', size: 1, fill: false } as Style));
  const [sel, setSel] = useState<string[]>([]);
  const [ix, setIx] = useState<Interaction | null>(null);
  const [sizes, report] = useSizes();
  const [draft, setDraft] = useState<(BoardText & { isNew: boolean }) | null>(null);
  const [preview, setPreview] = useState<{ cardId: string; itemId: string } | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  const [space, setSpace] = useState(false);
  /** An area excerpt is being captured: the board hides its controls for a moment. */
  const [capturing, setCapturing] = useState(false);
  const [vpSize, setVpSize] = useState({ w: 0, h: 0 });

  const vpRef = useRef<HTMLDivElement>(null);
  const ixRef = useRef(ix);
  ixRef.current = ix;
  const viewRef = useRef(view);
  viewRef.current = view;

  // ---- derived geometry (with in-progress moves/resizes applied) -------------------
  const live = useMemo(() => {
    if (ix?.kind === 'move' && ix.moved) {
      const ids = new Set(ix.ids);
      return items.map((it) => (ids.has(it.id) ? translateItem(it, ix.dx, ix.dy) : it));
    }
    if (ix?.kind === 'resize') return items.map((it) => (it.id === ix.id ? resizeItem(it, ix.dx, ix.dy) : it));
    return items;
  }, [items, ix]);
  const liveById = useMemo(() => new Map(live.map((it) => [it.id, it])), [live]);
  const resolve = useCallback(
    (id: string): Box | null => {
      const it = liveById.get(id);
      return it && it.type !== 'arrow' ? itemBox(it, sizes) : null;
    },
    [liveById, sizes],
  );
  const boxOf = (it: BoardItem) => itemBox(it, sizes, resolve);

  // ---- persistence of view/style + registry for outside placement --------------------
  const saveView = useMemo(() => debounce((id: string, v: typeof view) => saveJson(viewKey(id), v), 400), []);
  useEffect(() => {
    saveView(nb.id, view);
    const el = vpRef.current;
    if (el) boardRegistry.center = { x: (el.clientWidth / 2 - view.x) / view.k, y: (el.clientHeight / 2 - view.y) / view.k };
  }, [view, nb.id, saveView, vpSize]);
  useEffect(() => saveJson(STYLE_KEY, style), [style]);
  useEffect(() => {
    boardRegistry.sizes = sizes;
  }, [sizes]);
  useEffect(
    () => () => {
      boardRegistry.center = null;
      saveView.flush();
    },
    [saveView],
  );
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVpSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Drop selection entries that no longer exist (undo, deletes elsewhere).
  useEffect(() => {
    setSel((s) => {
      const next = s.filter((id) => liveById.has(id));
      return next.length === s.length ? s : next;
    });
    if (preview && (!cards[preview.cardId] || !liveById.has(preview.itemId))) setPreview(null);
  }, [liveById, cards, preview]);

  const wasEditing = useRef(false);
  useEffect(() => {
    if (editingId) setPreview(null);
    // Keep keyboard focus on the board after editing a card's title.
    else if (wasEditing.current && (document.activeElement === document.body || !document.activeElement)) vpRef.current?.focus({ preventScroll: true });
    wasEditing.current = !!editingId;
  }, [editingId]);

  // ---- helpers ------------------------------------------------------------------------
  const toCanvas = (clientX: number, clientY: number): Pt => {
    const r = vpRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
  };

  const topHit = (p: Pt, filter?: (it: BoardItem) => boolean): BoardItem | null => {
    const tol = 6 / view.k;
    for (let i = live.length - 1; i >= 0; i--) {
      const it = live[i];
      if (filter && !filter(it)) continue;
      if (it.type === 'card' && !cards[it.cardId]) continue;
      if (hitItem(it, p, tol, sizes, resolve)) return it;
    }
    return null;
  };

  /** Everything except cards under the eraser circle, sampled along the path from `from` to `to`. */
  const erasable = (from: Pt, to: Pt): string[] => {
    const k = viewRef.current.k;
    const tol = ERASER_R / k;
    const steps = Math.max(1, Math.ceil((Math.hypot(to.x - from.x, to.y - from.y) * k) / 4));
    // Only items near the swept segment need the precise test.
    const swept = normBox(from, to);
    const near = live.filter((it) => it.type !== 'card' && boxesOverlap(boxOf(it), swept, tol + 2));
    const out = new Set<string>();
    for (let s = 0; s <= steps && near.length; s++) {
      const p = { x: from.x + ((to.x - from.x) * s) / steps, y: from.y + ((to.y - from.y) * s) / steps };
      for (const it of near) if (!out.has(it.id) && hitItem(it, p, tol, sizes, resolve)) out.add(it.id);
    }
    return [...out];
  };

  /** Keeps the drawn eraser cursor under the pointer (mouse and pen alike). */
  const moveCursor = (e: React.PointerEvent | PointerEvent, pressed?: boolean) => {
    const el = cursorRef.current;
    const vp = vpRef.current;
    if (!el || !vp) return;
    const r = vp.getBoundingClientRect();
    el.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px)`;
    el.style.display = 'block';
    if (pressed !== undefined) el.classList.toggle('pressed', pressed);
  };
  const hideCursor = () => {
    if (cursorRef.current) cursorRef.current.style.display = 'none';
  };

  const ensureVisible = (b: Box) => {
    const el = vpRef.current;
    if (!el) return;
    const v = viewRef.current;
    const m = 40;
    const sx = b.x * v.k + v.x;
    const sy = b.y * v.k + v.y;
    const sw = b.w * v.k;
    const sh = b.h * v.k;
    let dx = 0;
    let dy = 0;
    if (sw > el.clientWidth - 2 * m || sx < m) dx = m - sx;
    else if (sx + sw > el.clientWidth - m) dx = el.clientWidth - m - (sx + sw);
    if (sh > el.clientHeight - 2 * m || sy < m) dy = m - sy;
    else if (sy + sh > el.clientHeight - m) dy = el.clientHeight - m - (sy + sh);
    if (dx || dy) setView({ ...v, x: v.x + dx, y: v.y + dy });
  };

  const fit = () => {
    const el = vpRef.current;
    if (!el || !live.length) return;
    const boxes = live.map(boxOf);
    const minX = Math.min(...boxes.map((b) => b.x)) - (groups.length ? 16 : 0);
    const minY = Math.min(...boxes.map((b) => b.y)) - (groups.length ? 44 : 0); // room for group frames and labels
    const maxX = Math.max(...boxes.map((b) => b.x + b.w)) + (groups.length ? 16 : 0);
    const maxY = Math.max(...boxes.map((b) => b.y + b.h)) + (groups.length ? 16 : 0);
    // Keep clear of the tool palette (left), style bar (top) and zoom controls (bottom).
    const inset = { l: 72, r: 40, t: 56, b: 64 };
    const W = el.clientWidth - inset.l - inset.r;
    const H = el.clientHeight - inset.t - inset.b;
    const k = clamp(Math.min(W / (maxX - minX || 1), H / (maxY - minY || 1), 1.2), MIN_K, MAX_K);
    setView({ k, x: inset.l + (W - (maxX - minX) * k) / 2 - minX * k, y: inset.t + (H - (maxY - minY) * k) / 2 - minY * k });
  };

  const zoomAt = (k: number) => {
    const el = vpRef.current;
    if (!el) return;
    const v = viewRef.current;
    const nk = clamp(k, MIN_K, MAX_K);
    const px = el.clientWidth / 2;
    const py = el.clientHeight / 2;
    setPreview(null);
    setView({ k: nk, x: px - ((px - v.x) * nk) / v.k, y: py - ((py - v.y) * nk) / v.k });
  };

  /** Selects board items; `focus` is the card the card panel shows when several are selected. */
  const selectItems = (ids: string[], focus?: string) => {
    setSel(ids);
    // Selected cards also become the notebook selection, so the card panel can edit them in bulk.
    const cardIds = ids.flatMap((id) => {
      const it = liveById.get(id);
      return it?.type === 'card' && cards[it.cardId] ? [it.cardId] : [];
    });
    if (cardIds.length === 1) useNotebook.getState().select(cardIds[0]);
    else if (cardIds.length > 1) useNotebook.getState().setSelection(cardIds, focus && cardIds.includes(focus) ? focus : undefined);
  };

  /** Board items of the cards in a group. */
  const groupItems = (groupId: string) =>
    live.filter((it): it is BoardCardItem => it.type === 'card' && cards[it.cardId]?.groupId === groupId).map((it) => it.id);

  const focusCard = (cardId: string) => {
    const it = live.find((i) => i.type === 'card' && i.cardId === cardId);
    if (!it) return;
    selectItems([it.id]);
    ensureVisible(boxOf(it));
  };

  // Cards selected elsewhere (mind map, outline, a highlight in the reader) are selected here too.
  useEffect(() => {
    const want = new Set(selectedIds);
    setSel((cur) => {
      const curCards = cur.flatMap((id) => {
        const it = liveById.get(id);
        return it?.type === 'card' ? [it.cardId] : [];
      });
      if (curCards.length === want.size && curCards.every((id) => want.has(id))) return cur;
      return items.filter((it) => it.type === 'card' && want.has(it.cardId)).map((it) => it.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);

  // Reveal requests (new excerpts, keyboard navigation in the map…) bring the card into view.
  // (Requests made before the whiteboard opened are ignored.)
  const seenReveal = useRef(reveal?.nonce);
  useEffect(() => {
    if (!reveal || reveal.nonce === seenReveal.current) return;
    seenReveal.current = reveal.nonce;
    const it = live.find((i) => i.type === 'card' && i.cardId === reveal.cardId);
    if (it) ensureVisible(boxOf(it));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal]);

  // ---- wheel: pan, Ctrl+wheel: zoom -----------------------------------------------------
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element).closest('.card-preview, .wb-tray')) return;
      e.preventDefault();
      setPreview(null);
      const r = el.getBoundingClientRect();
      const v = viewRef.current;
      if (e.ctrlKey) {
        const nk = clamp(v.k * Math.exp(-e.deltaY * 0.0025), MIN_K, MAX_K);
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        setView({ k: nk, x: px - ((px - v.x) * nk) / v.k, y: py - ((py - v.y) * nk) / v.k });
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        setView({ ...v, x: v.x - dx, y: v.y - dy });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ---- pointer interactions ---------------------------------------------------------------
  const presetSize = (kind: keyof typeof SIZE_PRESETS) => SIZE_PRESETS[kind][style.size];

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('.wb-tools, .wb-style, .map-hud, .wb-tray, .card-preview, textarea, input')) return;
    vpRef.current?.focus({ preventScroll: true });
    setPreview(null);
    const p = toCanvas(e.clientX, e.clientY);
    const v = viewRef.current;
    if (e.button === 1 || (e.button === 0 && (tool === 'hand' || space))) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setIx({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y });
      return;
    }
    // A pen's eraser end (or eraser button) erases whatever tool is active.
    const penEraser = e.pointerType === 'pen' && (e.buttons & PEN_ERASER) !== 0;
    if (penEraser || (tool === 'eraser' && e.button === 0)) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setPenErasing(penEraser);
      moveCursor(e, true);
      setIx({ kind: 'erase', ids: new Set(erasable(p, p)), last: p });
      return;
    }
    if (e.button !== 0) return;
    // Dragging a group by its label moves all of its cards; a click selects them.
    const label = (e.target as Element).closest<HTMLElement>('.group-label');
    if (label?.dataset.group && tool === 'select') {
      e.currentTarget.setPointerCapture(e.pointerId);
      const ids = groupItems(label.dataset.group);
      selectItems(ids);
      setIx({ kind: 'move', ids, start: p, dx: 0, dy: 0, moved: false, clickedId: '', shift: false });
      return;
    }
    if (tool === 'text') {
      // Keep the browser from moving focus to the canvas, or the new text box would blur at once.
      e.preventDefault();
      const fontSize = presetSize('text');
      setDraft({ id: uid(), type: 'text', x: p.x, y: p.y - fontSize * 0.7, w: DEFAULT_TEXT_W, text: '', color: style.color, fontSize, isNew: true });
      setTool('select');
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);

    switch (tool) {
      case 'select': {
        // Resize handle of a single selected item.
        if (sel.length === 1) {
          const it = liveById.get(sel[0]);
          if (it && resizable(it)) {
            const b = boxOf(it);
            if (Math.hypot(p.x - (b.x + b.w), p.y - (b.y + b.h)) <= 9 / v.k) {
              setIx({ kind: 'resize', id: it.id, start: p, dx: 0, dy: 0 });
              return;
            }
          }
        }
        const hit = topHit(p);
        if (hit) {
          let next = sel;
          if (e.shiftKey) next = sel.includes(hit.id) ? sel.filter((id) => id !== hit.id) : [...sel, hit.id];
          else if (!sel.includes(hit.id)) next = [hit.id];
          selectItems(next, hit.type === 'card' ? hit.cardId : undefined);
          setIx({ kind: 'move', ids: next.includes(hit.id) ? next : [], start: p, dx: 0, dy: 0, moved: false, clickedId: hit.id, shift: e.shiftKey });
        } else {
          if (!e.shiftKey) {
            setSel([]);
            useNotebook.getState().select(null);
          }
          setIx({ kind: 'marquee', start: p, end: p, base: e.shiftKey ? sel : [] });
        }
        return;
      }
      case 'pen':
      case 'marker':
        setIx({ kind: 'draw', points: [round1(p.x), round1(p.y)], marker: tool === 'marker' });
        return;
      case 'rect':
      case 'ellipse':
        setIx({ kind: 'shape', shape: tool, start: p, end: p, square: e.shiftKey });
        return;
      case 'arrow': {
        const hit = topHit(p, attachable);
        setIx({ kind: 'arrow', from: hit ? { x: p.x, y: p.y, itemId: hit.id } : { x: p.x, y: p.y }, end: p, toItem: null });
        return;
      }
      case 'capture':
        setIx({ kind: 'capture', start: p, end: p });
        return;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const cur = ixRef.current;
    const penEraser = e.pointerType === 'pen' && (e.buttons & PEN_ERASER) !== 0;
    if (tool === 'eraser' || penEraser || cur?.kind === 'erase') moveCursor(e, cur?.kind === 'erase');
    else hideCursor();
    if (!cur) return;
    const p = toCanvas(e.clientX, e.clientY);
    switch (cur.kind) {
      case 'pan':
        setView((v) => ({ ...v, x: cur.vx + (e.clientX - cur.sx), y: cur.vy + (e.clientY - cur.sy) }));
        break;
      case 'move': {
        const dx = p.x - cur.start.x;
        const dy = p.y - cur.start.y;
        const moved = cur.moved || Math.hypot(dx, dy) * viewRef.current.k > 3;
        setIx({ ...cur, dx, dy, moved });
        break;
      }
      case 'resize':
        setIx({ ...cur, dx: p.x - cur.start.x, dy: p.y - cur.start.y });
        break;
      case 'marquee':
      case 'capture':
        setIx({ ...cur, end: p });
        break;
      case 'draw': {
        const n = cur.points.length;
        if (Math.hypot(p.x - cur.points[n - 2], p.y - cur.points[n - 1]) * viewRef.current.k < 2) break;
        cur.points.push(round1(p.x), round1(p.y));
        setIx({ ...cur });
        break;
      }
      case 'erase': {
        const hits = erasable(cur.last, p).filter((id) => !cur.ids.has(id));
        setIx({ ...cur, last: p, ids: hits.length ? new Set([...cur.ids, ...hits]) : cur.ids });
        break;
      }
      case 'shape':
        setIx({ ...cur, end: p, square: e.shiftKey });
        break;
      case 'arrow': {
        const hit = topHit(p, (it) => attachable(it) && it.id !== cur.from.itemId);
        setIx({ ...cur, end: p, toItem: hit?.id ?? null });
        break;
      }
    }
  };

  const shapeBox = (cur: Extract<Interaction, { kind: 'shape' }>): Box => {
    const b = normBox(cur.start, cur.end);
    if (!cur.square) return b;
    const s = Math.max(b.w, b.h);
    return { x: cur.end.x < cur.start.x ? cur.start.x - s : cur.start.x, y: cur.end.y < cur.start.y ? cur.start.y - s : cur.start.y, w: s, h: s };
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const cur = ixRef.current;
    setIx(null);
    if (cur?.kind === 'erase') {
      setPenErasing(false);
      if (tool === 'eraser') moveCursor(e, false);
      else hideCursor();
    }
    if (!cur) return;
    const store = useNotebook.getState();
    switch (cur.kind) {
      case 'move': {
        if (cur.moved && cur.ids.length) {
          store.boardReplace(cur.ids.map((id) => translateItem(items.find((i) => i.id === id)!, round1(cur.dx), round1(cur.dy))));
          return;
        }
        if (!cur.clickedId) return; // a click on a group label (already selected)
        // A plain click selects (the page tag or "Locate in document" finds the excerpt).
        if (!cur.shift) selectItems([cur.clickedId]);
        return;
      }
      case 'resize': {
        const it = items.find((i) => i.id === cur.id);
        if (it && (cur.dx || cur.dy)) store.boardReplace([resizeItem(it, round1(cur.dx), round1(cur.dy))]);
        return;
      }
      case 'marquee': {
        const r = normBox(cur.start, cur.end);
        if (r.w * view.k < 4 && r.h * view.k < 4) return;
        const inside = live.filter((it) => boxContains(r, boxOf(it))).map((it) => it.id);
        selectItems([...new Set([...cur.base, ...inside])]);
        return;
      }
      case 'draw': {
        const pts = cur.points;
        let minX = Infinity;
        let minY = Infinity;
        for (let i = 0; i < pts.length; i += 2) {
          minX = Math.min(minX, pts[i]);
          minY = Math.min(minY, pts[i + 1]);
        }
        const rel = pts.map((v, i) => round1(v - (i % 2 ? minY : minX)));
        store.boardAdd([
          {
            id: uid(),
            type: 'stroke',
            x: minX,
            y: minY,
            points: rel,
            color: style.color,
            size: presetSize(cur.marker ? 'marker' : 'pen'),
            highlighter: cur.marker || undefined,
          },
        ]);
        return;
      }
      case 'erase':
        if (cur.ids.size) store.boardRemove([...cur.ids]);
        return;
      case 'shape': {
        const b = shapeBox(cur);
        if (b.w * view.k < 4 || b.h * view.k < 4) return;
        const id = uid();
        store.boardAdd([{ id, type: 'shape', shape: cur.shape, ...b, color: style.color, size: presetSize('shape'), fill: style.fill }]);
        setSel([id]);
        setTool('select');
        return;
      }
      case 'arrow': {
        const len = Math.hypot(cur.end.x - cur.from.x, cur.end.y - cur.from.y);
        if (len * view.k < 10 && !cur.toItem) return;
        const id = uid();
        const to: ArrowEnd = cur.toItem ? { x: cur.end.x, y: cur.end.y, itemId: cur.toItem } : { x: cur.end.x, y: cur.end.y };
        store.boardAdd([{ id, type: 'arrow', from: cur.from, to, color: style.color, size: presetSize('shape') }]);
        setSel([id]);
        setTool('select');
        return;
      }
      case 'capture': {
        const b = normBox(cur.start, cur.end);
        if (b.w * view.k < 8 || b.h * view.k < 8) return;
        setTool('select');
        void captureArea(b);
        return;
      }
    }
  };

  /** Area excerpt: turns what is drawn inside a box of the board into a picture card next to it. */
  const captureArea = async (b: Box) => {
    const vp = vpRef.current;
    if (!vp) return;
    const r = vp.getBoundingClientRect();
    const v = viewRef.current;
    // The box on screen, kept inside the board.
    const left = Math.max(r.left, r.left + v.x + b.x * v.k);
    const top = Math.max(r.top, r.top + v.y + b.y * v.k);
    const right = Math.min(r.right, r.left + v.x + (b.x + b.w) * v.k);
    const bottom = Math.min(r.bottom, r.top + v.y + (b.y + b.h) * v.k);
    if (right - left < 4 || bottom - top < 4) return;
    if (!isElectron) {
      useUi.getState().toast('Area excerpts of the whiteboard need the desktop app', 'error');
      return;
    }
    // Text inside the box, for search and export (the card itself shows the picture).
    const text = live
      .filter((it) => {
        const c = center(boxOf(it));
        return c.x >= b.x && c.x <= b.x + b.w && c.y >= b.y && c.y <= b.y + b.h;
      })
      .flatMap((it) => (it.type === 'text' ? [it.text] : it.type === 'card' && cards[it.cardId] ? [cards[it.cardId].title, cards[it.cardId].excerpt] : []))
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n');
    setCapturing(true);
    let blob: Blob | null = null;
    try {
      // Let the board hide its controls and selection before the picture is taken.
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      blob = await backend.capturePage({ x: left, y: top, width: right - left, height: bottom - top });
    } catch (err) {
      console.error(err);
    } finally {
      setCapturing(false);
    }
    if (!blob) {
      useUi.getState().toast('Could not capture that area', 'error');
      return;
    }
    const imageId = uid();
    await backend.putAsset(imageId, blob);
    const store = useNotebook.getState();
    const spot = findFreeSpot({ x: b.x + b.w + 40, y: b.y });
    const id = store.addCard(
      { imageId, imageText: text || undefined, color: useStudy.getState().color },
      { parentId: null },
      { boardAt: { ...spot, w: DEFAULT_CARD_W } },
    );
    useStudy.getState().flashCard(id);
    useUi.getState().toast('Captured as a picture card');
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (tool !== 'select' || (e.target as Element).closest('.wb-tools, .wb-style, .map-hud, .wb-tray, .card-preview, textarea')) return;
    const p = toCanvas(e.clientX, e.clientY);
    const hit = topHit(p);
    const store = useNotebook.getState();
    if (hit?.type === 'text') {
      setDraft({ ...hit, isNew: false });
    } else if (hit?.type === 'card') {
      // A picture card opens enlarged, any other card is renamed.
      const card = cards[hit.cardId];
      if (enlarge && card && canEnlarge(card)) setPreview({ cardId: card.id, itemId: hit.id });
      else store.setEditing(hit.cardId);
    } else if (!hit) {
      const id = store.addCard({}, { parentId: null }, { boardAt: { x: p.x - DEFAULT_CARD_W / 2, y: p.y - 20 } });
      store.setEditing(id);
    }
  };

  // Focus a text box when editing starts (autoFocus alone can lose a race with pointer focus).
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!draft) return;
    const el = draftRef.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id]);

  // Escape and the blur that follows both end editing; only the first may commit.
  const draftData = useRef(draft);
  draftData.current = draft;
  const commitDraft = () => {
    const d = draftData.current;
    if (!d) return;
    draftData.current = null;
    setDraft(null);
    const { isNew, ...item } = d;
    const store = useNotebook.getState();
    if (!item.text.trim()) {
      if (!isNew) store.boardRemove([item.id]);
    } else if (isNew) {
      store.boardAdd([item]);
    } else {
      store.boardReplace([item]);
    }
    vpRef.current?.focus({ preventScroll: true });
  };

  // ---- styling selected items -----------------------------------------------------------------
  const applyStyle = (patch: Partial<Style>) => {
    const next = { ...style, ...patch };
    setStyle(next);
    if (!sel.length) return;
    const store = useNotebook.getState();
    const changed: BoardItem[] = [];
    for (const id of sel) {
      const it = items.find((i) => i.id === id);
      if (!it) continue;
      if (it.type === 'card') {
        if (patch.color && patch.color !== 'ink') store.updateCard(it.cardId, { color: patch.color });
        continue;
      }
      let upd: BoardItem = it;
      if (patch.color) upd = { ...upd, color: patch.color } as BoardItem;
      if (patch.size !== undefined) {
        if (upd.type === 'stroke') upd = { ...upd, size: SIZE_PRESETS[upd.highlighter ? 'marker' : 'pen'][next.size] };
        else if (upd.type === 'shape' || upd.type === 'arrow') upd = { ...upd, size: SIZE_PRESETS.shape[next.size] };
        else if (upd.type === 'text') upd = { ...upd, fontSize: SIZE_PRESETS.text[next.size] };
      }
      if (patch.fill !== undefined && upd.type === 'shape') upd = { ...upd, fill: patch.fill };
      if (upd !== it) changed.push(upd);
    }
    if (changed.length) store.boardReplace(changed);
  };

  // ---- keyboard ---------------------------------------------------------------------------------
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    const store = useNotebook.getState();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectItems(live.map((i) => i.id));
      return;
    }
    if (mod && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      const cardIds = sel.flatMap((id) => {
        const it = liveById.get(id);
        return it?.type === 'card' ? [it.cardId] : [];
      });
      if (e.shiftKey) {
        for (const g of new Set(cardIds.map((id) => cards[id]?.groupId).filter(Boolean) as string[])) store.ungroup(g);
      } else if (cardIds.length) {
        void groupSelection(cardIds);
      }
      return;
    }
    if (mod) return;
    if (e.key.toLowerCase() === 'e') {
      // E toggles between the eraser and the pen (or highlighter) used last.
      setTool(tool === 'eraser' ? lastDrawTool.current : 'eraser');
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      setSpace(true);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (sel.length) {
        store.boardRemove(sel);
        setSel([]);
      }
      return;
    }
    if (e.key === 'Escape') {
      if (preview) setPreview(null);
      else if (sel.length) setSel([]);
      else setTool('select');
      return;
    }
    if (e.key.startsWith('Arrow') && sel.length) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      store.boardReplace(
        sel.map((id) => translateItem(items.find((i) => i.id === id)!, dx, dy)).filter(Boolean),
        'nudge',
      );
      return;
    }
    const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
    if (t) setTool(t.tool);
  };

  // ---- context menu -------------------------------------------------------------------------------
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const label = (e.target as Element).closest<HTMLElement>('.group-label');
    if (label?.dataset.group) {
      const gid = label.dataset.group;
      openGroupMenu(e.clientX, e.clientY, gid, [{ label: 'Select on whiteboard', onClick: () => selectItems(groupItems(gid)) }]);
      return;
    }
    const p = toCanvas(e.clientX, e.clientY);
    const hit = topHit(p);
    const store = useNotebook.getState();
    const ui = useUi.getState();
    if (!hit) {
      const unplaced = Object.keys(cards).filter((id) => !items.some((i) => i.type === 'card' && i.cardId === id));
      ui.openMenu(e.clientX, e.clientY, [
        { label: 'New card here', shortcut: 'Double-click', onClick: () => {
          const id = store.addCard({}, { parentId: null }, { boardAt: { x: p.x - DEFAULT_CARD_W / 2, y: p.y - 20 } });
          store.setEditing(id);
        } },
        { label: `Add all cards (${unplaced.length})`, disabled: !unplaced.length, onClick: () => placeCards(unplaced, p) },
        { separator: true },
        { label: 'Select all', shortcut: 'Ctrl+A', disabled: !live.length, onClick: () => selectItems(live.map((i) => i.id)) },
        { label: 'Fit to screen', onClick: fit },
      ]);
      return;
    }
    const ids = sel.includes(hit.id) ? sel : [hit.id];
    if (!sel.includes(hit.id)) selectItems([hit.id]);
    const layering = [
      { label: 'Bring to front', onClick: () => store.boardReorder(ids, 'front') },
      { label: 'Send to back', onClick: () => store.boardReorder(ids, 'back') },
    ];
    const selCardIds = ids.flatMap((id) => {
      const it = liveById.get(id);
      return it?.type === 'card' && cards[it.cardId] ? [it.cardId] : [];
    });
    if (hit.type === 'card' && cards[hit.cardId]) {
      const card = cards[hit.cardId];
      const group = card.groupId ? groups.find((g) => g.id === card.groupId) : undefined;
      const picture = canEnlarge(card);
      ui.openMenu(e.clientX, e.clientY, [
        ...(selCardIds.length > 1 ? [{ header: `${ids.length} items selected` }] : []),
        { label: 'Edit title', shortcut: picture && enlarge ? undefined : 'Double-click', onClick: () => store.setEditing(card.id) },
        ...(picture
          ? [{ label: 'Enlarge', shortcut: enlarge ? 'Double-click' : undefined, onClick: () => setPreview({ cardId: card.id, itemId: hit.id }) }]
          : []),
        { label: 'Locate in document', disabled: !card.source, onClick: () => locateCard(card) },
        {
          label: 'Show in mind map',
          onClick: () => {
            useStudy.getState().showPane('map', true);
            useStudy.getState().set({ mapView: 'mindmap' });
            store.select(card.id);
            useStudy.getState().revealCard(card.id);
          },
        },
        { separator: true },
        ...layering,
        selCardIds.length > 1 || !group
          ? { label: selCardIds.length > 1 ? `Group ${selCardIds.length} cards…` : 'Group…', shortcut: 'Ctrl+G', onClick: () => void groupSelection(selCardIds) }
          : { label: `Remove from “${group.name}”`, onClick: () => store.updateCard(card.id, { groupId: undefined }) },
        { separator: true },
        { label: 'Remove from whiteboard', shortcut: 'Del', onClick: () => store.boardRemove(ids) },
        { label: 'Delete card…', danger: true, onClick: () => deleteWithUndoHint([card.id]) },
      ]);
      return;
    }
    ui.openMenu(e.clientX, e.clientY, [
      ...(hit.type === 'text' ? [{ label: 'Edit text', onClick: () => setDraft({ ...hit, isNew: false }) }, { separator: true }] : []),
      ...layering,
      { separator: true },
      { label: 'Delete', shortcut: 'Del', danger: true, onClick: () => store.boardRemove(ids) },
    ]);
  };

  // ---- drop cards from the tray ------------------------------------------------------------------
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(CARD_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = (e: React.DragEvent) => {
    const cardId = e.dataTransfer.getData(CARD_DRAG_MIME);
    if (!cardId) return;
    e.preventDefault();
    e.stopPropagation();
    const p = toCanvas(e.clientX, e.clientY);
    const ids = placeCards([cardId], { x: p.x - DEFAULT_CARD_W / 2, y: p.y - 24 });
    setSel(ids);
  };

  // ---- render ----------------------------------------------------------------------------------------
  const gridSize = gridSpacing(view.k, canvasBg);
  const eraseIds = ix?.kind === 'erase' ? ix.ids : null;
  const cursor =
    space || tool === 'hand'
      ? ix?.kind === 'pan'
        ? 'grabbing'
        : 'grab'
      : tool === 'eraser' || penErasing
        ? 'none'
        : tool === 'text'
          ? 'text'
          : tool === 'select'
            ? 'default'
            : 'crosshair';
  const single = sel.length === 1 ? liveById.get(sel[0]) : undefined;
  const previewCard = preview ? cards[preview.cardId] : undefined;
  const previewItem = preview ? liveById.get(preview.itemId) : undefined;
  // Colours/sizes are offered while a drawing tool is active, or to restyle a selection.
  const showStyleBar = (tool !== 'select' && tool !== 'hand' && tool !== 'eraser' && tool !== 'capture') || (tool === 'select' && sel.length > 0);
  const arrowFrom = ix?.kind === 'arrow' ? (ix.from.itemId ? resolve(ix.from.itemId) : null) : null;
  const frames = groups
    .map((g) => {
      const boxes = live.filter((it) => it.type === 'card' && cards[it.cardId]?.groupId === g.id).map(boxOf);
      if (!boxes.length) return null;
      const pad = 14;
      const x = Math.min(...boxes.map((b) => b.x)) - pad;
      const y = Math.min(...boxes.map((b) => b.y)) - pad;
      const w = Math.max(...boxes.map((b) => b.x + b.w)) + pad - x;
      const h = Math.max(...boxes.map((b) => b.y + b.h)) + pad - y;
      return { g, x, y, w, h, count: boxes.length };
    })
    .filter((f) => f !== null);

  return (
    <div
      ref={vpRef}
      className={`mindmap whiteboard ${capturing ? 'capturing' : ''}`}
      tabIndex={0}
      style={
        {
          cursor,
          '--grid': `${gridSize}px`,
          '--gx': `${view.x % gridSize}px`,
          '--gy': `${view.y % gridSize}px`,
        } as React.CSSProperties
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        setIx(null);
        setPenErasing(false);
        hideCursor();
      }}
      onPointerLeave={() => !ixRef.current && hideCursor()}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => e.key === ' ' && setSpace(false)}
      onBlur={() => setSpace(false)}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="mm-canvas" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        {frames.map((f) => (
          <div
            key={f.g.id}
            className="group-frame"
            style={{ left: f.x, top: f.y, width: f.w, height: f.h, '--gc': `var(--c-${f.g.color})` } as React.CSSProperties}
          />
        ))}
        {frames.map((f) => (
          <div
            key={`l-${f.g.id}`}
            className="group-label"
            data-group={f.g.id}
            title="Click to select the group · drag to move it · double-click to rename"
            style={{ left: f.x, top: f.y, '--gc': `var(--c-${f.g.color})` } as React.CSSProperties}
            onDoubleClick={(e) => {
              e.stopPropagation();
              void renameGroup(f.g.id);
            }}
          >
            <Icon name="group" size={12} />
            <span>{f.g.name}</span>
            <span className="group-count">{f.count}</span>
          </div>
        ))}
        {live.map((it) => {
          const faded = !!eraseIds?.has(it.id);
          switch (it.type) {
            case 'card': {
              const card = cards[it.cardId];
              if (!card) return null;
              return (
                <BoardCard
                  key={it.id}
                  item={it}
                  card={card}
                  editing={editingId === card.id}
                  faded={faded}
                  flashNonce={flash?.cardId === card.id ? flash.nonce : 0}
                  report={report}
                />
              );
            }
            case 'text':
              return draft?.id === it.id ? null : <BoardTextView key={it.id} item={it} faded={faded} report={report} />;
            case 'shape':
              return <ShapeView key={it.id} item={it} faded={faded} />;
            case 'stroke':
              return <StrokeView key={it.id} item={it} faded={faded} />;
            case 'arrow':
              return <ArrowView key={it.id} item={it} resolve={resolve} faded={faded} />;
          }
        })}

        {/* In-progress drawing */}
        {ix?.kind === 'draw' && (
          <svg className={`wb-svg ${ix.marker ? 'marker' : ''}`} width="1" height="1">
            <path
              d={strokePath(ix.points)}
              fill="none"
              stroke={inkVar(style.color)}
              strokeOpacity={ix.marker ? 0.38 : 1}
              strokeWidth={presetSize(ix.marker ? 'marker' : 'pen')}
              strokeLinecap={ix.marker ? 'square' : 'round'}
              strokeLinejoin="round"
            />
          </svg>
        )}
        {ix?.kind === 'shape' && (
          <ShapeView
            item={{ id: '_', type: 'shape', shape: ix.shape, ...shapeBox(ix), color: style.color, size: presetSize('shape'), fill: style.fill }}
            faded={false}
          />
        )}
        {ix?.kind === 'arrow' && (
          <>
            {ix.toItem && resolve(ix.toItem) && <SelBox box={resolve(ix.toItem)!} k={view.k} accent />}
            {arrowFrom && <SelBox box={arrowFrom} k={view.k} accent />}
            <svg className="wb-svg" width="1" height="1">
              <line x1={ix.from.x} y1={ix.from.y} x2={ix.end.x} y2={ix.end.y} stroke={inkVar(style.color)} strokeWidth={presetSize('shape')} strokeDasharray="6 5" />
              <polygon points={arrowHead(ix.from, ix.end, presetSize('shape'))} fill={inkVar(style.color)} />
            </svg>
          </>
        )}

        {/* Selection */}
        {sel.map((id) => {
          const it = liveById.get(id);
          return it ? <SelBox key={id} box={boxOf(it)} k={view.k} /> : null;
        })}
        {single && resizable(single) && !ix && <Handle box={boxOf(single)} k={view.k} />}
        {ix?.kind === 'marquee' && <div className="wb-marquee" style={{ ...boxStyle(normBox(ix.start, ix.end)), borderWidth: 1 / view.k }} />}
        {ix?.kind === 'capture' && <div className="wb-capture" style={{ ...boxStyle(normBox(ix.start, ix.end)), borderWidth: 2 / view.k }} />}

        {/* Text editing */}
        {draft && (
          <TextDraft
            draft={draft}
            inputRef={draftRef}
            onChange={(text) => setDraft((d) => (d ? { ...d, text } : d))}
            onCommit={commitDraft}
          />
        )}
      </div>

      <div
        ref={cursorRef}
        className="wb-eraser-cursor"
        style={{ width: ERASER_R * 2, height: ERASER_R * 2, marginLeft: -ERASER_R, marginTop: -ERASER_R, display: 'none' }}
      />


      {!items.length && !draft && (
        <div className="empty" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <div>
            <Icon name="whiteboard" size={44} />
            <h3>An empty whiteboard</h3>
            <p>
              Drag cards here from the <b>Cards</b> panel, excerpt from the document,
              <br />
              or draw, write and connect ideas with the tools on the left.
            </p>
          </div>
        </div>
      )}

      {/* Tools */}
      <div className="wb-tools" onPointerDown={(e) => e.stopPropagation()}>
        {TOOLS.map((t, i) => (
          <span key={t.tool} style={{ display: 'contents' }}>
            {(i === 2 || i === 5 || i === 9) && <div className="wb-tools-sep" />}
            <button className={`btn icon ${tool === t.tool ? 'on' : ''}`} title={`${t.label} (${t.key})`} onClick={() => setTool(t.tool)}>
              <Icon name={t.icon} />
            </button>
          </span>
        ))}
      </div>

      {showStyleBar && (
        <div className="wb-style" onPointerDown={(e) => e.stopPropagation()}>
          <div className="swatches">
            {INKS.map((c) => (
              <button
                key={c}
                className={`swatch ${style.color === c ? 'on' : ''}`}
                style={{ '--sw': inkVar(c) } as React.CSSProperties}
                title={c === 'ink' ? 'Ink' : c}
                onClick={() => applyStyle({ color: c })}
              />
            ))}
          </div>
          <div className="divider-v" />
          {([0, 1, 2] as const).map((s) => (
            <button key={s} className={`btn icon ${style.size === s ? 'on' : ''}`} title={['Thin', 'Medium', 'Bold'][s]} onClick={() => applyStyle({ size: s })}>
              <span className="wb-size-dot" style={{ width: 4 + s * 4, height: 4 + s * 4 }} />
            </button>
          ))}
          <div className="divider-v" />
          <button className={`btn ${style.fill ? 'on' : ''}`} title="Fill shapes" onClick={() => applyStyle({ fill: !style.fill })}>
            Fill
          </button>
        </div>
      )}

      {trayOpen && (
        <CardTray
          onClose={() => setTrayOpen(false)}
          onPlace={(ids) => setSel(placeCards(ids))}
          onFocus={focusCard}
        />
      )}

      {previewCard && previewItem && (
        <CardPreview
          card={previewCard}
          anchor={{
            left: previewItem.type === 'card' ? previewItem.x * view.k + view.x : 0,
            top: previewItem.type === 'card' ? previewItem.y * view.k + view.y : 0,
            width: previewItem.type === 'card' ? previewItem.w * view.k : 300,
          }}
          bounds={{ w: vpSize.w || vpRef.current?.clientWidth || 600, h: vpSize.h || vpRef.current?.clientHeight || 600 }}
          onClose={() => setPreview(null)}
        />
      )}

      <div className="map-hint" style={vpSize.w && vpSize.w < 1000 ? { display: 'none' } : undefined}>
        <span>{HINTS[tool]}</span>
      </div>

      <div className="map-hud" onPointerDown={(e) => e.stopPropagation()}>
        <button className={`btn ${trayOpen ? 'on' : ''}`} title="Cards panel — drag cards onto the board" onClick={() => setTrayOpen(!trayOpen)}>
          <Icon name="cards" size={16} /> Cards
        </button>
        <button
          className={`btn icon ${enlarge ? 'on' : ''}`}
          title={`Enlarge picture cards on double-click: ${enlarge ? 'on' : 'off'}`}
          onClick={() => useStudy.getState().set({ enlarge: !enlarge })}
        >
          <Icon name="enlarge" />
        </button>
        <div className="divider-v" />
        <button className="btn icon" title="Zoom out" onClick={() => zoomAt(view.k / 1.2)}>
          <Icon name="zoomOut" />
        </button>
        <span className="zoom-label" onClick={() => zoomAt(1)} title="Reset to 100%">
          {Math.round(view.k * 100)}%
        </span>
        <button className="btn icon" title="Zoom in" onClick={() => zoomAt(view.k * 1.2)}>
          <Icon name="zoomIn" />
        </button>
        <button className="btn icon" title="Fit to screen" onClick={fit}>
          <Icon name="fit" />
        </button>
      </div>
    </div>
  );
}

const HINTS: Record<Tool, string> = {
  select: 'Drag to move · double-click empty space for a new card · Shift+click to multi-select',
  hand: 'Drag to pan',
  pen: 'Draw freehand',
  marker: 'Highlight over anything',
  eraser: 'Drag over drawings, shapes, text or arrows to erase them · press E again to go back to the pen',
  rect: 'Drag to draw a rectangle · Shift for a square',
  ellipse: 'Drag to draw an ellipse · Shift for a circle',
  arrow: 'Drag from one card to another to connect them',
  text: 'Click to place text',
  capture: 'Drag a box over part of the board to turn it into a picture card',
};

/** Editor for a whiteboard text item (grows with its content; offers LaTeX completions). */
function TextDraft({
  draft,
  inputRef,
  onChange,
  onCommit,
}: {
  draft: BoardText;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onChange(text: string): void;
  onCommit(): void;
}) {
  const assist = useLatexAssist<HTMLTextAreaElement>(draft.text, onChange);
  return (
    <>
      <textarea
        className="wb-text-edit"
        autoFocus
        value={draft.text}
        placeholder="Type… ($x^2$ for formulas)"
        style={{
          transform: `translate(${draft.x}px, ${draft.y}px)`,
          width: draft.w,
          fontSize: draft.fontSize,
          color: inkVar(draft.color),
        }}
        ref={(el) => {
          inputRef.current = el;
          assist.ref.current = el;
          if (el) {
            el.style.height = '0px';
            el.style.height = `${el.scrollHeight + 2}px`;
          }
        }}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (assist.onKeyDown(e)) return;
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) onCommit();
        }}
      />
      {assist.popup}
    </>
  );
}

function boxStyle(b: Box): React.CSSProperties {
  return { left: b.x, top: b.y, width: b.w, height: b.h };
}

function SelBox({ box, k, accent }: { box: Box; k: number; accent?: boolean }) {
  const pad = 4 / k;
  return (
    <div
      className={`wb-sel ${accent ? 'accent' : ''}`}
      style={{ ...boxStyle({ x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 }), borderWidth: 1.5 / k, borderRadius: 6 / k }}
    />
  );
}

function Handle({ box, k }: { box: Box; k: number }) {
  const s = 10 / k;
  return <div className="wb-handle" style={{ left: box.x + box.w - s / 2, top: box.y + box.h - s / 2, width: s, height: s, borderWidth: 1.5 / k }} />;
}
