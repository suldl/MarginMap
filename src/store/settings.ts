import { create } from 'zustand';
import { backend } from '../backend';

export type ThemePref = 'system' | 'light' | 'dark';
export type AccentKey = 'blue' | 'violet' | 'green' | 'teal' | 'orange' | 'pink' | 'graphite';
export type EdgeStyle = 'curve' | 'elbow' | 'straight';
export type CanvasBg = 'dots' | 'grid' | 'plain';
/** What dragging on empty mind-map space with the left button does. */
export type MapDrag = 'select' | 'pan';

export interface Settings {
  theme: ThemePref;
  accent: AccentKey;
  /** Interface zoom factor (Electron page zoom). */
  uiScale: number;
  edgeStyle: EdgeStyle;
  canvasBg: CanvasBg;
  mapDrag: MapDrag;
  /** Render $…$ / $$…$$ as formulas. */
  math: boolean;
  /** Suggest LaTeX commands while typing a backslash. */
  mathComplete: boolean;
  /** Look for a new version when the app starts (at most once a day). */
  autoUpdate: boolean;
  lastUpdateCheck: number;
}

export const ACCENTS: { key: AccentKey; label: string; light: string; dark: string }[] = [
  { key: 'blue', label: 'Blue', light: '#3a66f0', dark: '#6b8fff' },
  { key: 'violet', label: 'Violet', light: '#7748e0', dark: '#a385ff' },
  { key: 'green', label: 'Green', light: '#1f9d55', dark: '#4cc983' },
  { key: 'teal', label: 'Teal', light: '#0f8f9a', dark: '#3cc4cf' },
  { key: 'orange', label: 'Orange', light: '#d9661c', dark: '#ff9a52' },
  { key: 'pink', label: 'Pink', light: '#d23f84', dark: '#ff7ab6' },
  { key: 'graphite', label: 'Graphite', light: '#4b4b55', dark: '#b4b4c0' },
];

export const UI_SCALES = [0.9, 1, 1.1, 1.25];

const DEFAULTS: Settings = {
  theme: 'system',
  accent: 'blue',
  uiScale: 1,
  edgeStyle: 'curve',
  canvasBg: 'dots',
  mapDrag: 'select',
  math: true,
  mathComplete: true,
  autoUpdate: true,
  lastUpdateCheck: 0,
};

const KEY = 'marginmap.settings';

function load(): Settings {
  try {
    const v = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } as Settings;
    if (!UI_SCALES.includes(v.uiScale)) v.uiScale = 1;
    if (!ACCENTS.some((a) => a.key === v.accent)) v.accent = 'blue';
    return v;
  } catch {
    return DEFAULTS;
  }
}

interface SettingsState extends Settings {
  set(patch: Partial<Settings>): void;
  reset(): void;
}

export const useSettings = create<SettingsState>((set) => ({
  ...load(),
  set: (patch) => set(patch),
  reset: () => set({ ...DEFAULTS, lastUpdateCheck: useSettings.getState().lastUpdateCheck }),
}));

function snapshot(s: SettingsState): Settings {
  const out = {} as Record<string, unknown>;
  for (const k of Object.keys(DEFAULTS)) out[k] = s[k as keyof Settings];
  return out as unknown as Settings;
}

/** On-screen spacing of the canvas background; a line grid thins out when zoomed out so it never becomes a mesh. */
export function gridSpacing(k: number, bg: CanvasBg) {
  const base = 22 * k;
  if (bg !== 'grid') return base;
  return base * (k < 0.45 ? 4 : k < 0.9 ? 2 : 1);
}

/** Syncs the native window controls with the current theme colours (and zoom). */
export function syncTitleBar() {
  const css = getComputedStyle(document.documentElement);
  backend.setTitleBar(css.getPropertyValue('--bg').trim(), css.getPropertyValue('--text').trim(), Math.round(40 * useSettings.getState().uiScale));
}

/** Applies the appearance settings to the document. */
export function applyAppearance(s: Settings = useSettings.getState()) {
  const root = document.documentElement;
  if (s.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = s.theme;
  if (s.accent === 'blue') delete root.dataset.accent;
  else root.dataset.accent = s.accent;
  root.dataset.canvas = s.canvasBg;
  backend.setZoom(s.uiScale);
  syncTitleBar();
}

useSettings.subscribe((s, prev) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot(s)));
  } catch {
    // storage unavailable
  }
  if (s.theme !== prev.theme || s.accent !== prev.accent || s.uiScale !== prev.uiScale || s.canvasBg !== prev.canvasBg) {
    applyAppearance(s);
  }
});
