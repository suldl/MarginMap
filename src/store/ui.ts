import type { ReactNode } from 'react';
import { create } from 'zustand';

export type Route = { name: 'library' } | { name: 'study'; notebookId: string } | { name: 'review'; notebookId: string | null };

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
  /** Optional button inside the toast. */
  action?: { label: string; run: () => void };
}

export type DialogRequest =
  | {
      kind: 'confirm';
      title: string;
      message: string;
      confirmLabel?: string;
      danger?: boolean;
      resolve: (ok: boolean) => void;
    }
  | {
      kind: 'prompt';
      title: string;
      label?: string;
      value: string;
      confirmLabel?: string;
      resolve: (value: string | null) => void;
    };

export interface MenuItem {
  label?: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  separator?: boolean;
  /** A non-interactive heading. */
  header?: string;
  /** Custom content (e.g. color swatches). */
  render?: (close: () => void) => ReactNode;
}

export type SettingsSection = 'appearance' | 'maps' | 'math' | 'updates' | 'shortcuts' | 'about';

interface UiState {
  route: Route;
  toasts: Toast[];
  dialog: DialogRequest | null;
  menu: { x: number; y: number; items: MenuItem[] } | null;
  /** Open settings section, or null when the settings window is closed. */
  settings: SettingsSection | null;
  navigate(route: Route): void;
  toast(text: string, kind?: Toast['kind'], action?: Toast['action']): void;
  dismissToast(id: number): void;
  confirm(opts: Omit<Extract<DialogRequest, { kind: 'confirm' }>, 'kind' | 'resolve'>): Promise<boolean>;
  prompt(opts: Omit<Extract<DialogRequest, { kind: 'prompt' }>, 'kind' | 'resolve'>): Promise<string | null>;
  closeDialog(): void;
  openMenu(x: number, y: number, items: MenuItem[]): void;
  closeMenu(): void;
  openSettings(section?: SettingsSection): void;
  closeSettings(): void;
}

let toastSeq = 0;

export const useUi = create<UiState>((set, get) => ({
  route: { name: 'library' },
  toasts: [],
  dialog: null,
  menu: null,
  settings: null,
  navigate: (route) => set({ route, menu: null }),
  toast(text, kind = 'info', action) {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, text, kind, action }] });
    setTimeout(() => get().dismissToast(id), action ? 9000 : kind === 'error' ? 6000 : 3000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  confirm: (opts) => new Promise((resolve) => set({ dialog: { kind: 'confirm', ...opts, resolve } })),
  prompt: (opts) => new Promise((resolve) => set({ dialog: { kind: 'prompt', ...opts, resolve } })),
  closeDialog: () => set({ dialog: null }),
  openMenu: (x, y, items) => set({ menu: { x, y, items } }),
  closeMenu: () => set({ menu: null }),
  openSettings: (section = 'appearance') => set({ settings: section, menu: null }),
  closeSettings: () => set({ settings: null }),
}));
