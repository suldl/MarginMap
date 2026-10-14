import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { suggestCommands, type TexCommand } from '../lib/latexCommands';
import { hasMath, renderTex } from '../lib/math';
import { useSettings } from '../store/settings';
import { MathText } from './MathText';

type Field = HTMLTextAreaElement | HTMLInputElement;

interface Popup {
  /** Index of the backslash that started the command. */
  start: number;
  end: number;
  query: string;
  items: TexCommand[];
  index: number;
  x: number;
  y: number;
  lineTop: number;
}

const MIRROR_PROPS = [
  'boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight',
  'fontStretch', 'fontSize', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent',
  'letterSpacing', 'wordSpacing', 'tabSize', 'wordBreak', 'overflowWrap',
] as const;

/** Viewport position of a character in a text field (mirror-element technique; works inside scaled canvases). */
function caretPoint(el: Field, pos: number) {
  const cs = getComputedStyle(el);
  const div = document.createElement('div');
  for (const p of MIRROR_PROPS) div.style[p] = cs[p];
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.left = '-10000px';
  div.style.top = '0';
  div.style.whiteSpace = el instanceof HTMLInputElement ? 'pre' : 'pre-wrap';
  div.style.width = `${el.offsetWidth}px`;
  div.textContent = el.value.slice(0, pos);
  const mark = document.createElement('span');
  mark.textContent = el.value.slice(pos) || '.';
  div.appendChild(mark);
  document.body.appendChild(div);
  const lineH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
  const left = mark.offsetLeft - el.scrollLeft;
  const top = mark.offsetTop - el.scrollTop;
  div.remove();
  const r = el.getBoundingClientRect();
  const k = el.offsetWidth ? r.width / el.offsetWidth : 1;
  return { x: r.left + left * k, y: r.top + (top + lineH) * k, lineTop: r.top + top * k };
}

/** Expands `$1`, `$2`… markers into plain text plus the caret positions of the stops (in order). */
function expandSnippet(raw: string) {
  let text = '';
  const marks: [number, number][] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '$' && /\d/.test(raw[i + 1] ?? '')) {
      marks.push([Number(raw[i + 1]), text.length]);
      i++;
      continue;
    }
    text += raw[i];
  }
  marks.sort((a, b) => a[0] - b[0]);
  return { text, stops: marks.map((m) => m[1]) };
}

/**
 * LaTeX autocomplete for a text field. Typing `\` plus letters lists matching commands
 * (with rendered previews); ↑/↓ choose, Enter/Tab insert, Esc closes. Inserted templates
 * such as `\frac{}{}` put the caret in the first slot, and Tab jumps to the next one.
 *
 * Wire it up with `ref`, call `onKeyDown` first in the field's key handler (it returns true
 * when it used the key), and render `popup`.
 */
export function useLatexAssist<T extends Field>(value: string, onChange: (next: string) => void) {
  const ref = useRef<T>(null);
  const enabled = useSettings((s) => s.mathComplete);
  const [popup, setPopup] = useState<Popup | null>(null);
  const session = useRef<{ stops: number[]; final: number; start: number } | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const prevValue = useRef(value);

  const refresh = useCallback(() => {
    const el = ref.current;
    if (!el || !enabled || document.activeElement !== el || el.selectionStart !== el.selectionEnd) {
      setPopup(null);
      return;
    }
    const caret = el.selectionStart ?? 0;
    const before = el.value.slice(0, caret);
    const m = /\\([a-zA-Z]*)$/.exec(before);
    // `\\` is a LaTeX line break, and a caret inside a word is not completing anything.
    if (!m || before[m.index - 1] === '\\' || /[a-zA-Z]/.test(el.value[caret] ?? '')) {
      setPopup(null);
      return;
    }
    const items = suggestCommands(m[1]);
    if (!items.length || (items.length === 1 && items[0].name === m[1] && items[0].insert === `\\${m[1]}`)) {
      setPopup(null);
      return;
    }
    const pt = caretPoint(el, m.index);
    setPopup((prev) => ({ start: m.index, end: caret, query: m[1], items, index: prev?.query === m[1] ? prev.index : 0, ...pt }));
  }, [enabled]);

  // After each change: keep pending tab stops in place, restore the caret after an insertion, refresh suggestions.
  useLayoutEffect(() => {
    const prev = prevValue.current;
    prevValue.current = value;
    const s = session.current;
    if (s && prev !== value) {
      let p = 0;
      while (p < prev.length && p < value.length && prev[p] === value[p]) p++;
      const delta = value.length - prev.length;
      s.stops = s.stops.map((x) => (x >= p ? Math.max(p, x + delta) : x));
      if (s.final >= p) s.final = Math.max(p, s.final + delta);
    }
    const el = ref.current;
    if (el && pendingCaret.current !== null) {
      const c = pendingCaret.current;
      pendingCaret.current = null;
      el.focus();
      el.setSelectionRange(c, c);
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const accept = (cmd: TexCommand) => {
    const el = ref.current;
    if (!el || !popup) return;
    const { text, stops } = expandSnippet(cmd.insert);
    const cur = el.value;
    const next = cur.slice(0, popup.start) + text + cur.slice(popup.end);
    const abs = stops.map((x) => popup.start + x);
    const final = popup.start + text.length;
    session.current = abs.length ? { stops: abs.slice(1), final, start: popup.start } : null;
    pendingCaret.current = abs[0] ?? final;
    prevValue.current = next;
    setPopup(null);
    onChange(next);
  };

  const jumpToNextStop = () => {
    const el = ref.current;
    const s = session.current;
    if (!el || !s) return false;
    const caret = el.selectionStart ?? 0;
    if (caret < s.start || caret > s.final) {
      session.current = null;
      return false;
    }
    const next = s.stops.shift();
    const to = next ?? s.final;
    if (next === undefined) session.current = null;
    el.setSelectionRange(to, to);
    return true;
  };

  /** Returns true when the key was used by the autocomplete (the caller should then do nothing else). */
  const onKeyDown = (e: React.KeyboardEvent): boolean => {
    if (popup) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = popup.items.length;
        setPopup({ ...popup, index: (popup.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n });
        return true;
      }
      if ((e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) || e.key === 'Tab') {
        e.preventDefault();
        accept(popup.items[popup.index]);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setPopup(null);
        return true;
      }
    }
    if (e.key === 'Tab' && !e.shiftKey && session.current && jumpToNextStop()) {
      e.preventDefault();
      return true;
    }
    if (e.key === 'Escape') session.current = null;
    return false;
  };

  // Caret moves (clicks, arrow keys) and focus loss update or close the list.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMove = (e: Event) => {
      if (e instanceof KeyboardEvent && !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      refresh();
    };
    const onBlur = () => {
      setPopup(null);
      session.current = null;
    };
    el.addEventListener('keyup', onMove);
    el.addEventListener('mouseup', onMove);
    el.addEventListener('blur', onBlur);
    return () => {
      el.removeEventListener('keyup', onMove);
      el.removeEventListener('mouseup', onMove);
      el.removeEventListener('blur', onBlur);
    };
  }, [refresh]);

  const popupEl = popup ? (
    <AssistPopup popup={popup} onPick={accept} onHover={(i) => setPopup({ ...popup, index: i })} />
  ) : null;

  return { ref, onKeyDown, popup: popupEl, open: !!popup };
}

function AssistPopup({ popup, onPick, onHover }: { popup: Popup; onPick(c: TexCommand): void; onHover(i: number): void }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }, [popup.index]);
  const below = popup.y + 280 < window.innerHeight;
  const style: React.CSSProperties = {
    left: Math.max(8, Math.min(popup.x - 10, window.innerWidth - 320)),
    top: below ? popup.y + 4 : popup.lineTop - 4,
    transform: below ? undefined : 'translateY(-100%)',
  };
  // Rendered in <body> so canvas zoom never scales it; events must not reach the canvas below.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return createPortal(
    <div
      ref={listRef}
      className="tex-assist"
      style={style}
      role="listbox"
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onWheel={stop}
    >
      {popup.items.map((c, i) => (
        <div
          key={c.name}
          role="option"
          aria-selected={i === popup.index}
          className={`tex-item ${i === popup.index ? 'on' : ''}`}
          onPointerEnter={() => onHover(i)}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            onPick(c);
          }}
        >
          <span className="tex-name">\{c.name}</span>
          <span className="tex-preview" dangerouslySetInnerHTML={{ __html: renderTex(c.preview, false) }} />
          {c.hint && <span className="tex-hint">{c.hint}</span>}
        </div>
      ))}
      <div className="tex-foot">
        <span className="kbd">↑</span>
        <span className="kbd">↓</span> choose · <span className="kbd">Enter</span> insert · <span className="kbd">Esc</span> close
      </div>
    </div>,
    document.body,
  );
}

/** Rendered preview shown under an editor whose text contains a formula. */
export function MathPreview({ text }: { text: string }) {
  const enabled = useSettings((s) => s.math);
  if (!enabled || !hasMath(text)) return null;
  return (
    <div className="math-preview">
      <div className="math-preview-label">Preview</div>
      <MathText text={text} />
    </div>
  );
}
