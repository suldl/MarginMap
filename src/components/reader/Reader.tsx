import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { backend } from '../../backend';
import { canvasToBlob, loadPdf, type PDFDocumentProxy } from '../../lib/pdf';
import { clamp, debounce, uid } from '../../lib/util';
import { useLibrary } from '../../store/library';
import { useNotebook } from '../../store/notebook';
import { loadReadingPos, saveReadingPos, useStudy } from '../../store/study';
import { useUi } from '../../store/ui';
import { COLORS, type ColorKey, type PageRect } from '../../types';
import { Icon } from '../Icon';
import { defaultSpot, isWhiteboardActive } from '../whiteboard/boardActions';
import { PageView, type PageHighlight } from './PageView';
import { ReaderSidebar } from './ReaderSidebar';
import { hitTest, readSelection, textInArea, type SelectionInfo } from './selection';

const PAD_TOP = 16;
const GAP = 14;
const PAD_BOTTOM = 48;
const SIDE_PAD = 24;
const SCROLLBAR = 12;
const MIN_SCALE = 0.25;
const MAX_SCALE = 5;

interface PageSize {
  w: number;
  h: number;
}

/**
 * The last jump request a reader acted on. Shared by all reader instances so that a reader
 * mounted later (e.g. after switching layouts) does not replay an old jump.
 */
const handledJump = { nonce: 0 };

/** Index of the last page whose top is at or above y. */
function pageAt(tops: number[], y: number) {
  let lo = 0;
  let hi = tops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function Reader({ notebookId }: { notebookId: string }) {
  const docId = useStudy((s) => s.activeDocId);
  const doc = useLibrary((s) => s.docs.find((d) => d.id === docId));
  if (!docId || !doc) {
    return (
      <div className="empty" style={{ flex: 1 }}>
        <div>
          <Icon name="file" size={40} />
          <h3>No document open</h3>
          <p>Add a document to this notebook with the + button in the top bar.</p>
        </div>
      </div>
    );
  }
  return <DocReader key={docId} notebookId={notebookId} docId={docId} />;
}

function DocReader({ notebookId, docId }: { notebookId: string; docId: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  /** Fit-width mode: re-fit whenever the reader is resized (sidebar, splitter, window). */
  const [autoFit, setAutoFit] = useState(false);
  const [page, setPage] = useState(1);
  const [range, setRange] = useState<[number, number]>([0, 2]);
  const [selBar, setSelBar] = useState<SelectionInfo | null>(null);
  const [hlBar, setHlBar] = useState<{ cardId: string; x: number; y: number } | null>(null);
  const [query, setQuery] = useState('');
  const [pageInput, setPageInput] = useState('1');
  /** The pointer tool is dragging the page. */
  const [grabbing, setGrabbing] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<{ i: number; frac: number; offsetY: number; xFrac: number } | null>(null);

  const tool = useStudy((s) => s.tool);
  const color = useStudy((s) => s.color);
  const sidebar = useStudy((s) => s.sidebar);
  const flash = useStudy((s) => s.flash);
  const jump = useStudy((s) => s.jump);
  const setStudy = useStudy((s) => s.set);
  const cards = useNotebook((s) => s.nb?.cards);
  const selectedId = useNotebook((s) => s.selectedId);

  // ---- load document ------------------------------------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const doc = await loadPdf(docId);
        const first = (await doc.getPage(1)).getViewport({ scale: 1 });
        if (!alive) return;
        const initial = Array.from({ length: doc.numPages }, () => ({ w: first.width, h: first.height }));
        const pos = loadReadingPos(notebookId, docId);
        const el = scrollRef.current;
        const fit = el ? (el.clientWidth - SIDE_PAD * 2 - SCROLLBAR) / first.width : 1;
        const j = useStudy.getState().jump;
        const startPage = j && j.docId === docId && j.nonce !== handledJump.nonce ? j.page : pos.page;
        pendingScroll.current = { i: clamp(startPage - 1, 0, doc.numPages - 1), frac: 0, offsetY: 8, xFrac: 0.5 };
        setScale(pos.scale ?? clamp(fit, MIN_SCALE, MAX_SCALE));
        setAutoFit(pos.scale === null);
        setSizes(initial);
        setPdf(doc);
        // Real page sizes (most documents are uniform, so this rarely changes anything).
        const all = await Promise.all(
          Array.from({ length: doc.numPages }, (_, i) =>
            doc.getPage(i + 1).then((p) => {
              const v = p.getViewport({ scale: 1 });
              return { w: v.width, h: v.height };
            }),
          ),
        );
        if (alive && all.some((s, i) => s.w !== initial[i].w || s.h !== initial[i].h)) setSizes(all);
      } catch (err) {
        console.error(err);
        if (alive) setError((err as Error).message || 'Could not open this document');
      }
    })();
    return () => {
      alive = false;
    };
  }, [docId, notebookId]);

  const layout = useMemo(() => {
    if (!sizes) return null;
    const tops: number[] = [];
    let y = PAD_TOP;
    let maxW = 0;
    for (const s of sizes) {
      tops.push(y);
      y += s.h * scale + GAP;
      maxW = Math.max(maxW, s.w * scale);
    }
    return { tops, total: y - GAP + PAD_BOTTOM, maxW };
  }, [sizes, scale]);

  // ---- viewport tracking --------------------------------------------------
  const savePos = useMemo(() => debounce((p: number, s: number | null) => saveReadingPos(notebookId, docId, p, s), 500), [notebookId, docId]);
  useEffect(() => () => savePos.flush(), [savePos]);

  const updateView = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !layout) return;
    const top = el.scrollTop;
    const h = el.clientHeight;
    const first = pageAt(layout.tops, top - h * 0.75);
    const last = pageAt(layout.tops, top + h * 1.75);
    setRange((r) => (r[0] === first && r[1] === last ? r : [first, last]));
    // At the very bottom the last page may never reach the reading line; count it as current.
    const atEnd = top + h >= el.scrollHeight - 4 && top > 0;
    const cur = atEnd ? layout.tops.length : pageAt(layout.tops, top + h * 0.3) + 1;
    setPage(cur);
    setPageInput(String(cur));
  }, [layout]);

  useEffect(() => {
    if (sizes) savePos(page, autoFit ? null : scale);
  }, [page, scale, autoFit, sizes, savePos]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const p = pendingScroll.current;
    if (el && p && layout && sizes) {
      pendingScroll.current = null;
      el.scrollTop = layout.tops[p.i] + p.frac * sizes[p.i].h * scale - p.offsetY;
      el.scrollLeft = p.xFrac * el.scrollWidth - el.clientWidth / 2;
    }
    updateView();
  }, [layout, sizes, scale, updateView]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(() => {
      updateView();
      if (fitRef.current.auto && Math.abs(el.clientWidth - lastWidth) > 1) fitRef.current.fit();
      lastWidth = el.clientWidth;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateView]);

  const rafRef = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(updateView);
  };

  // ---- zoom ---------------------------------------------------------------
  const zoomTo = useCallback(
    (next: number, anchorClientY?: number, keepFit = false) => {
      if (!keepFit) setAutoFit(false);
      next = clamp(Math.round(next * 1000) / 1000, MIN_SCALE, MAX_SCALE);
      const el = scrollRef.current;
      if (el && layout && sizes) {
        const offsetY = anchorClientY !== undefined ? anchorClientY - el.getBoundingClientRect().top : el.clientHeight * 0.3;
        const y = el.scrollTop + offsetY;
        const i = pageAt(layout.tops, y);
        const frac = (y - layout.tops[i]) / (sizes[i].h * scale);
        const xFrac = (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth;
        pendingScroll.current = { i, frac, offsetY, xFrac };
      }
      setScale(next);
    },
    [layout, sizes, scale],
  );

  const fitWidth = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !sizes) return;
    setAutoFit(true);
    zoomTo((el.clientWidth - SIDE_PAD * 2 - SCROLLBAR) / Math.max(...sizes.map((s) => s.w)), undefined, true);
  }, [sizes, zoomTo]);

  const fitRef = useRef<{ auto: boolean; fit: () => void }>({ auto: false, fit: () => {} });
  fitRef.current = { auto: autoFit, fit: fitWidth };

  const fitPage = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !sizes) return;
    const s = sizes[page - 1] ?? sizes[0];
    zoomTo(Math.min((el.clientWidth - SIDE_PAD * 2) / s.w, (el.clientHeight - PAD_TOP * 2) / s.h));
  }, [sizes, page, zoomTo]);

  const zoomRef = useRef(zoomTo);
  zoomRef.current = zoomTo;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0025);
      zoomRef.current(scaleRef.current * factor, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ---- navigation -----------------------------------------------------------
  const goToPage = useCallback(
    (n: number, y = 0, smooth = false) => {
      const el = scrollRef.current;
      if (!el || !layout || !sizes) return;
      const i = clamp(n - 1, 0, sizes.length - 1);
      const target = layout.tops[i] + y * sizes[i].h * scale - (y ? el.clientHeight * 0.3 : 8);
      const far = Math.abs(target - el.scrollTop) > el.clientHeight * 3;
      el.scrollTo({ top: target, behavior: smooth && !far ? 'smooth' : 'auto' });
    },
    [layout, sizes, scale],
  );

  useEffect(() => {
    if (!jump || jump.docId !== docId || !layout || jump.nonce === handledJump.nonce) return;
    handledJump.nonce = jump.nonce;
    goToPage(jump.page, jump.y, true);
  }, [jump, docId, layout, goToPage]);

  // ---- highlights ----------------------------------------------------------
  const highlightsByPage = useMemo(() => {
    const m = new Map<number, PageHighlight[]>();
    for (const c of Object.values(cards ?? {})) {
      if (c.source?.docId !== docId) continue;
      const per = new Map<number, PageRect[]>();
      for (const r of c.source.rects) {
        let arr = per.get(r.page);
        if (!arr) per.set(r.page, (arr = []));
        arr.push(r);
      }
      for (const [pg, rects] of per) {
        let arr = m.get(pg);
        if (!arr) m.set(pg, (arr = []));
        arr.push({ cardId: c.id, color: c.color, kind: c.source.kind, rects });
      }
    }
    return m;
  }, [cards, docId]);

  // ---- text selection → excerpt ---------------------------------------------
  useEffect(() => {
    const reset = () => pagesRef.current?.querySelectorAll('.textLayer.selecting').forEach((el) => el.classList.remove('selecting'));
    window.addEventListener('pointerup', reset);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('pointerup', reset);
      window.removeEventListener('blur', reset);
    };
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('.float-toolbar')) return;
    setSelBar(null);
    setHlBar(null);
  };

  // ---- pointer tool: drag the page around --------------------------------------
  /** Set when the last pointer press dragged the page, so its release is not a click. */
  const dragged = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    dragged.current = false;
    const el = scrollRef.current;
    if (tool !== 'pointer' || e.button !== 0 || !el || (e.target as Element).closest('.float-toolbar')) return;
    const start = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!dragged.current && Math.hypot(dx, dy) < 4) return;
      if (!dragged.current) {
        dragged.current = true;
        setGrabbing(true);
      }
      el.scrollLeft = start.left - dx;
      el.scrollTop = start.top - dy;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setGrabbing(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const onMouseUp = (e: React.MouseEvent) => {
    if (tool === 'area' || e.button !== 0 || dragged.current) return;
    const target = e.target as Element;
    if (target.closest('.float-toolbar')) return;
    const { clientX, clientY } = e;
    setTimeout(() => {
      const pagesEl = pagesRef.current;
      if (!pagesEl) return;
      const info = tool === 'text' ? readSelection(pagesEl) : null;
      if (info) {
        setSelBar(info);
        return;
      }
      const pageEl = target.closest<HTMLElement>('.pdf-page');
      if (!pageEl) return;
      const r = pageEl.getBoundingClientRect();
      const hit = hitTest(highlightsByPage.get(Number(pageEl.dataset.page)) ?? [], (clientX - r.left) / r.width, (clientY - r.top) / r.height);
      if (hit) {
        useNotebook.getState().select(hit);
        useStudy.getState().revealCard(hit);
        const base = pagesEl.getBoundingClientRect();
        setHlBar({ cardId: hit, x: clientX - base.left, y: clientY - base.top + 14 });
      }
    }, 0);
  };

  const excerpt = (c: ColorKey) => {
    if (!selBar) return;
    const nb = useNotebook.getState();
    const id = nb.addCard(
      { excerpt: selBar.text, color: c, source: { docId, page: selBar.page, kind: 'text', rects: selBar.rects } },
      { parentId: nb.selectedId },
      // While the whiteboard is showing, new excerpts land on it too.
      { select: false, boardAt: isWhiteboardActive() ? defaultSpot() : undefined },
    );
    setStudy({ color: c });
    useStudy.getState().flashCard(id);
    window.getSelection()?.removeAllRanges();
    setSelBar(null);
  };

  const onArea = useCallback(
    async (pageNum: number, rect: { x: number; y: number; w: number; h: number }, pageEl: HTMLElement) => {
      if (!pdf) return;
      try {
        const pg = await pdf.getPage(pageNum);
        const base = pg.getViewport({ scale: 1 });
        const s = clamp(900 / (rect.w * base.width), 1.5, 4);
        const viewport = pg.getViewport({ scale: s, offsetX: -rect.x * base.width * s, offsetY: -rect.y * base.height * s });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(rect.w * base.width * s));
        canvas.height = Math.max(1, Math.round(rect.h * base.height * s));
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await pg.render({ canvas, canvasContext: ctx, viewport }).promise;
        const imageId = uid();
        await backend.putAsset(imageId, await canvasToBlob(canvas));
        const nb = useNotebook.getState();
        const id = nb.addCard(
          {
            imageId,
            imageText: textInArea(pageEl, rect),
            color: useStudy.getState().color,
            source: { docId, page: pageNum, kind: 'area', rects: [{ page: pageNum, ...rect }] },
          },
          { parentId: nb.selectedId },
          { select: false, boardAt: isWhiteboardActive() ? defaultSpot() : undefined },
        );
        useStudy.getState().flashCard(id);
      } catch (err) {
        console.error(err);
        useUi.getState().toast('Could not capture that area', 'error');
      }
    },
    [pdf, docId],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      zoomTo(scale * 1.2);
    } else if (mod && e.key === '-') {
      e.preventDefault();
      zoomTo(scale / 1.2);
    } else if (mod && e.key === '0') {
      e.preventDefault();
      fitWidth();
    } else if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      setStudy({ sidebar: 'search' });
    } else if (e.key === 'Escape') {
      setSelBar(null);
      setHlBar(null);
      if (tool === 'area') setStudy({ tool: 'text' });
    }
  };

  const zoomMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    useUi.getState().openMenu(r.left, r.bottom + 4, [
      { label: 'Fit width', shortcut: 'Ctrl+0', onClick: fitWidth },
      { label: 'Fit page', onClick: fitPage },
      { separator: true },
      ...[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((z) => ({ label: `${z * 100}%`, onClick: () => zoomTo(z) })),
    ]);
  };

  const hlCard = hlBar && cards?.[hlBar.cardId];
  /** Keeps a centred floating toolbar of the given width inside the visible scroll area. */
  const clampX = (x: number, width: number) => {
    const el = scrollRef.current;
    if (!el) return x;
    const min = el.scrollLeft + width / 2 + 8;
    const max = el.scrollLeft + el.clientWidth - width / 2 - 8;
    return Math.max(min, Math.min(max, x));
  };
  const numPages = sizes?.length ?? 0;

  return (
    <div className="pane" style={{ flex: 1 }} onKeyDown={onKeyDown}>
      <div className="toolbar reader-toolbar">
        <button
          className={`btn icon ${sidebar === 'toc' ? 'on' : ''}`}
          title="Table of contents"
          onClick={() => setStudy({ sidebar: sidebar === 'toc' ? 'none' : 'toc' })}
        >
          <Icon name="toc" />
        </button>
        <button
          className={`btn icon ${sidebar === 'search' ? 'on' : ''}`}
          title="Search document (Ctrl+F)"
          onClick={() => setStudy({ sidebar: sidebar === 'search' ? 'none' : 'search' })}
        >
          <Icon name="search" />
        </button>
        <div className="divider-v" />
        <div className="seg">
          <button
            className={`btn icon ${tool === 'pointer' ? 'on' : ''}`}
            title="Pointer — click highlights to select their cards, drag to move the page"
            onClick={() => setStudy({ tool: 'pointer' })}
          >
            <Icon name="cursor" />
          </button>
          <button className={`btn icon ${tool === 'text' ? 'on' : ''}`} title="Select text to excerpt" onClick={() => setStudy({ tool: 'text' })}>
            <Icon name="text" />
          </button>
          <button className={`btn icon ${tool === 'area' ? 'on' : ''}`} title="Area excerpt — drag a box over figures, formulas, tables" onClick={() => setStudy({ tool: 'area' })}>
            <Icon name="area" />
          </button>
        </div>
        <div className="swatches" style={{ marginLeft: 8 }} title="Excerpt color">
          {COLORS.map((c) => (
            <button
              key={c}
              className={`swatch ${color === c ? 'on' : ''}`}
              style={{ '--sw': `var(--c-${c})`, width: 14, height: 14 } as React.CSSProperties}
              onClick={() => setStudy({ color: c })}
              title={c}
            />
          ))}
        </div>
        <div className="grow" />
        <div className="page-indicator">
          <input
            className="input"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const n = parseInt(pageInput, 10);
                if (n >= 1) goToPage(n);
                (e.target as HTMLInputElement).blur();
              }
            }}
            onBlur={() => setPageInput(String(page))}
          />
          <span>/ {numPages}</span>
        </div>
        <div className="divider-v" />
        <button className="btn icon" title="Zoom out (Ctrl+-)" onClick={() => zoomTo(scale / 1.2)}>
          <Icon name="zoomOut" />
        </button>
        <span className="zoom-label" onClick={zoomMenu} title="Zoom presets">
          {Math.round(scale * 100)}%
        </span>
        <button className="btn icon" title="Zoom in (Ctrl+=)" onClick={() => zoomTo(scale * 1.2)}>
          <Icon name="zoomIn" />
        </button>
        <button className={`btn icon ${autoFit ? 'on' : ''}`} title="Fit width (Ctrl+0)" onClick={fitWidth}>
          <Icon name="fitWidth" />
        </button>
      </div>

      <div className="reader-body">
        {pdf && <ReaderSidebar pdf={pdf} query={query} setQuery={setQuery} onGo={(p) => goToPage(p)} />}
        <div
          ref={scrollRef}
          className={`reader-scroll ${tool === 'area' ? 'area-mode' : tool === 'pointer' ? 'pointer-mode' : ''} ${grabbing ? 'grabbing' : ''}`}
          tabIndex={0}
          onScroll={onScroll}
          onPointerDown={onPointerDown}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
        >
          {error ? (
            <div className="empty">
              <div>
                <h3>Could not open this document</h3>
                <p>{error}</p>
              </div>
            </div>
          ) : !pdf || !layout || !sizes ? (
            <div className="loading" style={{ height: '100%' }}>
              <div className="spinner" />
            </div>
          ) : (
            <div ref={pagesRef} className="reader-pages" style={{ height: layout.total, width: `max(100%, ${layout.maxW + SIDE_PAD * 2}px)` }}>
              {sizes.map((s, i) => (
                <PageView
                  key={i}
                  pdf={pdf}
                  pageNum={i + 1}
                  top={layout.tops[i]}
                  width={s.w * scale}
                  height={s.h * scale}
                  scale={scale}
                  active={i >= range[0] && i <= range[1]}
                  highlights={highlightsByPage.get(i + 1)}
                  selectedCardId={selectedId}
                  flash={flash}
                  searchQuery={sidebar === 'search' ? query : ''}
                  areaMode={tool === 'area'}
                  onArea={onArea}
                />
              ))}

              {selBar && (
                <div className="float-toolbar" style={{ left: clampX(selBar.anchor.x, 380), top: selBar.anchor.y }} onMouseDown={(e) => e.preventDefault()}>
                  <span className="muted" style={{ fontSize: 12, padding: '0 4px' }}>
                    Excerpt
                  </span>
                  <div className="swatches">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        className={`swatch ${color === c ? 'on' : ''}`}
                        style={{ '--sw': `var(--c-${c})` } as React.CSSProperties}
                        title={`Excerpt as ${c} card`}
                        onClick={() => excerpt(c)}
                      />
                    ))}
                  </div>
                  <div className="divider-v" />
                  <button
                    className="btn"
                    onClick={() => {
                      void navigator.clipboard.writeText(selBar.text);
                      setSelBar(null);
                    }}
                  >
                    <Icon name="copy" size={15} /> Copy
                  </button>
                </div>
              )}

              {hlBar && hlCard && (
                <div className="float-toolbar" style={{ left: clampX(hlBar.x, 420), top: hlBar.y }} onMouseDown={(e) => e.preventDefault()}>
                  <div className="swatches">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        className={`swatch ${hlCard.color === c ? 'on' : ''}`}
                        style={{ '--sw': `var(--c-${c})` } as React.CSSProperties}
                        onClick={() => useNotebook.getState().updateCard(hlCard.id, { color: c })}
                      />
                    ))}
                  </div>
                  <div className="divider-v" />
                  <button
                    className="btn"
                    onClick={() => {
                      const study = useStudy.getState();
                      if (!study.panes.map && !study.panes.board) study.showPane('map', true);
                      study.flashCard(hlCard.id);
                    }}
                  >
                    <Icon name="mindmap" size={15} /> Card
                  </button>
                  <button
                    className="btn danger"
                    onClick={() => {
                      useNotebook.getState().deleteCards([hlCard.id]);
                      setHlBar(null);
                    }}
                  >
                    <Icon name="trash" size={15} /> Delete
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
