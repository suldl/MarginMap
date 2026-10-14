import { useEffect, useRef, useState } from 'react';
import { backend, type DataChangeMode, type DataFolderInfo } from '../backend';
import { formatSize } from '../lib/util';
import { useDataFolder } from '../store/dataFolder';
import { useUi } from '../store/ui';
import { Icon } from './Icon';
import { TitleBar } from './TitleBar';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "3 documents · 2 notebooks · 48.2 MB" */
export function describeLibrary(lib: { docs: number; notebooks: number; bytes: number }) {
  if (!lib.docs && !lib.notebooks && !lib.bytes) return 'empty';
  return `${plural(lib.docs, 'document')} · ${plural(lib.notebooks, 'notebook')} · ${formatSize(lib.bytes)}`;
}

/** Confirms a new library folder: move the library there, open the library already there, or start an empty one. */
export function DataFolderDialog() {
  const { pick, from, phase, progress, error, apply, cancel } = useDataFolder();
  const canMove = !!pick && !pick.hasLibrary && !!from?.available && from.hasLibrary;
  const [mode, setMode] = useState<DataChangeMode>('move');
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pick) return;
    setMode(pick.hasLibrary ? 'switch' : canMove ? 'move' : 'new');
    requestAnimationFrame(() => okRef.current?.focus());
    // canMove follows pick/from, which change together
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick]);

  useEffect(() => (phase === 'working' ? backend.onDataProgress((p) => useDataFolder.setState({ progress: p })) : undefined), [phase]);

  useEffect(() => {
    if (!pick) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        cancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pick, cancel]);

  if (!pick) return null;
  const keepsCurrent = !!from?.available && from.hasLibrary;
  const percent = progress?.totalBytes ? (progress.bytes / progress.totalBytes) * 100 : 0;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <div className="modal data-folder" role="dialog" aria-label="Change data folder">
        {phase === 'choose' && (
          <>
            <h3>{pick.hasLibrary ? 'Open this library?' : 'Change data folder'}</h3>
            <div className="data-target">
              <Icon name="folder" size={16} />
              <span className="data-path">{pick.dir}</span>
              {pick.isDefault && <span className="data-tag">default</span>}
            </div>
            {pick.hasLibrary ? (
              <p>
                This folder already holds a MarginMap library ({describeLibrary(pick)}). MarginMap will switch to it
                {keepsCurrent ? '; your current library stays where it is.' : '.'}
              </p>
            ) : (
              <div className="data-options" role="radiogroup">
                {canMove && (
                  <Option
                    on={mode === 'move'}
                    onSelect={() => setMode('move')}
                    title="Move my library here"
                    text={`${describeLibrary(from!)} — copied to the new folder, then removed from the old one.`}
                  />
                )}
                <Option
                  on={mode === 'new'}
                  onSelect={() => setMode('new')}
                  title="Start a new, empty library"
                  text={keepsCurrent ? 'Your current library stays where it is; choose its folder again to go back to it.' : 'Import documents into it as usual.'}
                />
              </div>
            )}
            <div className="modal-actions">
              <button className="btn outline" onClick={cancel}>
                Cancel
              </button>
              <button ref={okRef} className="btn primary" onClick={() => void apply(mode)}>
                {mode === 'move' ? 'Move library' : mode === 'switch' ? 'Open library' : 'Create library'}
              </button>
            </div>
          </>
        )}
        {phase === 'working' && (
          <>
            <h3>{mode === 'move' ? 'Moving your library…' : 'Switching library…'}</h3>
            {mode === 'move' && (
              <>
                <div className="progress-bar data-progress">
                  <div style={{ width: `${percent}%` }} />
                </div>
                <p className="set-hint">
                  {progress
                    ? `${progress.files} of ${plural(progress.totalFiles, 'file')} · ${formatSize(progress.bytes)} of ${formatSize(progress.totalBytes)}`
                    : 'Preparing…'}
                </p>
              </>
            )}
          </>
        )}
        {phase === 'error' && (
          <>
            <h3>Couldn’t change the data folder</h3>
            <p>{error}</p>
            {from?.available && (
              <p>
                Your library is still in <span className="data-path">{from.dir}</span>.
              </p>
            )}
            <div className="modal-actions">
              <button className="btn primary" onClick={cancel}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Option({ on, onSelect, title, text }: { on: boolean; onSelect(): void; title: string; text: string }) {
  return (
    <label className={`data-option ${on ? 'on' : ''}`}>
      <input type="radio" name="data-mode" checked={on} onChange={onSelect} />
      <div>
        <div className="set-title">{title}</div>
        <div className="set-hint">{text}</div>
      </div>
    </label>
  );
}

/** Shown instead of the library when the chosen data folder can't be found at startup. */
export function DataFolderMissing({ info, onRetry }: { info: DataFolderInfo; onRetry(): Promise<boolean> }) {
  const choose = useDataFolder((s) => s.choose);
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    setRetrying(true);
    const ok = await onRetry();
    setRetrying(false);
    if (!ok) useUi.getState().toast('The folder still can’t be found.', 'error');
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
      </TitleBar>
      <div className="data-missing">
        <div className="data-missing-card">
          <div className="data-missing-icon">
            <Icon name="folder" size={24} />
          </div>
          <h2>Your library folder can’t be found</h2>
          <div className="data-target">
            <span className="data-path">{info.dir}</span>
          </div>
          <p>If it’s on a removable drive or a network share, connect it and try again. Nothing has been changed.</p>
          <div className="data-missing-actions">
            <button className="btn primary" disabled={retrying} onClick={() => void retry()}>
              <Icon name="refresh" size={16} /> Try again
            </button>
            <button className="btn outline" onClick={() => void choose()}>
              Choose another folder…
            </button>
            <button className="btn outline" onClick={() => void choose(true)}>
              Use the default folder
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
