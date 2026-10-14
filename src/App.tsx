import { useEffect } from 'react';
import { backend, isElectron, type OpenFile } from './backend';
import { importAndReport, Library } from './components/Library';
import { Overlays } from './components/Overlays';
import { Review } from './components/Review';
import { Study } from './components/Study';
import { useLibrary } from './store/library';
import { applyAppearance, syncTitleBar } from './store/settings';
import { useUi } from './store/ui';
import { autoCheckForUpdates, initUpdates } from './store/updates';

async function openIncoming(files: OpenFile[]) {
  if (!files.length) return;
  const docs = await importAndReport(files);
  if (docs[0]) {
    const id = await useLibrary.getState().notebookForDoc(docs[0].id);
    useUi.getState().navigate({ name: 'study', notebookId: id });
  }
}

export function App() {
  const route = useUi((s) => s.route);
  const loaded = useLibrary((s) => s.loaded);

  useEffect(() => {
    if (isElectron) document.documentElement.classList.add('is-electron');
    applyAppearance();
    void useLibrary
      .getState()
      .load()
      .then(() => backend.takeOpenFiles())
      .then(openIncoming)
      .then(() => setTimeout(() => void autoCheckForUpdates(), 4000))
      .catch((err) => {
        console.error(err);
        useUi.getState().toast(`Could not load your library: ${(err as Error).message}`, 'error');
      });
    const off = backend.onOpenFiles((files) => void openIncoming(files));
    const offUpdates = initUpdates();

    // Dropping a file outside a drop zone must not navigate the window away.
    const block = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);

    // Ctrl+, opens the settings from anywhere.
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        const ui = useUi.getState();
        if (ui.settings) ui.closeSettings();
        else ui.openSettings();
      }
    };
    window.addEventListener('keydown', onKey);

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', syncTitleBar);
    return () => {
      off();
      offUpdates();
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
      window.removeEventListener('keydown', onKey);
      mq.removeEventListener('change', syncTitleBar);
    };
  }, []);

  return (
    <div className="app">
      {!loaded ? (
        <div className="loading">
          <div className="spinner" />
        </div>
      ) : route.name === 'library' ? (
        <Library />
      ) : route.name === 'study' ? (
        <Study key={route.notebookId} notebookId={route.notebookId} />
      ) : (
        <Review key={route.notebookId ?? 'all'} notebookId={route.notebookId} />
      )}
      <Overlays />
    </div>
  );
}
