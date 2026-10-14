import katex from 'katex';
import 'katex/dist/katex.min.css';

export type Segment = { kind: 'text'; text: string } | { kind: 'math'; tex: string; display: boolean };

const QUICK = /\$|\\\(|\\\[/;

/** Whether the text may contain a formula (cheap pre-check before `splitMath`). */
export function mayHaveMath(s: string) {
  return QUICK.test(s);
}

/**
 * Splits text into plain and LaTeX segments. Supported delimiters:
 * `$$…$$` and `\[…\]` (display), `$…$` and `\(…\)` (inline); `\$` is a literal dollar.
 * Like Pandoc, an inline `$` must hug its content (`$x$`, not `$ x $`) and the closing
 * `$` must not be followed by a digit, so prices such as "$5 and $10" stay text.
 */
export function splitMath(s: string): Segment[] {
  const out: Segment[] = [];
  let text = '';
  const pushText = () => {
    if (text) out.push({ kind: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '$') {
      text += '$';
      i += 2;
      continue;
    }
    if (ch === '\\' && (s[i + 1] === '(' || s[i + 1] === '[')) {
      const close = s[i + 1] === '(' ? '\\)' : '\\]';
      const end = s.indexOf(close, i + 2);
      if (end !== -1 && end > i + 2) {
        pushText();
        out.push({ kind: 'math', tex: s.slice(i + 2, end), display: s[i + 1] === '[' });
        i = end + 2;
        continue;
      }
    }
    if (ch === '$' && s[i + 1] === '$') {
      const end = s.indexOf('$$', i + 2);
      if (end !== -1 && s.slice(i + 2, end).trim()) {
        pushText();
        out.push({ kind: 'math', tex: s.slice(i + 2, end), display: true });
        i = end + 2;
        continue;
      }
    }
    if (ch === '$' && s[i + 1] && !/\s/.test(s[i + 1])) {
      let j = i + 1;
      let end = -1;
      while (j < s.length) {
        if (s[j] === '\\') {
          j += 2;
          continue;
        }
        if (s[j] === '\n' && s[j + 1] === '\n') break; // no formulas across paragraphs
        if (s[j] === '$') {
          if (!/\s/.test(s[j - 1]) && !/\d/.test(s[j + 1] ?? '')) end = j;
          break;
        }
        j++;
      }
      if (end !== -1) {
        pushText();
        out.push({ kind: 'math', tex: s.slice(i + 1, end), display: false });
        i = end + 1;
        continue;
      }
    }
    text += ch;
    i++;
  }
  pushText();
  return out;
}

export function hasMath(s: string) {
  return mayHaveMath(s) && splitMath(s).some((seg) => seg.kind === 'math');
}

const cache = new Map<string, string>();

/** KaTeX HTML for a formula (memoized). Errors render inline in red instead of throwing. */
export function renderTex(tex: string, display: boolean): string {
  const key = (display ? 'D' : 'I') + tex;
  let html = cache.get(key);
  if (html === undefined) {
    html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      maxSize: 30,
      maxExpand: 500,
      output: 'htmlAndMathml',
    });
    if (cache.size > 600) cache.delete(cache.keys().next().value!);
    cache.set(key, html);
  }
  return html;
}

/** Whether KaTeX can render the formula without an error. */
export function texIsValid(tex: string) {
  try {
    katex.renderToString(tex, { throwOnError: true, strict: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
