export function uid(): string {
  const rand = crypto.getRandomValues(new Uint32Array(2));
  return Date.now().toString(36) + rand[0].toString(36) + rand[1].toString(36).slice(0, 4);
}

export function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  let lastArgs: A | undefined;
  const run = (...args: A) => {
    lastArgs = args;
    clearTimeout(t);
    t = setTimeout(() => {
      t = undefined;
      fn(...args);
    }, ms);
  };
  run.flush = () => {
    if (t !== undefined && lastArgs) {
      clearTimeout(t);
      t = undefined;
      fn(...lastArgs);
    }
  };
  return run;
}

const CJK = /[⺀-鿿가-힯豈-﫿＀-￯　-〿]/;

/** Joins wrapped lines from a PDF text selection into flowing text. */
export function normalizeExcerpt(text: string): string {
  const lines = text
    .replace(/­/g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  let out = '';
  for (const line of lines) {
    if (!out) {
      out = line;
    } else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(line)) {
      out = out.slice(0, -1) + line; // re-join a hyphenated word
    } else if (CJK.test(out.at(-1)!) || CJK.test(line[0])) {
      out += line;
    } else {
      out += ' ' + line;
    }
  }
  return out;
}

export function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function relativeDue(due: number, now = Date.now()) {
  const diff = due - now;
  if (diff <= 0) return 'due now';
  const mins = diff / 60000;
  if (mins < 60) return `in ${Math.round(mins)} min`;
  const hours = mins / 60;
  if (hours < 24) return `in ${Math.round(hours)} h`;
  const days = hours / 24;
  if (days < 45) return `in ${Math.round(days)} d`;
  return `in ${Math.round(days / 30)} mo`;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function stripExt(name: string) {
  return name.replace(/\.[^.]+$/, '');
}
