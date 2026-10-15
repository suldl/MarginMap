import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { clamp, uid } from '../../lib/util';
import { useNotebook } from '../../store/notebook';
import { useStudy, type ReaderTool } from '../../store/study';
import { COLORS, type ColorKey, type DocInk, type DocMark, type DocNote, type DocText, type InkColor } from '../../types';
import { Icon } from '../Icon';
import { MathTextarea } from '../Inspector';
import { useLatexAssist } from '../LatexAssist';
import { MathText } from '../MathText';
import { distToSegment, strokePath } from '../whiteboard/geometry';

/** Stroke widths and font sizes of the three size presets, as fractions of the page width. */
export const DOC_SIZES = {
  pen: [0.0025, 0.005, 0.009],
  marker: [0.014, 0.022, 0.034],
  text: [0.018, 0.024, 0.034],
} as const;

/** Ink colours for writing on pages; 'ink' is near-black (pages are white in every theme). */
export const DOC_INKS: InkColor[] = ['ink', ...COLORS];
export const docInk = (c: InkColor) => (c === 'ink' ? '#1d1d1f' : `var(--c-${c})`);
/** Notes take the pen colour, or yellow for black ink. */
export const noteColor = (c: InkColor): ColorKey => (c === 'ink' ? 'yellow' : c);

/** Eraser radius in screen pixels. */
const ERASER_R = 10;
/** Pointer Events `buttons` bit of a pen's eraser end / eraser button. */
const PEN_ERASER = 32;

const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** A mark moved by an offset in page fractions. */
export function moveMark(m: DocMark, dx: number, dy: number): DocMark {
  if (m.type === 'ink') return { ...m, points: m.points.map((v, i) => round4(v + (i % 2 ? dy : dx))) };
  return { ...m, x: round4(m.x + dx), y: round4(m.y + dy) };
}

/** Bounding box of an ink stroke in page pixels. */
function inkBox(m: DocInk, w: number, h: number) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < m.points.length; i += 2) {
    minX = Math.min(minX, m.points[i] * w);
    maxX = Math.max(maxX, m.points[i] * w);
    minY = Math.min(minY, m.points[i + 1] * h);
    maxY = Math.max(maxY, m.points[i + 1] * h);
  }
  const pad = (m.size * w) / 2 + 3;
  return { left: minX - pad, top: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}

const noteSize = (pageW: number) => clamp(pageW * 0.032, 16, 30);

// ---------------------------------------------------------------------------
// Drawing the marks of a page
// ---------------------------------------------------------------------------

/** Ink, text boxes and sticky notes of one page. */
export const MarkLayer = memo(function MarkLayer({
  marks,
  width,
  height,
  interactive,
  selectedId,
  drag,
  hiddenId,
  onOpenNote,
}: {
  marks: DocMark[];
  width: number;
  height: number;
  /** Marks can be clicked, selected and dragged (pointer tool). Notes always open on click. */
  interactive: boolean;
  selectedId: string | null;
  /** A mark being dragged, and by how much (page fractions). */
  drag: { id: string; dx: number; dy: number } | null;
  /** A mark that is open in an editor. */
  hiddenId: string | null;
  onOpenNote(id: string): void;
}) {
  const shown = marks.map((m) => (drag?.id === m.id ? moveMark(m, drag.dx, drag.dy) : m)).filter((m) => m.id !== hiddenId);
  const inks = shown.filter((m): m is DocInk => m.type === 'ink');
  const selectedInk = inks.find((m) => m.id === selectedId);
  return (
    <div className={`mark-layer ${interactive ? 'interactive' : ''}`}>
      <svg className="mark-ink" width={width} height={height}>
        {inks.map((m) => {
          const d = strokePath(m.points.map((v, i) => v * (i % 2 ? height : width)));
          const w = Math.max(0.6, m.size * width);
          return (
            <g key={m.id} data-mark={m.id}>
              <path className="mark-hit" d={d} strokeWidth={Math.max(w, 12)} />
              <path
                d={d}
                fill="none"
                stroke={docInk(m.color)}
                strokeWidth={w}
                strokeOpacity={m.highlighter ? 0.38 : 1}
                strokeLinecap={m.highlighter ? 'butt' : 'round'}
                strokeLinejoin="round"
                className={m.highlighter ? 'marker' : undefined}
              />
            </g>
          );
        })}
      </svg>
      {selectedInk && <div className="mark-sel" style={inkBox(selectedInk, width, height)} />}
      {shown.map((m) =>
        m.type === 'text' ? (
          <div
            key={m.id}
            data-mark={m.id}
            className={`mark-text ${m.cover ? 'cover' : ''} ${m.id === selectedId ? 'selected' : ''}`}
            style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, fontSize: m.fontSize * width, color: docInk(m.color) }}
          >
            <MathText text={m.text} />
          </div>
        ) : m.type === 'note' ? (
          <button
            key={m.id}
            data-mark={m.id}
            className={`mark-note ${m.id === selectedId ? 'selected' : ''}`}
            title={m.text}
            style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: noteSize(width), height: noteSize(width), '--cc': `var(--c-${m.color})` } as CSSProperties}
            onMouseUp={(e) => e.stopPropagation()}
            onClick={() => !interactive && onOpenNote(m.id)}
          >
            <Icon name="comment" size={Math.round(noteSize(width) * 0.62)} />
          </button>
        ) : null,
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Writing on a page
// ---------------------------------------------------------------------------

/** Captures the pointer over a page for the pen, highlighter, eraser, text and note tools. */
export function MarkOverlay({
  tool,
  docId,
  page,
  marks,
  onPlace,
}: {
  tool: ReaderTool;
  docId: string;
  page: number;
  marks: DocMark[];
  /** Text and note tools: a click at (x, y) page fractions. */
  onPlace(page: number, x: number, y: number): void;
}) {
  const [points, setPoints] = useState<number[] | null>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const erasing = useRef<string | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const style = useStudy((s) => s.docInk);
  const marker = tool === 'marker';

  const local = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { px: clamp(e.clientX - r.left, 0, r.width), py: clamp(e.clientY - r.top, 0, r.height), w: r.width, h: r.height };
  };

  const moveCursor = (e: ReactPointerEvent<HTMLDivElement>, show: boolean) => {
    const el = cursorRef.current;
    if (!el) return;
    const r = e.currentTarget.getBoundingClientRect();
    el.style.display = show ? 'block' : 'none';
    el.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px)`;
  };

  /** Removes marks under the eraser along the way from the last point (one undo step per stroke). */
  const eraseTo = (e: ReactPointerEvent<HTMLDivElement>) => {
    const { px, py, w, h } = local(e);
    const from = last.current ?? { x: px, y: py };
    last.current = { x: px, y: py };
    const pageEl = e.currentTarget.parentElement;
    const pr = pageEl?.getBoundingClientRect();
    const hits: string[] = [];
    for (const m of marks) {
      if (m.type === 'ink') {
        const tol = ERASER_R + (m.size * w) / 2;
        for (let i = 0; i + 1 < m.points.length; i += 2) {
          const a = { x: m.points[i] * w, y: m.points[i + 1] * h };
          const b = i + 3 < m.points.length ? { x: m.points[i + 2] * w, y: m.points[i + 3] * h } : a;
          // Distance between the eraser's path and the stroke segment (sampled along the eraser path).
          const steps = Math.max(1, Math.ceil(Math.hypot(px - from.x, py - from.y) / 4));
          let hit = false;
          for (let s = 0; s <= steps && !hit; s++) {
            const p = { x: from.x + ((px - from.x) * s) / steps, y: from.y + ((py - from.y) * s) / steps };
            hit = distToSegment(p, a, b) <= tol;
          }
          if (hit) {
            hits.push(m.id);
            break;
          }
        }
      } else if (pageEl && pr) {
        const el = pageEl.querySelector(`[data-mark="${m.id}"]`);
        const r = el?.getBoundingClientRect();
        if (!r) continue;
        const cx = clamp(px, r.left - pr.left, r.right - pr.left);
        const cy = clamp(py, r.top - pr.top, r.bottom - pr.top);
        if (Math.hypot(px - cx, py - cy) <= ERASER_R) hits.push(m.id);
      }
    }
    if (hits.length) useNotebook.getState().marksRemove(hits, erasing.current ?? undefined);
  };

  return (
    <div
      className={`mark-overlay tool-${tool}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const { px, py, w, h } = local(e);
        // A pen's eraser end erases whatever the tool.
        const penEraser = e.pointerType === 'pen' && (e.buttons & PEN_ERASER) !== 0;
        if ((tool === 'write' || tool === 'note') && !penEraser) {
          onPlace(page, px / w, py / h);
          return;
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        setSize({ w, h });
        if (tool === 'eraser' || penEraser) {
          erasing.current = `erase-${uid()}`;
          last.current = null;
          moveCursor(e, true);
          eraseTo(e);
        } else {
          setPoints([px, py]);
        }
      }}
      onPointerMove={(e) => {
        if (tool === 'eraser' || erasing.current) {
          moveCursor(e, true);
          if (erasing.current) eraseTo(e);
          return;
        }
        if (!points) return;
        const { px, py } = local(e);
        const n = points.length;
        if (Math.hypot(px - points[n - 2], py - points[n - 1]) < 2) return;
        setPoints([...points, px, py]);
      }}
      onPointerUp={(e) => {
        if (erasing.current && tool !== 'eraser') moveCursor(e, false);
        erasing.current = null;
        last.current = null;
        if (!points) return;
        const mark: DocInk = {
          id: uid(),
          type: 'ink',
          docId,
          page,
          points: points.map((v, i) => round4(v / (i % 2 ? size.h : size.w))),
          color: style.color,
          size: DOC_SIZES[marker ? 'marker' : 'pen'][style.size],
          highlighter: marker || undefined,
        };
        setPoints(null);
        useNotebook.getState().marksAdd([mark]);
      }}
      onPointerLeave={(e) => !erasing.current && moveCursor(e, false)}
    >
      {points && (
        <svg className="mark-ink" width={size.w} height={size.h}>
          <path
            d={strokePath(points)}
            fill="none"
            stroke={docInk(style.color)}
            strokeWidth={Math.max(0.6, DOC_SIZES[marker ? 'marker' : 'pen'][style.size] * size.w)}
            strokeOpacity={marker ? 0.38 : 1}
            strokeLinecap={marker ? 'butt' : 'round'}
            strokeLinejoin="round"
            className={marker ? 'marker' : undefined}
          />
        </svg>
      )}
      <div ref={cursorRef} className="mark-eraser" style={{ width: ERASER_R * 2, height: ERASER_R * 2, margin: -ERASER_R }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editing text boxes and notes
// ---------------------------------------------------------------------------

/**
 * Editor for a text box on the page (LaTeX autocomplete). Clicking elsewhere, Esc or Ctrl+Enter
 * finishes; the reader keeps the text, so a click on the page can finish it too.
 */
export function MarkTextEditor({
  mark,
  pageWidth,
  onChange,
  onDone,
}: {
  mark: DocText;
  pageWidth: number;
  onChange(text: string): void;
  onDone(): void;
}) {
  const assist = useLatexAssist<HTMLTextAreaElement>(mark.text, onChange);
  const ref = assist.ref;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [mark.text, mark.fontSize, pageWidth, ref]);
  useEffect(() => {
    const el = ref.current;
    el?.focus({ preventScroll: true });
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [ref]);
  return (
    <>
      <textarea
        ref={ref}
        className={`mark-text-edit ${mark.cover ? 'cover' : ''}`}
        value={mark.text}
        placeholder="Type… ($x^2$ for formulas)"
        style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%`, width: `${mark.w * 100}%`, fontSize: mark.fontSize * pageWidth, color: docInk(mark.color) }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onDone}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (assist.onKeyDown(e)) return;
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) onDone();
        }}
      />
      {assist.popup}
    </>
  );
}

/** An open sticky note: its text (editable) and colour. Clicking outside, Esc or Done closes it. */
export function NotePopover({
  note,
  pageWidth,
  onChange,
  onDone,
  onDelete,
}: {
  note: DocNote;
  pageWidth: number;
  onChange(patch: Partial<Pick<DocNote, 'text' | 'color'>>): void;
  onDone(): void;
  onDelete(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      // (A click on the page with a writing tool is handled there: it closes the note without starting another.)
      if (ref.current && !ref.current.contains(t) && !t.closest?.('.tex-assist, .mark-overlay')) doneRef.current();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, []);

  return (
    <div
      ref={ref}
      className="note-popover"
      style={
        {
          // Next to the note, on the side of the page with more room.
          left: note.x > 0.5 ? undefined : `calc(${note.x * 100}% + ${noteSize(pageWidth) / 2 + 6}px)`,
          right: note.x > 0.5 ? `calc(${(1 - note.x) * 100}% + ${noteSize(pageWidth) / 2 + 6}px)` : undefined,
          top: `calc(${note.y * 100}% - 8px)`,
          '--cc': `var(--c-${note.color})`,
        } as CSSProperties
      }
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if ((e.key === 'Escape' && !e.defaultPrevented) || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) onDone();
      }}
    >
      <div className="note-popover-head">
        <Icon name="comment" size={14} />
        <span>Note</span>
        <div style={{ flex: 1 }} />
        <div className="swatches">
          {COLORS.map((c) => (
            <button
              key={c}
              className={`swatch ${note.color === c ? 'on' : ''}`}
              style={{ '--sw': `var(--c-${c})`, width: 13, height: 13 } as CSSProperties}
              title={c}
              onClick={() => onChange({ color: c })}
            />
          ))}
        </div>
      </div>
      <MathTextarea value={note.text} onChange={(text) => onChange({ text })} placeholder="Write a note… ($x^2$ for formulas)" minRows={3} autoFocus />
      <div className="note-popover-foot">
        <button className="btn danger" onClick={onDelete}>
          <Icon name="trash" size={14} /> Delete
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn primary" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
