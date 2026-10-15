import { memo, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from 'react';
import { pdfjs, type PDFDocumentProxy, type RenderTask } from '../../lib/pdf';
import type { ColorKey, PageRect } from '../../types';

export interface PageHighlight {
  cardId: string;
  color: ColorKey;
  kind: 'text' | 'area';
  rects: PageRect[];
}

interface Props {
  pdf: PDFDocumentProxy;
  pageNum: number;
  top: number;
  width: number;
  height: number;
  scale: number;
  active: boolean;
  highlights: PageHighlight[] | undefined;
  selectedCardId: string | null;
  flash: { cardId: string; nonce: number } | null;
  searchQuery: string;
  areaMode: boolean;
  /** `asAnswer`: Alt was held — the picture becomes an answer of the selected card. */
  onArea(pageNum: number, rect: { x: number; y: number; w: number; h: number }, pageEl: HTMLElement, asAnswer: boolean): void;
}

const MAX_CANVAS_PIXELS = 16_000_000;

export const PageView = memo(function PageView(p: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasHolder = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [textVersion, setTextVersion] = useState(0);
  const [rendered, setRendered] = useState(false);

  // Canvas + text layer rendering for pages near the viewport.
  useEffect(() => {
    const holder = canvasHolder.current;
    const textDiv = textRef.current;
    if (!holder || !textDiv) return;
    if (!p.active) {
      holder.replaceChildren();
      textDiv.replaceChildren();
      setRendered(false);
      return;
    }
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let textLayer: pdfjs.TextLayer | null = null;
    (async () => {
      const page = await p.pdf.getPage(p.pageNum);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: p.scale });
      const dpr = window.devicePixelRatio || 1;
      const outputScale = Math.min(dpr, Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)));
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      renderTask = page.render({
        canvas,
        canvasContext: canvas.getContext('2d')!,
        viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
      });
      try {
        await renderTask.promise;
      } catch (err) {
        if ((err as Error)?.name !== 'RenderingCancelledException') console.error(err);
        return;
      }
      if (cancelled) return;
      // Swap in the finished canvas so zooming never flashes a blank page.
      holder.replaceChildren(canvas);
      setRendered(true);

      textLayer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
        container: textDiv,
        viewport,
      });
      textDiv.replaceChildren();
      try {
        await textLayer.render();
      } catch {
        return;
      }
      if (cancelled) return;
      const end = document.createElement('div');
      end.className = 'endOfContent';
      textDiv.append(end);
      setTextVersion((v) => v + 1);
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [p.pdf, p.pageNum, p.scale, p.active]);

  // Mark text-layer spans that match the document search.
  useEffect(() => {
    const div = textRef.current;
    if (!div) return;
    const q = p.searchQuery.trim().toLowerCase();
    for (const span of div.querySelectorAll('span')) {
      span.classList.toggle('search-hit', !!q && !!span.textContent && span.textContent.toLowerCase().includes(q));
    }
  }, [p.searchQuery, textVersion]);

  return (
    <div
      ref={rootRef}
      className="pdf-page"
      data-page={p.pageNum}
      style={
        {
          position: 'absolute',
          top: p.top,
          left: '50%',
          marginLeft: -p.width / 2,
          width: p.width,
          height: p.height,
          '--scale-factor': p.scale,
        } as CSSProperties
      }
    >
      <div ref={canvasHolder} />
      {!rendered && <div className="page-num">{p.pageNum}</div>}
      <div className="hl-layer">
        {p.highlights?.map((h) =>
          h.rects.map((r, i) => (
            <div
              key={`${h.cardId}-${i}-${p.flash?.cardId === h.cardId ? p.flash.nonce : 0}`}
              className={`hl ${h.kind === 'area' ? 'area' : ''} ${h.cardId === p.selectedCardId ? 'selected' : ''} ${
                p.flash?.cardId === h.cardId ? 'flash' : ''
              }`}
              style={
                {
                  left: `${r.x * 100}%`,
                  top: `${r.y * 100}%`,
                  width: `${r.w * 100}%`,
                  height: `${r.h * 100}%`,
                  '--cc': `var(--c-${h.color})`,
                } as CSSProperties
              }
            />
          )),
        )}
      </div>
      <div ref={textRef} className="textLayer" onMouseDown={(e) => e.currentTarget.classList.add('selecting')} />
      {p.areaMode && <AreaOverlay pageNum={p.pageNum} rootRef={rootRef} onArea={p.onArea} />}
    </div>
  );
});

function AreaOverlay({
  pageNum,
  rootRef,
  onArea,
}: {
  pageNum: number;
  rootRef: RefObject<HTMLDivElement | null>;
  onArea: Props['onArea'];
}) {
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const toLocal = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.min(Math.max(e.clientX - r.left, 0), r.width), y: Math.min(Math.max(e.clientY - r.top, 0), r.height) };
  };
  const box = drag && {
    left: Math.min(drag.x0, drag.x1),
    top: Math.min(drag.y0, drag.y1),
    width: Math.abs(drag.x1 - drag.x0),
    height: Math.abs(drag.y1 - drag.y0),
  };
  return (
    <div
      className="area-overlay"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const { x, y } = toLocal(e);
        setDrag({ x0: x, y0: y, x1: x, y1: y });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const { x, y } = toLocal(e);
        setDrag({ ...drag, x1: x, y1: y });
      }}
      onPointerUp={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        if (drag && box && box.width > 8 && box.height > 8 && rootRef.current) {
          onArea(
            pageNum,
            { x: box.left / r.width, y: box.top / r.height, w: box.width / r.width, h: box.height / r.height },
            rootRef.current,
            e.altKey,
          );
        }
        setDrag(null);
      }}
    >
      {box && <div className="area-rect" style={box} />}
    </div>
  );
}
