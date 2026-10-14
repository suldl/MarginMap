import { useEffect, useRef, useState } from 'react';
import { loadOutline, pageText, type OutlineNode, type PDFDocumentProxy } from '../../lib/pdf';
import { useStudy } from '../../store/study';
import { Icon } from '../Icon';

export function ReaderSidebar({
  pdf,
  query,
  setQuery,
  onGo,
}: {
  pdf: PDFDocumentProxy;
  query: string;
  setQuery(q: string): void;
  onGo(page: number): void;
}) {
  const sidebar = useStudy((s) => s.sidebar);
  const set = useStudy((s) => s.set);
  if (sidebar === 'none' || sidebar === 'cards') return null;
  return (
    <aside className="reader-side">
      <div className="reader-side-head">
        <div className="seg">
          <button className={`btn ${sidebar === 'toc' ? 'on' : ''}`} onClick={() => set({ sidebar: 'toc' })}>
            Contents
          </button>
          <button className={`btn ${sidebar === 'search' ? 'on' : ''}`} onClick={() => set({ sidebar: 'search' })}>
            Search
          </button>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn icon" title="Close" onClick={() => set({ sidebar: 'none' })}>
          <Icon name="x" size={16} />
        </button>
      </div>
      {sidebar === 'toc' ? <Toc pdf={pdf} onGo={onGo} /> : <Search pdf={pdf} query={query} setQuery={setQuery} onGo={onGo} />}
    </aside>
  );
}

function Toc({ pdf, onGo }: { pdf: PDFDocumentProxy; onGo(page: number): void }) {
  const [outline, setOutline] = useState<OutlineNode[] | null>(null);
  useEffect(() => {
    let alive = true;
    loadOutline(pdf)
      .then((o) => alive && setOutline(o))
      .catch(() => alive && setOutline([]));
    return () => {
      alive = false;
    };
  }, [pdf]);
  if (!outline) return <div className="loading">Loading…</div>;
  if (!outline.length) return <div className="empty">This document has no table of contents.</div>;
  return (
    <div className="reader-side-body">
      {outline.map((n, i) => (
        <TocNode key={i} node={n} depth={0} onGo={onGo} />
      ))}
    </div>
  );
}

function TocNode({ node, depth, onGo }: { node: OutlineNode; depth: number; onGo(page: number): void }) {
  const [open, setOpen] = useState(depth === 0 && node.children.length < 12);
  return (
    <>
      <div className="toc-item" style={{ paddingLeft: 6 + depth * 14 }} onClick={() => node.page && onGo(node.page)}>
        <span
          className="caret"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
        >
          {node.children.length > 0 && <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} />}
        </span>
        <span>{node.title}</span>
        {node.page && <span className="pg">{node.page}</span>}
      </div>
      {open && node.children.map((c, i) => <TocNode key={i} node={c} depth={depth + 1} onGo={onGo} />)}
    </>
  );
}

interface Hit {
  page: number;
  before: string;
  match: string;
  after: string;
}

function Search({
  pdf,
  query,
  setQuery,
  onGo,
}: {
  pdf: PDFDocumentProxy;
  query: string;
  setQuery(q: string): void;
  onGo(page: number): void;
}) {
  const [hits, setHits] = useState<Hit[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const q = query.trim().toLowerCase();
    setHits([]);
    if (q.length < 2) {
      setProgress(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const found: Hit[] = [];
      for (let p = 1; p <= pdf.numPages && !cancelled; p++) {
        const text = await pageText(pdf, p);
        const lower = text.toLowerCase();
        let idx = lower.indexOf(q);
        while (idx !== -1 && found.length < 500) {
          found.push({
            page: p,
            before: text.slice(Math.max(0, idx - 40), idx),
            match: text.slice(idx, idx + q.length),
            after: text.slice(idx + q.length, idx + q.length + 60),
          });
          idx = lower.indexOf(q, idx + q.length);
        }
        if (p % 10 === 0 || p === pdf.numPages) {
          if (cancelled) return;
          setHits([...found]);
          setProgress(p / pdf.numPages);
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, pdf]);

  return (
    <>
      <div style={{ padding: '4px 10px 8px' }}>
        <input
          ref={inputRef}
          className="input"
          style={{ width: '100%' }}
          placeholder="Search in document…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits[0]) onGo(hits[0].page);
          }}
        />
        {progress !== null && (
          <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
            {hits.length >= 500 ? '500+' : hits.length} result{hits.length === 1 ? '' : 's'}
            {progress < 1 ? ` · searching ${Math.round(progress * 100)}%` : ''}
          </div>
        )}
      </div>
      <div className="reader-side-body">
        {hits.map((h, i) => (
          <div key={i} className="search-result" onClick={() => onGo(h.page)}>
            <div className="pg">Page {h.page}</div>
            …{h.before}
            <mark>{h.match}</mark>
            {h.after}…
          </div>
        ))}
      </div>
    </>
  );
}
