import { useMemo, useRef, useState } from 'react';
import { backend, type OpenFile } from '../backend';
import { useAssetUrl } from '../hooks/useAssetUrl';
import { exportNotebook, type ExportFormat } from '../lib/export';
import { formatDate, formatSize } from '../lib/util';
import { useLibrary } from '../store/library';
import { useUi } from '../store/ui';
import type { DocMeta, NotebookMeta } from '../types';
import { Icon } from './Icon';
import { TitleBar } from './TitleBar';

export async function filesFromList(list: FileList | File[]): Promise<OpenFile[]> {
  const files = Array.from(list).filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  return Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
}

export async function importAndReport(files: OpenFile[]): Promise<DocMeta[]> {
  const { toast } = useUi.getState();
  if (!files.length) {
    toast('Only PDF files can be imported', 'error');
    return [];
  }
  toast(files.length === 1 ? `Importing ${files[0].name}…` : `Importing ${files.length} documents…`);
  const { docs, errors } = await useLibrary.getState().importFiles(files);
  for (const e of errors) toast(`Import failed — ${e}`, 'error');
  if (docs.length) toast(docs.length === 1 ? `Added “${docs[0].title}”` : `Added ${docs.length} documents`);
  return docs;
}

export async function exportById(id: string, format: ExportFormat) {
  const nb = await backend.loadNotebook(id);
  if (!nb) return;
  const ok = await exportNotebook(nb, useLibrary.getState().docs, format);
  if (ok) useUi.getState().toast('Export saved');
}

function dueCount(meta: NotebookMeta, now = Date.now()) {
  return meta.reviewDues.filter((d) => d <= now).length;
}

export function Library() {
  const docs = useLibrary((s) => s.docs);
  const notebooks = useLibrary((s) => s.notebooks);
  const navigate = useUi((s) => s.navigate);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [creating, setCreating] = useState<string[] | null>(null);

  const sortedNbs = useMemo(() => [...notebooks].sort((a, b) => b.openedAt - a.openedAt), [notebooks]);
  const totalDue = notebooks.reduce((n, m) => n + dueCount(m), 0);

  const openDoc = async (docId: string) => {
    const id = await useLibrary.getState().notebookForDoc(docId);
    navigate({ name: 'study', notebookId: id });
  };

  const onFiles = async (list: FileList | File[]) => {
    await importAndReport(await filesFromList(list));
  };

  return (
    <>
      <TitleBar>
        <div className="brand">
          <div className="brand-mark">
            <Icon name="mindmap" size={13} strokeWidth={2.2} />
          </div>
          MarginMap
        </div>
        <div className="drag" />
        <button className="btn icon" title="Settings (Ctrl+,)" onClick={() => useUi.getState().openSettings()}>
          <Icon name="settings" />
        </button>
        <button className="btn" disabled={!totalDue} onClick={() => navigate({ name: 'review', notebookId: null })}>
          <Icon name="cards" /> Review{totalDue ? ` · ${totalDue} due` : ''}
        </button>
        <button className="btn" onClick={() => setCreating([])}>
          <Icon name="plus" /> New notebook
        </button>
        <button className="btn primary" onClick={() => fileRef.current?.click()}>
          <Icon name="import" /> Import PDF
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void onFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </TitleBar>

      <div
        className={`library ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void onFiles(e.dataTransfer.files);
        }}
      >
        {!docs.length && !notebooks.length ? (
          <div className="empty" style={{ minHeight: '70%' }}>
            <div>
              <div className="brand-mark" style={{ width: 56, height: 56, borderRadius: 16, margin: '0 auto' }}>
                <Icon name="mindmap" size={30} />
              </div>
              <h3>Welcome to MarginMap</h3>
              <p>
                Import a PDF, select text to excerpt it into cards,
                <br />
                organize them as a mind map, and review them as flashcards.
              </p>
              <button className="btn primary" style={{ marginTop: 12 }} onClick={() => fileRef.current?.click()}>
                <Icon name="import" /> Import PDF
              </button>
              <p className="muted" style={{ marginTop: 10 }}>
                …or drop PDF files anywhere in this window.
              </p>
            </div>
          </div>
        ) : (
          <>
            <section className="lib-section">
              <div className="lib-header">
                <h2>Notebooks</h2>
                <span className="muted">{notebooks.length}</span>
              </div>
              {sortedNbs.length ? (
                <div className="grid">
                  {sortedNbs.map((nb) => (
                    <NotebookTile key={nb.id} meta={nb} docs={docs} onOpen={() => navigate({ name: 'study', notebookId: nb.id })} />
                  ))}
                </div>
              ) : (
                <div className="drop-hint">Open a document to start a notebook.</div>
              )}
            </section>

            <section className="lib-section">
              <div className="lib-header">
                <h2>Documents</h2>
                <span className="muted">{docs.length}</span>
              </div>
              {docs.length ? (
                <div className="grid">
                  {docs.map((d) => (
                    <DocTile key={d.id} doc={d} onOpen={() => void openDoc(d.id)} onNewNotebook={() => setCreating([d.id])} />
                  ))}
                </div>
              ) : (
                <div className="drop-hint">Drop PDF files here to add them to your library.</div>
              )}
            </section>
          </>
        )}
      </div>

      {creating && (
        <NewNotebookDialog
          docs={docs}
          initial={creating}
          onClose={() => setCreating(null)}
          onCreate={async (title, ids) => {
            setCreating(null);
            const meta = await useLibrary.getState().createNotebook(title, ids);
            navigate({ name: 'study', notebookId: meta.id });
          }}
        />
      )}
    </>
  );
}

function Thumb({ id }: { id?: string }) {
  const url = useAssetUrl(id);
  return url ? <img src={url} alt="" draggable={false} /> : <Icon name="file" size={36} className="muted" />;
}

function NotebookTile({ meta, docs, onOpen }: { meta: NotebookMeta; docs: DocMeta[]; onOpen: () => void }) {
  const { openMenu, prompt, confirm, navigate } = useUi.getState();
  const lib = useLibrary.getState();
  const nbDocs = meta.docIds.map((id) => docs.find((d) => d.id === id)).filter(Boolean) as DocMeta[];
  const due = dueCount(meta);

  const showMenu = (x: number, y: number) =>
    openMenu(x, y, [
      { label: 'Open', onClick: onOpen },
      {
        label: 'Review cards',
        disabled: !meta.reviewDues.length,
        onClick: () => navigate({ name: 'review', notebookId: meta.id }),
      },
      { separator: true },
      {
        label: 'Rename…',
        onClick: async () => {
          const title = await prompt({ title: 'Rename notebook', value: meta.title, confirmLabel: 'Rename' });
          if (title) await lib.renameNotebook(meta.id, title);
        },
      },
      { label: 'Export as Markdown…', onClick: () => void exportById(meta.id, 'markdown') },
      { label: 'Export as OPML…', onClick: () => void exportById(meta.id, 'opml') },
      { label: 'Export as JSON…', onClick: () => void exportById(meta.id, 'json') },
      { separator: true },
      {
        label: 'Delete notebook…',
        danger: true,
        onClick: async () => {
          const ok = await confirm({
            title: `Delete “${meta.title}”?`,
            message: `Its ${meta.cardCount} cards and mind map will be removed. Documents stay in your library.`,
            confirmLabel: 'Delete',
            danger: true,
          });
          if (ok) await lib.deleteNotebook(meta.id);
        },
      },
    ]);

  return (
    <div
      className="tile"
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        showMenu(e.clientX, e.clientY);
      }}
    >
      <div className="tile-cover nb">
        <div className="tile-covers">
          {nbDocs.slice(0, 3).map((d) => (
            <Thumb key={d.id} id={d.thumbId} />
          ))}
          {!nbDocs.length && <Icon name="notebook" size={36} className="muted" />}
        </div>
      </div>
      <div className="tile-body">
        <div className="tile-title" title={meta.title}>
          {meta.title}
        </div>
        <div className="tile-meta">
          <span>{meta.cardCount} cards</span>
          <span>
            {nbDocs.length} doc{nbDocs.length === 1 ? '' : 's'}
          </span>
          <span>{formatDate(meta.updatedAt)}</span>
          {due > 0 && <span className="badge due">{due} due</span>}
        </div>
      </div>
      <button
        className="btn icon tile-menu"
        title="More"
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          showMenu(r.left, r.bottom + 4);
        }}
      >
        <Icon name="more" />
      </button>
    </div>
  );
}

function DocTile({ doc, onOpen, onNewNotebook }: { doc: DocMeta; onOpen: () => void; onNewNotebook: () => void }) {
  const { openMenu, prompt, confirm } = useUi.getState();
  const lib = useLibrary.getState();
  const showMenu = (x: number, y: number) =>
    openMenu(x, y, [
      { label: 'Open', onClick: onOpen },
      { label: 'New notebook with this document…', onClick: onNewNotebook },
      { separator: true },
      {
        label: 'Rename…',
        onClick: async () => {
          const title = await prompt({ title: 'Rename document', value: doc.title, confirmLabel: 'Rename' });
          if (title) lib.renameDoc(doc.id, title);
        },
      },
      {
        label: 'Remove from library…',
        danger: true,
        onClick: async () => {
          const ok = await confirm({
            title: `Remove “${doc.title}”?`,
            message: 'The PDF is removed from your library. Cards excerpted from it are kept, but can no longer jump to the source.',
            confirmLabel: 'Remove',
            danger: true,
          });
          if (ok) await lib.deleteDoc(doc.id);
        },
      },
    ]);
  return (
    <div
      className="tile"
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        showMenu(e.clientX, e.clientY);
      }}
    >
      <div className="tile-cover">
        <Thumb id={doc.thumbId} />
      </div>
      <div className="tile-body">
        <div className="tile-title" title={doc.fileName}>
          {doc.title}
        </div>
        <div className="tile-meta">
          <span>{doc.pageCount} pages</span>
          <span>{formatSize(doc.size)}</span>
        </div>
      </div>
      <button
        className="btn icon tile-menu"
        title="More"
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          showMenu(r.left, r.bottom + 4);
        }}
      >
        <Icon name="more" />
      </button>
    </div>
  );
}

export function NewNotebookDialog({
  docs,
  initial,
  onClose,
  onCreate,
}: {
  docs: DocMeta[];
  initial: string[];
  onClose: () => void;
  onCreate: (title: string, docIds: string[]) => void;
}) {
  const [title, setTitle] = useState(() => (initial.length === 1 ? (docs.find((d) => d.id === initial[0])?.title ?? '') : ''));
  const [picked, setPicked] = useState<string[]>(initial);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) onCreate(title.trim(), picked);
        }}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h3>New notebook</h3>
        <div className="field">
          <label>Title</label>
          <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Organic Chemistry" />
        </div>
        <div className="field">
          <label>Documents</label>
          {docs.length ? (
            <div className="doc-pick">
              {docs.map((d) => (
                <label key={d.id}>
                  <input
                    type="checkbox"
                    checked={picked.includes(d.id)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, d.id] : picked.filter((x) => x !== d.id))}
                  />
                  <span>{d.title}</span>
                  <span className="muted" style={{ marginLeft: 'auto' }}>
                    {d.pageCount} p.
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="muted">No documents yet — you can add them later.</p>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!title.trim()}>
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
