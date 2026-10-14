import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSizes } from '../../hooks/useSizes';
import { ancestors, buildTree, childrenOf, descendantIds, matchesQuery } from '../../lib/tree';
import { clamp } from '../../lib/util';
import { groupsOf, useNotebook } from '../../store/notebook';
import { gridSpacing, useSettings } from '../../store/settings';
import { useStudy } from '../../store/study';
import { useUi, type MenuItem } from '../../store/ui';
import { COLORS, type Card, type CardMap, type ColorKey } from '../../types';
import {
  addChild,
  addSibling,
  deleteWithUndoHint,
  groupMemberIds,
  groupSelection,
  locateCard,
  navigate,
  openCardMenu,
  openGroupMenu,
  renameGroup,
} from '../cardActions';
import { CardPreview } from '../CardPreview';
import { Icon } from '../Icon';
import { CardNode } from './CardNode';
import { edgePath, layoutTree, V_GAP, type NodeBox } from './layout';

type DropZone = 'child' | 'before' | 'after';

interface DragState {
  /** Top-level cards being moved; their subtrees follow. */
  ids: string[];
  /** Card under the pointer when the drag started ('' when dragging a group by its label). */
  primary: string;
  group?: string;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  active: boolean;
  /** Alt held: drop detaches the cards from their parents. */
  alt: boolean;
  target: { id: string; zone: DropZone } | null;
}

interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  base: string[];
}

type StatusKey = 'review' | 'due' | 'notes' | 'image' | 'free';

interface Filter {
  colors: ColorKey[];
  tags: string[];
  groups: string[];
  status: StatusKey[];
}

const NO_FILTER: Filter = { colors: [], tags: [], groups: [], status: [] };
const STATUS: { key: StatusKey; label: string }[] = [
  { key: 'review', label: 'In review' },
  { key: 'due', label: 'Due' },
  { key: 'notes', label: 'Has notes' },
  { key: 'image', label: 'Image excerpt' },
  { key: 'free', label: 'Placed freely' },
];

const filterActive = (f: Filter) => f.colors.length + f.tags.length + f.groups.length + f.status.length > 0;

function hasStatus(c: Card, s: StatusKey, now: number) {
  switch (s) {
    case 'review':
      return !!c.review;
    case 'due':
      return !!c.review && c.review.due <= now;
    case 'notes':
      return !!c.comment.trim();
    case 'image':
      return !!c.imageId;
    case 'free':
      return !!c.mapPos;
  }
}

/** A card matches when it satisfies every active section (any value within a section). */
function matchesFilter(c: Card, f: Filter, now: number) {
  if (f.colors.length && !f.colors.includes(c.color)) return false;
  if (f.tags.length && !c.tags.some((t) => f.tags.includes(t))) return false;
  if (f.groups.length && !(c.groupId && f.groups.includes(c.groupId))) return false;
  if (f.status.length && !f.status.some((s) => hasStatus(c, s, now))) return false;
  return true;
}

/** Drops cards whose ancestor is also in the list (moving the ancestor moves them anyway). */
function topLevel(ids: string[], cards: CardMap) {
  const set = new Set(ids);
  return ids.filter((id) => cards[id] && !ancestors(cards, id).some((a) => set.has(a)));
}

const MIN_K = 0.15;
const MAX_K = 2.5;
const FRAME_PAD = 12;

export function MindMap() {
  const cards = useNotebook((s) => s.nb!.cards);
  const groups = useNotebook((s) => groupsOf(s.nb));
  const selectedId = useNotebook((s) => s.selectedId);
  const selectedIds = useNotebook((s) => s.selectedIds);
  const editingId = useNotebook((s) => s.editingId);
  const reveal = useStudy((s) => s.reveal);
  const flash = useStudy((s) => s.flash);
  const studyLayout = useStudy((s) => s.layout);
  const enlarge = useStudy((s) => s.enlarge);
  const edgeStyle = useSettings((s) => s.edgeStyle);
  const mapDrag = useSettings((s) => s.mapDrag);
  const canvasBg = useSettings((s) => s.canvasBg);

  const tree = buildTree(cards);
  const [sizes, onReport] = useSizes();
  const layout = useMemo(() => layoutTree(tree, sizes), [tree, sizes]);
  const [view, setView] = useState({ x: 48, y: 48, k: 1 });
  const [animating, setAnimating] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [panning, setPanning] = useState(false);
  const [search, setSearch] = useState<string | null>(null);
  const [matchIdx, setMatchIdx] = useState(0);
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [filterOpen, setFilterOpen] = useState(false);
  /** Card shown enlarged (after a click). */
  const [preview, setPreview] = useState<string | null>(null);
  const [vpSize, setVpSize] = useState({ w: 0, h: 0 });

  const vpRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  /** Set after a right-button pan so the context menu that follows is skipped. */
  const suppressMenu = useRef(false);

  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVpSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The enlarged view closes when the selection moves on, editing starts or the card goes away.
  useEffect(() => {
    if (preview && (preview !== selectedId || editingId || !cards[preview])) setPreview(null);
  }, [preview, selectedId, editingId, cards]);

  // ---- view helpers ------------------------------------------------------------
  const animate = () => {
    setAnimating(true);
    setTimeout(() => setAnimating(false), 260);
  };

  const toCanvas = (clientX: number, clientY: number) => {
    const r = vpRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
  };

  const fit = useCallback((maxK = 1) => {
    const el = vpRef.current;
    const { bounds, nodes } = layoutRef.current;
    if (!el || !nodes.size) return;
    const bw = bounds.maxX - bounds.minX;
    const bh = bounds.maxY - bounds.minY;
    const k = clamp(Math.min((el.clientWidth - 80) / bw, (el.clientHeight - 80) / bh, maxK), MIN_K, MAX_K);
    setView({
      k,
      x: (el.clientWidth - bw * k) / 2 - bounds.minX * k,
      y: (el.clientHeight - bh * k) / 2 - bounds.minY * k,
    });
  }, []);

  const zoomAt = (k: number, cx?: number, cy?: number) => {
    const el = vpRef.current;
    if (!el) return;
    const v = viewRef.current;
    const nk = clamp(k, MIN_K, MAX_K);
    const px = cx ?? el.clientWidth / 2;
    const py = cy ?? el.clientHeight / 2;
    setView({ k: nk, x: px - ((px - v.x) * nk) / v.k, y: py - ((py - v.y) * nk) / v.k });
  };

  /** Pans just enough to bring a node into view (centres it if it is far away). */
  const ensureVisible = useCallback((box: NodeBox, center = false) => {
    const el = vpRef.current;
    if (!el) return;
    const v = viewRef.current;
    const sx = box.x * v.k + v.x;
    const sy = box.y * v.k + v.y;
    const sw = box.w * v.k;
    const sh = box.h * v.k;
    const m = 40;
    const W = el.clientWidth;
    const H = el.clientHeight;
    if (center) {
      animate();
      setView({ ...v, x: W / 2 - (box.x + box.w / 2) * v.k, y: H / 2 - (box.y + box.h / 2) * v.k });
      return;
    }
    // Minimal pan: keeps as much of the surrounding map in view as possible.
    let dx = 0;
    let dy = 0;
    if (sw > W - 2 * m || sx < m) dx = m - sx;
    else if (sx + sw > W - m) dx = W - m - (sx + sw);
    if (sh > H - 2 * m || sy < m) dy = m - sy;
    else if (sy + sh > H - m) dy = H - m - (sy + sh);
    if (!dx && !dy) return;
    animate();
    setView({ ...v, x: v.x + dx, y: v.y + dy });
  }, []);

  // Fit once on first layout with real sizes.
  const didFit = useRef(false);
  useLayoutEffect(() => {
    if (didFit.current || !layout.nodes.size) return;
    for (const id of layout.nodes.keys()) if (!sizes.has(id)) return;
    didFit.current = true;
    const el = vpRef.current;
    if (!el) return;
    const { bounds } = layout;
    if (bounds.maxX - bounds.minX < el.clientWidth - 96 && bounds.maxY - bounds.minY < el.clientHeight - 96) {
      setView({ k: 1, x: 48 - bounds.minX, y: (el.clientHeight - (bounds.maxY - bounds.minY)) / 2 - bounds.minY });
    } else {
      fit();
    }
  }, [layout, sizes, fit]);

  // Reveal requests (from the reader, keyboard navigation, new excerpts…).
  const pendingReveal = useRef<string | null>(null);
  useEffect(() => {
    if (!reveal) return;
    useNotebook.getState().expandTo(reveal.cardId);
    pendingReveal.current = reveal.cardId;
  }, [reveal]);
  useEffect(() => {
    const id = pendingReveal.current;
    if (!id) return;
    const box = layout.nodes.get(id);
    if (!box || !sizes.has(id)) return;
    pendingReveal.current = null;
    ensureVisible(box);
  }, [layout, sizes, ensureVisible]);

  // Keep keyboard focus on the map after inline editing ends.
  useEffect(() => {
    if (!editingId && (document.activeElement === document.body || !document.activeElement)) {
      vpRef.current?.focus({ preventScroll: true });
    }
  }, [editingId]);

  // ---- wheel: pan, Ctrl+wheel: zoom ------------------------------------------
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element).closest('.card-preview, .map-filter')) return; // let those scroll
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

  // ---- free placement ---------------------------------------------------------
  const sizesRef = useRef(sizes);
  sizesRef.current = sizes;

  /**
   * Moves cards (with their subtrees) by a canvas offset and pins them there. A child keeps
   * its parent (its position is stored relative to it); Alt detaches it as an independent card.
   */
  const placeFreely = (ids: string[], dx: number, dy: number, detach: boolean) => {
    const store = useNotebook.getState();
    const all = store.nb!.cards;
    const nodes = layoutRef.current.nodes;
    let rootOrder = Math.max(-1, ...buildTree(all).roots.map((c) => c.order));
    const moving = ids.filter((id) => all[id] && nodes.has(id));
    // Taking cards out of a stack re-centres their parents, so offsets are measured against
    // the layout as it will be once the cards are free.
    const patched = { ...all };
    for (const id of moving) patched[id] = { ...all[id], mapPos: { x: 0, y: 0 }, ...(detach ? { parentId: null } : {}) };
    const after = layoutTree(buildTree(patched), sizesRef.current).nodes;
    const patches: Record<string, Partial<Card>> = {};
    for (const id of moving) {
      const box = nodes.get(id)!;
      const card = all[id];
      const x = Math.round(box.x + dx);
      const y = Math.round(box.y + dy);
      const parent = !detach && card.parentId ? after.get(card.parentId) : undefined;
      const mapPos = parent ? { x: Math.round(x - parent.x), y: Math.round(y - parent.y) } : { x, y };
      patches[id] = detach && card.parentId ? { mapPos, parentId: null, order: ++rootOrder } : { mapPos };
    }
    store.updateCards(patches);
  };

  const tidyUp = (ids?: string[]) => {
    const store = useNotebook.getState();
    const all = store.nb!.cards;
    const targets = (ids ?? Object.keys(all)).filter((id) => all[id]?.mapPos);
    if (!targets.length) return;
    animate();
    store.updateCards(Object.fromEntries(targets.map((id) => [id, { mapPos: undefined }])));
  };

  /** Creates an independent card at a canvas point and starts editing it. */
  const newCardAt = (p: { x: number; y: number }) => {
    const store = useNotebook.getState();
    const id = store.addCard({ mapPos: { x: Math.round(p.x - 90), y: Math.round(p.y - 20) } }, { parentId: null });
    store.setEditing(id);
  };

  // ---- background: marquee / pan / deselect ------------------------------------
  const onBgPointerDown = (e: React.PointerEvent) => {
    if (e.button > 2) return;
    if ((e.target as Element).closest('.card-node, .map-hud, .map-search, .card-preview, .map-filter, .group-label')) return;
    vpRef.current?.focus({ preventScroll: true });
    setPreview(null);
    if (filterOpen) setFilterOpen(false);
    const pan = e.button === 1 || e.button === 2 || (e.button === 0 && mapDrag === 'pan' && !e.shiftKey);
    if (e.button === 1) e.preventDefault();

    if (pan) {
      const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      let moved = false;
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        if (!moved && Math.hypot(dx, dy) > 3) {
          moved = true;
          setPanning(true);
        }
        if (moved) setView((v) => ({ ...v, x: start.vx + dx, y: start.vy + dy }));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setPanning(false);
        if (e.button === 2 && moved) suppressMenu.current = true;
        if (!moved && e.button === 0) useNotebook.getState().select(null);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }

    // Selection box. Shift/Ctrl add to the current selection.
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const base = additive ? useNotebook.getState().selectedIds : [];
    let moved = false;
    const startX = e.clientX;
    const startY = e.clientY;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
      moved = true;
      setMarquee({ x0: startX, y0: startY, x1: ev.clientX, y1: ev.clientY, base });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setMarquee(null);
      const store = useNotebook.getState();
      if (!moved) {
        if (!additive) store.select(null);
        return;
      }
      const hits = marqueeHits({ x0: startX, y0: startY, x1: ev.clientX, y1: ev.clientY, base });
      store.setSelection([...base, ...hits.filter((id) => !base.includes(id))]);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Cards touched by the selection box. */
  const marqueeHits = (m: Marquee): string[] => {
    const a = toCanvas(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1));
    const b = toCanvas(Math.max(m.x0, m.x1), Math.max(m.y0, m.y1));
    const out: string[] = [];
    for (const n of layoutRef.current.nodes.values()) {
      if (n.x <= b.x && n.x + n.w >= a.x && n.y <= b.y && n.y + n.h >= a.y) out.push(n.id);
    }
    return out;
  };

  // ---- card / group drag & drop ---------------------------------------------------
  const dragRef = useRef<DragState | null>(null);

  const beginDrag = (e: React.PointerEvent, ids: string[], primary: string, group?: string, modifier = false) => {
    const state: DragState = { ids, primary, group, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, active: false, alt: false, target: null };
    dragRef.current = state;
    const cardsNow = useNotebook.getState().nb!.cards;
    const tr = buildTree(cardsNow);
    const excluded = new Set(ids.flatMap((id) => [id, ...descendantIds(tr, id)]));

    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      d.dx = ev.clientX - d.startX;
      d.dy = ev.clientY - d.startY;
      if (!d.active && Math.hypot(d.dx, d.dy) < 5) return;
      if (!d.active) setPreview(null);
      d.active = true;
      d.alt = ev.altKey;
      d.target = null;
      // Group frames only move; cards can also be dropped onto other cards.
      if (!d.group && !ev.altKey) {
        const { x: mx, y: my } = toCanvas(ev.clientX, ev.clientY);
        for (const n of layoutRef.current.nodes.values()) {
          if (excluded.has(n.id)) continue;
          if (mx >= n.x && mx <= n.x + n.w && my >= n.y - V_GAP / 2 && my <= n.y + n.h + V_GAP / 2) {
            const fy = (my - n.y) / n.h;
            d.target = { id: n.id, zone: fy < 0.25 ? 'before' : fy > 0.75 ? 'after' : 'child' };
            break;
          }
        }
      }
      setDrag({ ...d });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d) return;
      const store = useNotebook.getState();
      const all = store.nb!.cards;
      if (!d.active) {
        if (d.group) {
          store.setSelection(groupMemberIds(d.group));
          return;
        }
        if (modifier) {
          store.toggleSelected(primary);
          return;
        }
        // Plain click: select, follow the excerpt in the document, and show the card enlarged.
        store.select(primary);
        const card = all[primary];
        if (card?.source && useStudy.getState().layout !== 'map') locateCard(card, { silent: true });
        if (useStudy.getState().enlarge) setPreview(primary);
        return;
      }
      const t = d.target;
      const k = viewRef.current.k;
      if (!t) {
        placeFreely(d.ids, d.dx / k, d.dy / k, d.alt);
      } else if (t.zone === 'child') {
        store.moveCards(d.ids, t.id, childrenOf(buildTree(all), t.id).length);
      } else {
        const target = all[t.id];
        const sibs = childrenOf(buildTree(all), target.parentId);
        const idx = sibs.findIndex((c) => c.id === t.id);
        store.moveCards(d.ids, target.parentId, t.zone === 'before' ? idx : idx + 1);
      }
      if (!d.group && d.ids.length === 1) store.select(d.ids[0]);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onCardPointerDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const store = useNotebook.getState();
    if (store.editingId === id) return;
    vpRef.current?.focus({ preventScroll: true });
    if (filterOpen) setFilterOpen(false);
    const modifier = e.ctrlKey || e.metaKey || e.shiftKey;
    // Dragging one card of a multi-selection moves the whole selection.
    const sel = store.selectedIds;
    const ids = sel.length > 1 && sel.includes(id) ? topLevel(sel, store.nb!.cards) : [id];
    beginDrag(e, ids, id, undefined, modifier);
  };
  const cardDownRef = useRef(onCardPointerDown);
  cardDownRef.current = onCardPointerDown;
  const stableCardDown = useCallback((e: React.PointerEvent, id: string) => cardDownRef.current(e, id), []);

  const onGroupPointerDown = (e: React.PointerEvent, groupId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    vpRef.current?.focus({ preventScroll: true });
    const all = useNotebook.getState().nb!.cards;
    const members = groupMemberIds(groupId).filter((id) => layoutRef.current.nodes.has(id));
    beginDrag(e, topLevel(members, all), '', groupId);
  };

  // ---- keyboard -----------------------------------------------------------------
  const matches = useMemo(() => {
    if (!search?.trim()) return [] as string[];
    return Object.values(cards)
      .filter((c) => matchesQuery(c, search.trim()))
      .map((c) => c.id);
  }, [cards, search]);
  const matchSet = useMemo(() => new Set(matches), [matches]);

  const gotoMatch = (i: number) => {
    if (!matches.length) return;
    const idx = ((i % matches.length) + matches.length) % matches.length;
    setMatchIdx(idx);
    useNotebook.getState().select(matches[idx]);
    useStudy.getState().revealCard(matches[idx]);
  };

  const groupOrUngroup = (ungroup: boolean) => {
    const store = useNotebook.getState();
    const ids = store.selectedIds;
    if (!ids.length) return;
    if (ungroup) {
      const gids = new Set(ids.map((id) => cards[id]?.groupId).filter(Boolean) as string[]);
      for (const g of gids) store.ungroup(g);
    } else {
      void groupSelection(ids);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    const nb = useNotebook.getState();
    const sel = nb.selectedId;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'f') {
      e.preventDefault();
      setSearch((s) => s ?? '');
      return;
    }
    if (mod && key === 'a') {
      e.preventDefault();
      nb.setSelection([...layout.nodes.keys()], sel ?? undefined);
      return;
    }
    if (mod && key === 'g') {
      e.preventDefault();
      groupOrUngroup(e.shiftKey);
      return;
    }
    if (mod) return;
    switch (e.key) {
      case 'Tab':
        e.preventDefault();
        addChild(sel);
        break;
      case 'Enter':
        e.preventDefault();
        if (sel) addSibling(sel);
        else addChild(null);
        break;
      case 'F2':
        if (sel) nb.setEditing(sel);
        break;
      case 'Delete':
      case 'Backspace':
        if (nb.selectedIds.length) deleteWithUndoHint(nb.selectedIds);
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
        e.preventDefault();
        navigate(e.key.slice(5).toLowerCase() as 'left' | 'right' | 'up' | 'down');
        break;
      case ' ':
        if (sel && nb.nb?.cards[sel]?.source) {
          e.preventDefault();
          locateCard(nb.nb.cards[sel]);
        }
        break;
      case 'Escape':
        if (search !== null) setSearch(null);
        else if (filterOpen) setFilterOpen(false);
        else nb.select(null);
        break;
    }
  };

  // ---- context menus -------------------------------------------------------------
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (suppressMenu.current) {
      suppressMenu.current = false;
      return;
    }
    const target = e.target as Element;
    if (target.closest('.map-hud, .map-search, .map-filter, .card-preview')) return;
    const groupEl = target.closest<HTMLElement>('.group-label');
    if (groupEl?.dataset.group) {
      const gid = groupEl.dataset.group;
      const members = groupMemberIds(gid);
      openGroupMenu(e.clientX, e.clientY, gid, [
        { label: 'Return to automatic layout', disabled: !members.some((id) => cards[id]?.mapPos), onClick: () => tidyUp(members) },
      ]);
      return;
    }
    const el = target.closest<HTMLElement>('.card-node');
    const id = el?.dataset.card;
    if (id && cards[id]) {
      const store = useNotebook.getState();
      const multi = store.selectedIds.length > 1 && store.selectedIds.includes(id);
      const ids = multi ? store.selectedIds : [id];
      const card = cards[id];
      const extra: MenuItem[] = [];
      if (ids.some((x) => cards[x]?.mapPos)) extra.push({ label: 'Return to automatic layout', onClick: () => tidyUp(ids) });
      if (!multi && card.parentId)
        extra.push({ label: 'Detach as independent card', onClick: () => placeFreely([id], 0, 0, true) });
      openCardMenu(e.clientX, e.clientY, id, extra);
      return;
    }
    // Empty space.
    const p = toCanvas(e.clientX, e.clientY);
    const anyFree = Object.values(cards).some((c) => c.mapPos);
    useUi.getState().openMenu(e.clientX, e.clientY, [
      { label: 'New card here', shortcut: 'Double-click', onClick: () => newCardAt(p) },
      { separator: true },
      { label: 'Select all', shortcut: 'Ctrl+A', disabled: !layout.nodes.size, onClick: () => useNotebook.getState().setSelection([...layout.nodes.keys()]) },
      { label: 'Tidy up (automatic layout)', disabled: !anyFree, onClick: () => tidyUp() },
      { label: 'Fit to screen', onClick: () => fit(1.2) },
    ]);
  };

  // ---- render ---------------------------------------------------------------------
  const now = Date.now();
  const nodes = [...layout.nodes.values()];
  const moving = useMemo(() => {
    if (!drag?.active) return null;
    const s = new Set<string>();
    for (const id of drag.ids) {
      s.add(id);
      for (const d of descendantIds(tree, id)) s.add(d);
    }
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.active, drag?.ids, tree]);
  const ddx = drag?.active ? drag.dx / view.k : 0;
  const ddy = drag?.active ? drag.dy / view.k : 0;
  const disp = (n: NodeBox): NodeBox => (moving?.has(n.id) ? { ...n, x: n.x + ddx, y: n.y + ddy } : n);

  const dropTarget = drag?.active ? drag.target : null;
  const dropBox = dropTarget ? layout.nodes.get(dropTarget.id) : null;
  const gridSize = gridSpacing(view.k, canvasBg);
  const fActive = filterActive(filter);
  const liveHits = useMemo(() => (marquee ? new Set([...marquee.base, ...marqueeHits(marquee)]) : null), [marquee]); // eslint-disable-line react-hooks/exhaustive-deps
  const selSet = liveHits ?? new Set(selectedIds);

  const frames = groups
    .map((g) => {
      const members = nodes.filter((n) => cards[n.id]?.groupId === g.id).map(disp);
      if (!members.length) return null;
      const minX = Math.min(...members.map((n) => n.x)) - FRAME_PAD;
      const minY = Math.min(...members.map((n) => n.y)) - FRAME_PAD;
      const maxX = Math.max(...members.map((n) => n.x + n.w)) + FRAME_PAD;
      const maxY = Math.max(...members.map((n) => n.y + n.h)) + FRAME_PAD;
      return { g, x: minX, y: minY, w: maxX - minX, h: maxY - minY, count: members.length };
    })
    .filter(Boolean) as { g: (typeof groups)[number]; x: number; y: number; w: number; h: number; count: number }[];

  const allTags = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of Object.values(cards)) for (const t of c.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [cards]);
  const filterMatches = useMemo(
    () => (fActive ? Object.values(cards).filter((c) => matchesFilter(c, filter, now)).map((c) => c.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards, filter, fActive],
  );
  const filterSet = useMemo(() => new Set(filterMatches), [filterMatches]);
  const toggleIn = <K extends keyof Filter>(key: K, value: Filter[K][number]) =>
    setFilter((f) => {
      const list = f[key] as Filter[K][number][];
      return { ...f, [key]: list.includes(value) ? list.filter((x) => x !== value) : [...list, value] };
    });
  const anyFree = useMemo(() => Object.values(cards).some((c) => c.mapPos), [cards]);

  return (
    <div
      ref={vpRef}
      className={`mindmap ${panning ? 'panning' : ''} ${marquee ? 'selecting' : ''}`}
      tabIndex={0}
      onPointerDown={onBgPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={(e) => {
        if ((e.target as Element).closest('.card-node, .map-hud, .map-search, .card-preview, .map-filter, .group-label')) return;
        newCardAt(toCanvas(e.clientX, e.clientY));
      }}
      onContextMenu={onContextMenu}
      style={
        {
          '--grid': `${gridSize}px`,
          '--gx': `${view.x % gridSize}px`,
          '--gy': `${view.y % gridSize}px`,
        } as React.CSSProperties
      }
    >
      <div
        className="mm-canvas"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
          transition: animating ? 'transform 0.25s ease' : undefined,
        }}
      >
        {frames.map((f) => (
          <div
            key={f.g.id}
            className="group-frame"
            style={{ left: f.x, top: f.y, width: f.w, height: f.h, '--gc': `var(--c-${f.g.color})` } as React.CSSProperties}
          />
        ))}

        <svg className="mm-edges" width="1" height="1">
          {layout.edges.map((e) => {
            const toMoving = !!moving?.has(e.to.id);
            const fromMoving = !!moving?.has(e.from.id);
            const stretched = toMoving && !fromMoving;
            return (
              <path
                key={e.to.id}
                d={edgePath(disp(e.from), disp(e.to), edgeStyle)}
                stroke={`color-mix(in srgb, var(--c-${e.color}) 70%, var(--map-bg))`}
                strokeDasharray={stretched && !drag?.target && !drag?.alt ? '5 4' : undefined}
                opacity={stretched ? (drag?.target || drag?.alt ? 0.15 : 0.7) : 1}
              />
            );
          })}
        </svg>

        {frames.map((f) => (
          <div
            key={f.g.id}
            className="group-label"
            data-group={f.g.id}
            title="Click to select the group · drag to move it · double-click to rename"
            style={{ left: f.x, top: f.y, '--gc': `var(--c-${f.g.color})` } as React.CSSProperties}
            onPointerDown={(e) => onGroupPointerDown(e, f.g.id)}
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

        {nodes.map((n) => {
          const card = cards[n.id];
          const isMoving = !!moving?.has(n.id);
          const d = disp(n);
          return (
            <CardNode
              key={n.id}
              card={card}
              x={d.x}
              y={d.y}
              measured={sizes.has(n.id)}
              isRoot={card.parentId === null}
              childCount={(tree.children.get(n.id) ?? []).length}
              selected={selSet.has(n.id)}
              editing={editingId === n.id}
              dragging={isMoving}
              dropChild={dropTarget?.id === n.id && dropTarget.zone === 'child'}
              searchState={
                search?.trim() ? (matchSet.has(n.id) ? 'match' : 'dim') : fActive ? (filterSet.has(n.id) ? null : 'dim') : null
              }
              flashNonce={flash?.cardId === n.id ? flash.nonce : 0}
              onPointerDown={stableCardDown}
              onReport={onReport}
            />
          );
        })}

        {dropBox && dropTarget && dropTarget.zone !== 'child' && (
          <div
            className="drop-line"
            style={{
              left: dropBox.x,
              width: dropBox.w,
              top: dropTarget.zone === 'before' ? dropBox.y - V_GAP / 2 - 1.5 : dropBox.y + dropBox.h + V_GAP / 2 - 1.5,
            }}
          />
        )}
      </div>

      {marquee && (
        <div
          className="mm-marquee"
          style={(() => {
            const r = vpRef.current!.getBoundingClientRect();
            return {
              left: Math.min(marquee.x0, marquee.x1) - r.left,
              top: Math.min(marquee.y0, marquee.y1) - r.top,
              width: Math.abs(marquee.x1 - marquee.x0),
              height: Math.abs(marquee.y1 - marquee.y0),
            };
          })()}
        />
      )}

      {!nodes.length && (
        <div className="empty" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <div>
            <Icon name="mindmap" size={44} />
            <h3>Your mind map is empty</h3>
            <p>
              Select text in the document and pick a color to excerpt it as a card.
              <br />
              Double-click anywhere to place a card there, or press <span className="kbd">Tab</span>.
            </p>
          </div>
        </div>
      )}

      {search !== null && (
        <div className="map-search" onPointerDown={(e) => e.stopPropagation()}>
          <Icon name="search" size={15} className="muted" />
          <input
            autoFocus
            placeholder="Find cards…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setMatchIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') gotoMatch(e.shiftKey ? matchIdx - 1 : matchIdx + (matches[matchIdx] === selectedId ? 1 : 0));
              if (e.key === 'Escape') {
                setSearch(null);
                vpRef.current?.focus();
              }
            }}
          />
          <span className="muted" style={{ fontSize: 12, minWidth: 44, textAlign: 'right' }}>
            {search.trim() ? `${matches.length ? matchIdx + 1 : 0}/${matches.length}` : ''}
          </span>
          {search.trim() && matches.length > 1 && (
            <button className="btn" style={{ height: 26 }} title="Select every match" onClick={() => useNotebook.getState().setSelection(matches)}>
              Select all
            </button>
          )}
          <button className="btn icon" onClick={() => setSearch(null)} title="Close">
            <Icon name="x" size={15} />
          </button>
        </div>
      )}

      {filterOpen && (
        <div className="map-filter" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <div className="map-filter-head">
            <strong>Filter cards</strong>
            <span className="muted">{fActive ? `${filterMatches.length} match` : 'Show cards by classification'}</span>
          </div>
          <div className="filter-section">
            <div className="filter-label">Color</div>
            <div className="swatches">
              {COLORS.map((c) => (
                <button
                  key={c}
                  className={`swatch ${filter.colors.includes(c) ? 'on' : ''}`}
                  style={{ '--sw': `var(--c-${c})` } as React.CSSProperties}
                  title={c}
                  onClick={() => toggleIn('colors', c)}
                />
              ))}
            </div>
          </div>
          {groups.length > 0 && (
            <div className="filter-section">
              <div className="filter-label">Group</div>
              <div className="chips">
                {groups.map((g) => (
                  <button
                    key={g.id}
                    className={`chip ${filter.groups.includes(g.id) ? 'on' : ''}`}
                    style={{ '--cc': `var(--c-${g.color})` } as React.CSSProperties}
                    onClick={() => toggleIn('groups', g.id)}
                  >
                    <span className="ol-dot" style={{ marginTop: 0 }} />
                    {g.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="filter-section">
            <div className="filter-label">Tag</div>
            {allTags.length ? (
              <div className="chips">
                {allTags.map(([t, n]) => (
                  <button key={t} className={`chip ${filter.tags.includes(t) ? 'on' : ''}`} onClick={() => toggleIn('tags', t)}>
                    #{t} <span className="muted">{n}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 12 }}>
                No tags yet — add them in the card panel.
              </div>
            )}
          </div>
          <div className="filter-section">
            <div className="filter-label">Status</div>
            <div className="chips">
              {STATUS.map((s) => (
                <button key={s.key} className={`chip ${filter.status.includes(s.key) ? 'on' : ''}`} onClick={() => toggleIn('status', s.key)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="map-filter-foot">
            <button className="btn" disabled={!fActive} onClick={() => setFilter(NO_FILTER)}>
              Clear
            </button>
            <div style={{ flex: 1 }} />
            <button
              className="btn primary"
              disabled={!filterMatches.length}
              onClick={() => {
                useNotebook.getState().setSelection(filterMatches);
                setFilterOpen(false);
              }}
            >
              Select {filterMatches.length || ''} matching
            </button>
          </div>
        </div>
      )}

      <div className="map-hint" style={vpSize.w && vpSize.w < 1000 ? { display: 'none' } : undefined}>
        {studyLayout !== 'map' && <span>Click a card to jump to its excerpt</span>}
        <span>
          {mapDrag === 'select' ? 'Drag empty space to select · right-drag to pan' : 'Drag to pan · Shift+drag to select'} · drag cards anywhere
        </span>
      </div>

      {preview && cards[preview] && layout.nodes.get(preview) && (
        <CardPreview
          card={cards[preview]}
          anchor={{
            left: layout.nodes.get(preview)!.x * view.k + view.x,
            top: layout.nodes.get(preview)!.y * view.k + view.y,
            width: layout.nodes.get(preview)!.w * view.k,
          }}
          bounds={{ w: vpSize.w || vpRef.current?.clientWidth || 600, h: vpSize.h || vpRef.current?.clientHeight || 600 }}
          onClose={() => setPreview(null)}
        />
      )}

      <div className="map-hud" onPointerDown={(e) => e.stopPropagation()}>
        {selectedIds.length > 1 && (
          <>
            <span className="hud-count" title="Selected cards">
              {selectedIds.length} selected
            </span>
            <button className="btn icon" title="Group selected cards (Ctrl+G)" onClick={() => groupOrUngroup(false)}>
              <Icon name="group" />
            </button>
            <div className="divider-v" />
          </>
        )}
        <button
          className={`btn icon ${enlarge ? 'on' : ''}`}
          title={`Enlarge cards on click: ${enlarge ? 'on' : 'off'}`}
          onClick={() => {
            useStudy.getState().set({ enlarge: !enlarge });
            if (enlarge) setPreview(null);
          }}
        >
          <Icon name="enlarge" />
        </button>
        <button className="btn icon" title="Find cards (Ctrl+F)" onClick={() => setSearch((s) => (s === null ? '' : null))}>
          <Icon name="search" />
        </button>
        <button
          className={`btn icon ${filterOpen || fActive ? 'on' : ''}`}
          title="Filter by color, tag, group or status"
          onClick={() => setFilterOpen(!filterOpen)}
        >
          <Icon name="filter" />
        </button>
        <button className="btn icon" title="Collapse all" onClick={() => useNotebook.getState().setCollapsedAll(true)}>
          <Icon name="collapse" />
        </button>
        <button className="btn icon" title="Expand all" onClick={() => useNotebook.getState().setCollapsedAll(false)}>
          <Icon name="expand" />
        </button>
        <button className="btn icon" title="Tidy up — return freely placed cards to the automatic layout" disabled={!anyFree} onClick={() => tidyUp()}>
          <Icon name="tidy" />
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
        <button
          className="btn icon"
          title="Fit to screen"
          onClick={() => {
            animate();
            fit(1.2);
          }}
        >
          <Icon name="fit" />
        </button>
      </div>
    </div>
  );
}
