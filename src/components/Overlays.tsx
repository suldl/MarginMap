import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useUi } from '../store/ui';
import { AnswerWindow } from './Answers';
import { DataFolderDialog } from './DataFolder';
import { Settings } from './Settings';

export function Overlays() {
  const settings = useUi((s) => s.settings);
  return (
    <>
      {settings && <Settings section={settings} />}
      <AnswerWindow />
      <DataFolderDialog />
      <Dialog />
      <ContextMenu />
      <Toasts />
    </>
  );
}

function Dialog() {
  const dialog = useUi((s) => s.dialog);
  const close = useUi((s) => s.closeDialog);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  /** Where keyboard focus was before the dialog opened (restored afterwards, e.g. to the mind map). */
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (dialog) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && !active.closest('.modal')) returnFocus.current = active;
    } else if (returnFocus.current) {
      const el = returnFocus.current;
      returnFocus.current = null;
      if (el.isConnected) el.focus({ preventScroll: true });
    }
    if (dialog?.kind === 'prompt') {
      setValue(dialog.value);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    } else if (dialog) {
      requestAnimationFrame(() => okRef.current?.focus());
    }
  }, [dialog]);

  if (!dialog) return null;

  const finish = (ok: boolean) => {
    close();
    if (dialog.kind === 'confirm') dialog.resolve(ok);
    else dialog.resolve(ok ? value.trim() : null);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && finish(false)}>
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          finish(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') finish(false);
        }}
      >
        <h3>{dialog.title}</h3>
        {dialog.kind === 'confirm' && <p>{dialog.message}</p>}
        {dialog.kind === 'prompt' && (
          <div className="field">
            {dialog.label && <label>{dialog.label}</label>}
            <input ref={inputRef} className="input" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn outline" onClick={() => finish(false)}>
            Cancel
          </button>
          <button
            ref={okRef}
            type="submit"
            className={`btn primary ${dialog.kind === 'confirm' && dialog.danger ? 'danger' : ''}`}
            disabled={dialog.kind === 'prompt' && !value.trim()}
          >
            {dialog.confirmLabel ?? 'OK'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ContextMenu() {
  const menu = useUi((s) => s.menu);
  const close = useUi((s) => s.closeMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.min(menu.x, window.innerWidth - r.width - 8),
      y: Math.min(menu.y, window.innerHeight - r.height - 8),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [menu, close]);

  if (!menu) return null;
  return (
    <div ref={ref} className="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {menu.items.map((item, i) =>
        item.separator ? (
          <div key={i} className="menu-sep" />
        ) : item.header ? (
          <div key={i} className="menu-head">
            {item.header}
          </div>
        ) : item.render ? (
          <div key={i} className="menu-custom">
            {item.render(close)}
          </div>
        ) : (
          <button
            key={i}
            className={`menu-item ${item.danger ? 'danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              close();
              item.onClick?.();
            }}
          >
            {item.label}
            {item.shortcut && <span className="shortcut">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}

function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.text}
          {t.action && (
            <button
              className="toast-action"
              onClick={(e) => {
                e.stopPropagation();
                dismiss(t.id);
                t.action!.run();
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
