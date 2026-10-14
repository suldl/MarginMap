import { useEffect, useRef, useState } from 'react';
import { exportNotebook } from '../lib/export';
import { releaseAllPdfs } from '../lib/pdf';
import { useLibrary } from '../store/library';
import { useNotebook } from '../store/notebook';
import { useStudy } from '../store/study';
import { useUi } from '../store/ui';
import { Icon } from './Icon';
import { Inspector } from './Inspector';
import { filesFromList, importAndReport } from './Library';
import { MindMap } from './mindmap/MindMap';
import { Outline } from './Outline';
import { Reader } from './reader/Reader';
import { TitleBar } from './TitleBar';
import { Whiteboard } from './whiteboard/Whiteboard';

const lastDocKey = (nbId: string) => `marginmap.lastDoc.${nbId}`;

export function Study({ notebookId }: { notebookId: string }) {
  const nb = useNotebook((s) => s.nb);
  const navigate = useUi((s) => s.navigate);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void useNotebook
      .getState()
      .open(notebookId)
      .then((ok) => {
        if (!alive) return;
        if (!ok) {
          useUi.getState().toast('This notebook could not be found', 'error');
          navigate({ name: 'library' });
          return;
        }
        const loaded = useNotebook.getState().nb!;
        let last: string | null = null;
        try {
          last = localStorage.getItem(lastDocKey(notebookId));
        } catch {
          // ignore
        }
        useStudy.getState().set({
          activeDocId: last && loaded.docIds.includes(last) ? last : (loaded.docIds[0] ?? null),
          jump: null,
          reveal: null,
          flash: null,
          tool: 'text',
          sidebar: 'none',
        });
        setReady(true);
      });
    return () => {
      alive = false;
      void useNotebook.getState().close();
      releaseAllPdfs();
    };
  }, [notebookId, navigate]);

  // Remember the open document per notebook.
  const activeDocId = useStudy((s) => s.activeDocId);
  useEffect(() => {
    if (!ready || !activeDocId) return;
    try {
      localStorage.setItem(lastDocKey(notebookId), activeDocId);
    } catch {
      // ignore
    }
  }, [ready, activeDocId, notebookId]);

  // Undo / redo anywhere in the study view (except while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable]')) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        useNotebook.getState().undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        useNotebook.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!ready || !nb) {
    return (
      <>
        <TitleBar>
          <button className="btn" onClick={() => navigate({ name: 'library' })}>
            <Icon name="back" /> Library
          </button>
          <div className="drag" />
        </TitleBar>
        <div className="loading">
          <div className="spinner" />
        </div>
      </>
    );
  }
  return <StudyView />;
}

function StudyView() {
  const nb = useNotebook((s) => s.nb!);
  const canUndo = useNotebook((s) => s.past.length > 0);
  const canRedo = useNotebook((s) => s.future.length > 0);
  const docs = useLibrary((s) => s.docs);
  const { layout, mapMode, split, swapped, inspector, activeDocId, set } = useStudy();
  const navigate = useUi((s) => s.navigate);
  const studyRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [resizing, setResizing] = useState(false);
  const [title, setTitle] = useState(nb.title);
  const [dropping, setDropping] = useState(false);

  useEffect(() => setTitle(nb.title), [nb.title]);

  const now = Date.now();
  const cards = Object.values(nb.cards);
  const due = cards.filter((c) => c.review && c.review.due <= now).length;
  const inReview = cards.filter((c) => c.review).length;

  const addDocs = async (list: FileList | File[]) => {
    const added = await importAndReport(await filesFromList(list));
    for (const d of added) useNotebook.getState().addDoc(d.id);
    if (added[0]) set({ activeDocId: added[0].id });
  };

  const addDocMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const available = docs.filter((d) => !nb.docIds.includes(d.id));
    useUi.getState().openMenu(r.left, r.bottom + 4, [
      { label: 'Import PDF…', onClick: () => fileRef.current?.click() },
      ...(available.length ? [{ separator: true }] : []),
      ...available.slice(0, 30).map((d) => ({
        label: d.title,
        onClick: () => {
          useNotebook.getState().addDoc(d.id);
          set({ activeDocId: d.id });
        },
      })),
    ]);
  };

  const exportMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const run = async (fmt: 'markdown' | 'opml' | 'json') => {
      await useNotebook.getState().flush();
      if (await exportNotebook(useNotebook.getState().nb!, docs, fmt)) useUi.getState().toast('Export saved');
    };
    useUi.getState().openMenu(r.right - 220, r.bottom + 4, [
      { label: 'Export as Markdown…', onClick: () => void run('markdown') },
      { label: 'Export as OPML (mind map apps)…', onClick: () => void run('opml') },
      { label: 'Export as JSON backup…', onClick: () => void run('json') },
    ]);
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = studyRef.current;
    if (!el) return;
    setResizing(true);
    const rect = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      let ratio = (ev.clientX - rect.left) / rect.width;
      if (useStudy.getState().swapped) ratio = 1 - ratio;
      set({ split: Math.min(0.8, Math.max(0.2, ratio)) });
    };
    const up = () => {
      setResizing(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const closeTab = (id: string) => {
    useNotebook.getState().removeDoc(id);
    if (activeDocId === id) {
      // Activate the neighbouring tab, like a browser.
      const idx = nb.docIds.indexOf(id);
      const rest = nb.docIds.filter((x) => x !== id);
      set({ activeDocId: rest[Math.min(idx, rest.length - 1)] ?? null });
    }
  };

  const commitTitle = () => {
    const t = title.trim();
    if (t && t !== nb.title) useNotebook.getState().setTitle(t);
    else setTitle(nb.title);
  };

  return (
    <>
      <TitleBar>
        <button className="btn icon" title="Back to library" onClick={() => navigate({ name: 'library' })}>
          <Icon name="back" />
        </button>
        <input
          className="nb-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setTitle(nb.title);
              (e.target as HTMLInputElement).blur();
            }
          }}
          title="Notebook title"
        />
        <div className="divider-v" />
        <div className="doc-tabs">
          {nb.docIds.map((id) => {
            const d = docs.find((x) => x.id === id);
            if (!d) return null;
            return (
              <div
                key={id}
                className={`doc-tab ${activeDocId === id ? 'on' : ''}`}
                onClick={() => set({ activeDocId: id })}
                // Middle-click closes the tab (and must not start auto-scroll).
                onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                onAuxClick={(e) => {
                  if (e.button !== 1) return;
                  e.preventDefault();
                  closeTab(id);
                }}
                title={`${d.title} — middle-click to close`}
              >
                <Icon name="file" size={14} />
                <span>{d.title}</span>
                <button
                  className="x"
                  title="Remove from notebook"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(id);
                  }}
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            );
          })}
          <button className="btn icon" title="Add document" onClick={addDocMenu}>
            <Icon name="plus" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void addDocs(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        <div className="drag" />
        <button className="btn icon" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => useNotebook.getState().undo()}>
          <Icon name="undo" />
        </button>
        <button className="btn icon" title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={() => useNotebook.getState().redo()}>
          <Icon name="redo" />
        </button>
        <div className="divider-v" />
        <div className="seg">
          <button className={`btn icon ${layout === 'doc' ? 'on' : ''}`} title="Document only" onClick={() => set({ layout: 'doc' })}>
            <Icon name="docOnly" />
          </button>
          <button className={`btn icon ${layout === 'split' ? 'on' : ''}`} title="Document + mind map" onClick={() => set({ layout: 'split' })}>
            <Icon name="split" />
          </button>
          <button className={`btn icon ${layout === 'map' ? 'on' : ''}`} title="Mind map only" onClick={() => set({ layout: 'map' })}>
            <Icon name="mindmap" />
          </button>
        </div>
        <div className="seg">
          <button
            className={`btn icon ${mapMode === 'mindmap' ? 'on' : ''}`}
            title="Mind map view"
            disabled={layout === 'doc'}
            onClick={() => set({ mapMode: 'mindmap' })}
          >
            <Icon name="mindmap" />
          </button>
          <button
            className={`btn icon ${mapMode === 'outline' ? 'on' : ''}`}
            title="Outline view"
            disabled={layout === 'doc'}
            onClick={() => set({ mapMode: 'outline' })}
          >
            <Icon name="outline" />
          </button>
          <button
            className={`btn icon ${mapMode === 'whiteboard' ? 'on' : ''}`}
            title="Whiteboard view"
            disabled={layout === 'doc'}
            onClick={() => set({ mapMode: 'whiteboard' })}
          >
            <Icon name="whiteboard" />
          </button>
        </div>
        <button className="btn icon" title="Swap sides" disabled={layout !== 'split'} onClick={() => set({ swapped: !swapped })}>
          <Icon name="swap" />
        </button>
        <button
          className={`btn icon ${inspector ? 'on' : ''}`}
          title="Card panel"
          disabled={layout === 'doc'}
          onClick={() => set({ inspector: !inspector })}
        >
          <Icon name="panel" />
        </button>
        <div className="divider-v" />
        <button
          className="btn"
          title={inReview ? `${inReview} cards in review` : 'Add cards to review from the card panel'}
          disabled={!due}
          onClick={async () => {
            await useNotebook.getState().flush();
            navigate({ name: 'review', notebookId: nb.id });
          }}
        >
          <Icon name="cards" /> Review{due ? ` · ${due}` : ''}
        </button>
        <button className="btn icon" title="Export" onClick={exportMenu}>
          <Icon name="export" />
        </button>
        <button className="btn icon" title="Settings (Ctrl+,)" onClick={() => useUi.getState().openSettings()}>
          <Icon name="settings" />
        </button>
      </TitleBar>

      <div
        ref={studyRef}
        className={`study ${swapped ? 'swapped' : ''}`}
        style={dropping ? { outline: '3px dashed var(--accent)', outlineOffset: -6 } : undefined}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDropping(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDropping(false);
          void addDocs(e.dataTransfer.files);
        }}
      >
        {layout !== 'map' && (
          <div className="pane" style={layout === 'split' ? { width: `${split * 100}%`, flex: 'none' } : { flex: 1 }}>
            <Reader notebookId={nb.id} />
          </div>
        )}
        {layout === 'split' && <div className={`splitter ${resizing ? 'dragging' : ''}`} onPointerDown={startResize} />}
        {layout !== 'doc' && (
          <div className="pane" style={{ flex: 1 }}>
            <div className="map-pane">
              {mapMode === 'mindmap' ? <MindMap /> : mapMode === 'outline' ? <Outline /> : <Whiteboard />}
              {inspector && <Inspector />}
            </div>
          </div>
        )}
        {resizing && <div style={{ position: 'fixed', inset: 0, cursor: 'col-resize', zIndex: 50 }} />}
      </div>
    </>
  );
}
