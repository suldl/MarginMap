import { useEffect, useState, type ReactNode } from 'react';
import { backend, isElectron, type AppInfo, type DataFolderInfo } from '../backend';
import { formatDate } from '../lib/util';
import { useDataFolder } from '../store/dataFolder';
import { ACCENTS, UI_SCALES, useSettings, type CanvasBg, type EdgeStyle, type MapDrag, type ThemePref } from '../store/settings';
import { useStudy } from '../store/study';
import { useUi, type SettingsSection } from '../store/ui';
import { useUpdates } from '../store/updates';
import { describeLibrary } from './DataFolder';
import { Icon, type IconName } from './Icon';
import { useLatexAssist } from './LatexAssist';
import { MathText } from './MathText';

const ALL_SECTIONS: { id: SettingsSection; label: string; icon: IconName }[] = [
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'maps', label: 'Mind map & board', icon: 'mindmap' },
  { id: 'math', label: 'Formulas', icon: 'sigma' },
  { id: 'data', label: 'Data', icon: 'folder' },
  { id: 'updates', label: 'Updates', icon: 'refresh' },
  { id: 'shortcuts', label: 'Shortcuts', icon: 'keyboard' },
  { id: 'about', label: 'About', icon: 'info' },
];
/** The browser build keeps its data in the browser, so it has no data folder to manage. */
const SECTIONS = ALL_SECTIONS.filter((s) => isElectron || s.id !== 'data');

export function Settings({ section }: { section: SettingsSection }) {
  const close = useUi((s) => s.closeSettings);
  const open = useUi((s) => s.openSettings);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useUi.getState().dialog && !useUi.getState().menu && !useDataFolder.getState().pick) {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal settings" role="dialog" aria-label="Settings">
        <nav className="settings-nav">
          <h3>Settings</h3>
          {SECTIONS.map((s) => (
            <button key={s.id} className={`settings-tab ${section === s.id ? 'on' : ''}`} onClick={() => open(s.id)}>
              <Icon name={s.icon} size={16} /> {s.label}
            </button>
          ))}
        </nav>
        <div className="settings-body">
          <div className="settings-head">
            <h2>{SECTIONS.find((s) => s.id === section)?.label}</h2>
            <button className="btn icon" title="Close (Esc)" onClick={close}>
              <Icon name="x" size={16} />
            </button>
          </div>
          <div className="settings-content">
            {section === 'appearance' && <AppearancePage />}
            {section === 'maps' && <MapsPage />}
            {section === 'math' && <MathPage />}
            {section === 'data' && <DataPage />}
            {section === 'updates' && <UpdatesPage />}
            {section === 'shortcuts' && <ShortcutsPage />}
            {section === 'about' && <AboutPage />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-text">
        <div className="set-title">{title}</div>
        {hint && <div className="set-hint">{hint}</div>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange(v: T): void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.value)} className={`btn ${value === o.value ? 'on' : ''}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange(v: boolean): void; label: string }) {
  return <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

function AppearancePage() {
  const s = useSettings();
  return (
    <>
      <Row title="Theme" hint="System follows the Windows light/dark setting.">
        <Seg<ThemePref>
          value={s.theme}
          onChange={(theme) => s.set({ theme })}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </Row>
      <Row title="Accent color" hint="Buttons, selection and highlights of the interface.">
        <div className="swatches">
          {ACCENTS.map((a) => (
            <button
              key={a.key}
              className={`swatch accent-swatch ${s.accent === a.key ? 'on' : ''}`}
              style={{ '--sw': `light-dark(${a.light}, ${a.dark})` } as React.CSSProperties}
              title={a.label}
              aria-label={`${a.label} accent`}
              onClick={() => s.set({ accent: a.key })}
            />
          ))}
        </div>
      </Row>
      {isElectron && (
        <Row title="Interface size" hint="Scales text, buttons and panels.">
          <Seg<number> value={s.uiScale} onChange={(uiScale) => s.set({ uiScale })} options={UI_SCALES.map((v) => ({ value: v, label: `${Math.round(v * 100)}%` }))} />
        </Row>
      )}
      <Row title="Canvas background" hint="Mind map and whiteboard.">
        <Seg<CanvasBg>
          value={s.canvasBg}
          onChange={(canvasBg) => s.set({ canvasBg })}
          options={[
            { value: 'dots', label: 'Dots' },
            { value: 'grid', label: 'Grid' },
            { value: 'plain', label: 'Plain' },
          ]}
        />
      </Row>
      <Row title="Mind map connectors">
        <Seg<EdgeStyle>
          value={s.edgeStyle}
          onChange={(edgeStyle) => s.set({ edgeStyle })}
          options={[
            { value: 'curve', label: 'Curved' },
            { value: 'elbow', label: 'Elbow' },
            { value: 'straight', label: 'Straight' },
          ]}
        />
      </Row>
      <div className="set-foot">
        <button className="btn outline" onClick={() => s.reset()}>
          Restore defaults
        </button>
      </div>
    </>
  );
}

function MapsPage() {
  const s = useSettings();
  const enlarge = useStudy((x) => x.enlarge);
  return (
    <>
      <Row
        title="Dragging on empty space"
        hint={
          s.mapDrag === 'select'
            ? 'Draws a selection box. Pan with the right or middle mouse button, or scroll.'
            : 'Pans the map. Hold Shift to draw a selection box instead.'
        }
      >
        <Seg<MapDrag>
          value={s.mapDrag}
          onChange={(mapDrag) => s.set({ mapDrag })}
          options={[
            { value: 'select', label: 'Select' },
            { value: 'pan', label: 'Pan' },
          ]}
        />
      </Row>
      <Row
        title="Enlarge picture cards on double-click"
        hint="Double-click a picture excerpt to see it big, with its notes. Double-clicking a text card (or any card while this is off) edits its title."
      >
        <Switch on={enlarge} label="Enlarge picture cards on double-click" onChange={(v) => useStudy.getState().set({ enlarge: v })} />
      </Row>
      <div className="set-note">
        <Icon name="info" size={15} />
        <div>
          Drag a card into empty space to place it freely — it stays connected to its parent. Hold <span className="kbd">Alt</span> while dropping to
          detach it as an independent card. <b>Tidy up</b> in the map's toolbar returns every card to the automatic layout.
        </div>
      </div>
    </>
  );
}

function MathPage() {
  const s = useSettings();
  const [sample, setSample] = useState('The area of a circle is $A = \\pi r^2$.\n\n$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$');
  const assist = useLatexAssist<HTMLTextAreaElement>(sample, setSample);
  return (
    <>
      <Row title="Render formulas" hint="LaTeX between $…$ (inline) or $$…$$ (display) in card titles, excerpts, notes and whiteboard text.">
        <Switch on={s.math} label="Render formulas" onChange={(math) => s.set({ math })} />
      </Row>
      <Row title="Autocomplete LaTeX commands" hint="Typing \ lists commands such as \frac, \alpha, \sum. Tab jumps between the {} slots.">
        <Switch on={s.mathComplete} label="Autocomplete LaTeX commands" onChange={(mathComplete) => s.set({ mathComplete })} />
      </Row>
      <div className="field" style={{ marginTop: 6 }}>
        <label>Try it</label>
        <textarea
          ref={assist.ref}
          className="textarea"
          rows={4}
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          onKeyDown={(e) => assist.onKeyDown(e)}
        />
        {assist.popup}
        <div className="math-preview" style={{ whiteSpace: 'pre-wrap' }}>
          <div className="math-preview-label">Preview</div>
          <MathText text={sample} />
        </div>
      </div>
      <table className="kbd-table">
        <tbody>
          <tr>
            <td>
              <code>$x^2$</code>
            </td>
            <td>inline formula</td>
          </tr>
          <tr>
            <td>
              <code>$$ … $$</code> or <code>\[ … \]</code>
            </td>
            <td>formula on its own line</td>
          </tr>
          <tr>
            <td>
              <code>\$</code>
            </td>
            <td>a literal dollar sign</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

function DataPage() {
  const [info, setInfo] = useState<DataFolderInfo | null>(null);
  const choose = useDataFolder((s) => s.choose);
  useEffect(() => {
    void backend.dataFolder().then(setInfo);
  }, []);
  if (!info) return null;
  return (
    <>
      <Row title="Data folder" hint={<span className="data-path">{info.dir}</span>}>
        {info.available && (
          <button className="btn outline" onClick={() => void backend.openDataDir()}>
            <Icon name="folder" size={16} /> Open
          </button>
        )}
        <button className="btn outline" onClick={() => void choose()}>
          Change…
        </button>
      </Row>
      <Row title="In this folder">{info.available ? describeLibrary(info) : 'The folder can’t be found'}</Row>
      {info.custom && (
        <Row title="Default folder" hint={<span className="data-path">{info.defaultDir}</span>}>
          <button className="btn outline" onClick={() => void choose(true)}>
            Use default
          </button>
        </Row>
      )}
      <div className="set-note">
        <Icon name="info" size={15} />
        <div>
          Your documents, notebooks and images live in the data folder. Move it to another drive to free up space, or into a folder your backup or
          sync service (OneDrive, Dropbox…) already covers. Don’t open the same synced library on two computers at once — their changes can
          overwrite each other. Settings and logs always stay in <span className="data-path">{info.defaultDir}</span>.
        </div>
      </div>
    </>
  );
}

function formatBytes(n: number) {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function UpdatesPage() {
  const s = useSettings();
  const { phase, result, checkedAt, progress, downloadError, check, download, install } = useUpdates();
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    void backend.appInfo().then(setInfo);
  }, []);
  const version = info?.version ?? __APP_VERSION__;
  const auto = info?.updateMode === 'auto';
  const unconfigured = isElectron && info?.updateMode === 'none';
  const found = result?.status === 'available' && (phase === 'available' || phase === 'downloading' || phase === 'ready');
  const released = result?.publishedAt ? ` (released ${formatDate(Date.parse(result.publishedAt))})` : '';

  const status =
    phase === 'checking'
      ? 'Checking for updates…'
      : phase === 'downloading'
        ? `Downloading ${result?.latest}… ${Math.round(progress?.percent ?? 0)}%${progress?.bytesPerSecond ? ` · ${formatBytes(progress.bytesPerSecond)}/s` : ''}`
        : phase === 'ready'
          ? `Version ${result?.latest} is downloaded. Restart MarginMap to install it.`
          : !result
            ? checkedAt || s.lastUpdateCheck
              ? `Last checked ${formatDate(checkedAt || s.lastUpdateCheck)}`
              : 'Not checked yet'
            : result.status === 'available'
              ? `Version ${result.latest} is available${released}.`
              : result.status === 'current'
                ? `You're up to date${result.latest ? ` — ${result.latest} is the latest version` : ''}.`
                : result.status === 'unconfigured'
                  ? 'This build has no update source configured.'
                  : result.status === 'unsupported'
                    ? 'Update checks are available in the desktop app.'
                    : `Could not check for updates: ${result.error}`;

  let action: ReactNode;
  if (phase === 'ready') {
    action = (
      <button className="btn primary" onClick={() => void install()}>
        <Icon name="refresh" size={16} /> Restart and install
      </button>
    );
  } else if (phase === 'downloading') {
    action = (
      <button className="btn outline" disabled>
        Downloading…
      </button>
    );
  } else if (found && result?.canInstall) {
    action = (
      <button className="btn primary" onClick={() => void download()}>
        <Icon name="import" size={16} /> Download update
      </button>
    );
  } else if (found && result?.url) {
    action = (
      <button className="btn primary" onClick={() => window.open(result.url, '_blank')}>
        <Icon name="import" size={16} /> Download page
      </button>
    );
  } else {
    action = (
      <button className="btn outline" disabled={phase === 'checking' || !isElectron || unconfigured} onClick={() => void check()}>
        <Icon name="refresh" size={16} /> {phase === 'checking' ? 'Checking…' : 'Check for updates'}
      </button>
    );
  }

  return (
    <>
      <div className="update-card">
        <div className="brand-mark" style={{ width: 40, height: 40, borderRadius: 11 }}>
          <Icon name="mindmap" size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 650, fontSize: 15 }}>MarginMap {version}</div>
          <div className="set-hint update-status">{status}</div>
          {phase === 'downloading' && (
            <div className="progress-bar update-progress">
              <div style={{ width: `${progress?.percent ?? 0}%` }} />
            </div>
          )}
        </div>
        {action}
      </div>
      {downloadError && <p className="set-hint update-error">Download failed: {downloadError}</p>}
      {found && result?.notes && (
        <div className="field">
          <label>What's new in {result.latest}</label>
          <div className="release-notes">{result.notes}</div>
        </div>
      )}
      {found && (
        <p className="set-hint">
          {result?.canInstall
            ? 'The update downloads in the background; MarginMap then restarts to install it. Your library is kept.'
            : 'This copy of MarginMap can’t update itself (portable version) — the download page opens in your browser. Your library is kept.'}
        </p>
      )}
      <Row
        title="Check automatically"
        hint={`Look for a new version when MarginMap starts (at most once a day).${auto ? ' Updates download only when you choose to.' : ''}`}
      >
        <Switch on={s.autoUpdate} label="Check automatically" onChange={(autoUpdate) => s.set({ autoUpdate })} />
      </Row>
      {info?.updateSource && (
        <Row title="Update source" hint={info.updateSource}>
          {auto ? 'In-app updates' : 'Download page'}
        </Row>
      )}
      {unconfigured && (
        <div className="set-note">
          <Icon name="info" size={15} />
          <div>
            To enable updates, set <code>owner</code> and <code>repo</code> under <code>build.publish</code> in <code>package.json</code> to your GitHub
            repository, then build a release.
          </div>
        </div>
      )}
    </>
  );
}

const SHORTCUTS: [string, [string, string][]][] = [
  [
    'Mind map',
    [
      ['Tab / Enter', 'Add child / sibling card'],
      ['F2 or double-click a text card', 'Rename'],
      ['Double-click a picture card', 'Enlarge'],
      ['Drag on empty space', 'Select several cards'],
      ['Ctrl+click / Shift+click', 'Add to selection'],
      ['Ctrl+A', 'Select all'],
      ['Ctrl+G / Ctrl+Shift+G', 'Group / ungroup selected cards'],
      ['Drag a card to empty space', 'Place it freely (Alt: detach)'],
      ['Right or middle drag', 'Pan'],
      ['Del', 'Delete selected cards'],
      ['Space', 'Locate in document (or click the card’s page tag)'],
      ['Ctrl+F', 'Find cards'],
    ],
  ],
  [
    'Whiteboard',
    [
      ['V / H', 'Select / pan (or hold Space)'],
      ['P / M', 'Pen / highlighter'],
      ['E', 'Eraser — press again to go back to the pen'],
      ['R / O / A / T', 'Rectangle / ellipse / arrow / text'],
      ['Pen eraser button', 'Erases while held'],
      ['Ctrl+G', 'Group selected cards'],
    ],
  ],
  [
    'Formulas',
    [
      ['$…$ / $$…$$', 'Inline / display formula'],
      ['\\ + letters', 'LaTeX command suggestions'],
      ['Tab', 'Next {} slot of an inserted command'],
    ],
  ],
  [
    'Everywhere',
    [
      ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
      ['Ctrl+,', 'Settings'],
      ['Ctrl+= / Ctrl+- / Ctrl+0', 'Reader zoom in / out / fit width'],
      ['Space, 1–4', 'Review: show answer, grade'],
    ],
  ],
];

function ShortcutsPage() {
  return (
    <>
      {SHORTCUTS.map(([group, rows]) => (
        <div key={group} className="field">
          <label>{group}</label>
          <table className="kbd-table">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <td>
                    {k.split(' / ').map((part, i) => (
                      <span key={i}>
                        {i > 0 && ' / '}
                        <span className="kbd">{part}</span>
                      </span>
                    ))}
                  </td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

function AboutPage() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    void backend.appInfo().then(setInfo);
  }, []);
  return (
    <>
      <p className="set-hint" style={{ fontSize: 13 }}>
        MarginMap — read PDFs, excerpt into mind maps, review with flashcards. An independent app inspired by the MarginNote workflow; it contains no MarginNote
        code or assets.
      </p>
      <Row title="Version">{info?.version ?? __APP_VERSION__}</Row>
      {info?.electron && (
        <Row title="Runtime">
          Electron {info.electron} · Chromium {info.chrome?.split('.')[0]}
        </Row>
      )}
      <Row title="License">MIT</Row>
    </>
  );
}
