/**
 * Chat wallpaper: a curated CSS-only preset set, an optional uploaded image and
 * a per-chat override, persisted locally under `chatgram.wallpaper.v1`.
 *
 * Storage shape (versioned, validated on read — malformed entries are dropped):
 *   { default: WallpaperChoice, perChat: Record<chatId, WallpaperChoice> }
 *
 * No server change and no external assets: presets are inline CSS gradients /
 * colours, uploads are re-encoded through a canvas (which also strips EXIF) and
 * stored as compressed data URLs.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useTheme } from '@chatgram/core';

export const WALLPAPER_STORAGE_KEY = 'chatgram.wallpaper.v1';
export const MAX_WALLPAPER_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_WALLPAPER_DIMENSION = 1600;
/** Leave room in the ~5 MB localStorage budget for the rest of the profile. */
const MAX_DATA_URL_CHARS = 3_500_000;

export type WallpaperScheme = 'light' | 'dark';

export type WallpaperChoice =
  | { kind: 'none' }
  | { kind: 'theme' }
  | { kind: 'preset'; presetId: string }
  | { kind: 'image'; dataUrl: string };

export interface WallpaperState {
  default: WallpaperChoice;
  perChat: Record<string, WallpaperChoice>;
}

export interface WallpaperPreset {
  id: string;
  label: string;
  light: CSSProperties;
  dark: CSSProperties;
}

const solid = (lightColor: string, darkColor: string): Pick<WallpaperPreset, 'light' | 'dark'> => ({
  light: { backgroundColor: lightColor },
  dark: { backgroundColor: darkColor },
});

const gradient = (lightColors: string[], darkColors: string[]): Pick<WallpaperPreset, 'light' | 'dark'> => ({
  light: { backgroundImage: `linear-gradient(160deg, ${lightColors.join(', ')})` },
  dark: { backgroundImage: `linear-gradient(160deg, ${darkColors.join(', ')})` },
});

/** 3 solids + 3 gradients + 2 subtle CSS patterns (no external assets). */
export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  { id: 'sage', label: 'Sage', ...solid('#e7f0ec', '#0f1a16') },
  { id: 'sand', label: 'Sand', ...solid('#f3efe4', '#1b1914') },
  { id: 'slate', label: 'Slate', ...solid('#edf0f3', '#111820') },
  { id: 'teal-mist', label: 'Teal mist', ...gradient(['#e6f4f1', '#d5ece6', '#c2e5dd'], ['#0b1f1b', '#0e2a25', '#123631']) },
  { id: 'dusk', label: 'Dusk', ...gradient(['#f2eef9', '#e7e2f4', '#dcd5ee'], ['#171226', '#1d1730', '#241c3a']) },
  { id: 'sunrise', label: 'Sunrise', ...gradient(['#fdf1e7', '#fbe3d4', '#f6d5c2'], ['#231711', '#2c1c14', '#35231a']) },
  {
    id: 'dots',
    label: 'Dots',
    light: {
      backgroundColor: '#eef2f0',
      backgroundImage: 'radial-gradient(rgba(0, 128, 105, 0.14) 1px, transparent 1px)',
      backgroundSize: '16px 16px',
    },
    dark: {
      backgroundColor: '#0f1a17',
      backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.07) 1px, transparent 1px)',
      backgroundSize: '16px 16px',
    },
  },
  {
    id: 'grid',
    label: 'Grid',
    light: {
      backgroundColor: '#eff2f1',
      backgroundImage:
        'linear-gradient(rgba(0, 128, 105, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 128, 105, 0.08) 1px, transparent 1px)',
      backgroundSize: '28px 28px',
    },
    dark: {
      backgroundColor: '#101917',
      backgroundImage:
        'linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px)',
      backgroundSize: '28px 28px',
    },
  },
];

const PRESET_IDS = new Set(WALLPAPER_PRESETS.map((preset) => preset.id));

export function wallpaperPreset(id: string | undefined): WallpaperPreset | undefined {
  return WALLPAPER_PRESETS.find((preset) => preset.id === id);
}

/* -------------------------------------------------------------- validation */

function isChoice(value: unknown): value is WallpaperChoice {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WallpaperChoice> & { presetId?: unknown; dataUrl?: unknown };
  switch (candidate.kind) {
    case 'none':
    case 'theme':
      return true;
    case 'preset':
      return typeof candidate.presetId === 'string' && PRESET_IDS.has(candidate.presetId);
    case 'image':
      return (
        typeof candidate.dataUrl === 'string' &&
        candidate.dataUrl.startsWith('data:image/') &&
        candidate.dataUrl.length > 32 &&
        candidate.dataUrl.length <= MAX_DATA_URL_CHARS
      );
    default:
      return false;
  }
}

export const EMPTY_WALLPAPER_STATE: WallpaperState = { default: { kind: 'theme' }, perChat: {} };

/** Parse + validate the persisted state; unknown fields/entries are dropped. */
export function parseWallpaperState(raw: string | null): WallpaperState {
  if (!raw) return EMPTY_WALLPAPER_STATE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_WALLPAPER_STATE;
  }
  if (!parsed || typeof parsed !== 'object') return EMPTY_WALLPAPER_STATE;
  const record = parsed as { default?: unknown; perChat?: unknown };
  const next: WallpaperState = {
    default: isChoice(record.default) ? record.default : { kind: 'theme' },
    perChat: {},
  };
  if (record.perChat && typeof record.perChat === 'object') {
    for (const [chatId, choice] of Object.entries(record.perChat as Record<string, unknown>)) {
      if (!chatId || !isChoice(choice)) continue;
      next.perChat[chatId] = choice;
    }
  }
  return next;
}

/* ------------------------------------------------------------------- store */

let cachedState: WallpaperState | null = null;
let cachedRaw: string | null = null;
const listeners = new Set<() => void>();
let storageListenerAttached = false;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(WALLPAPER_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getWallpaperState(): WallpaperState {
  const raw = readRaw();
  if (cachedState && raw === cachedRaw) return cachedState;
  cachedRaw = raw;
  cachedState = parseWallpaperState(raw);
  return cachedState;
}

function notify(): void {
  cachedState = null;
  cachedRaw = null;
  for (const listener of listeners) listener();
}

function attachStorageListener(): void {
  if (storageListenerAttached || typeof window === 'undefined') return;
  storageListenerAttached = true;
  window.addEventListener('storage', (event) => {
    if (event.key === WALLPAPER_STORAGE_KEY || event.key === null) notify();
  });
}

export function subscribeWallpaper(listener: () => void): () => void {
  attachStorageListener();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export type WallpaperSaveResult = { ok: true } | { ok: false; error: string };

function persist(state: WallpaperState): WallpaperSaveResult {
  try {
    window.localStorage.setItem(WALLPAPER_STORAGE_KEY, JSON.stringify(state));
    notify();
    return { ok: true };
  } catch (error) {
    const quota =
      error instanceof DOMException &&
      (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    return {
      ok: false,
      error: quota
        ? 'That image is too large to store — try a smaller one'
        : 'The wallpaper could not be saved on this device',
    };
  }
}

export type WallpaperScope = { kind: 'all' } | { kind: 'chat'; chatId: string };

export function wallpaperChoiceFor(state: WallpaperState, chatId?: string): WallpaperChoice {
  if (chatId) {
    const perChat = state.perChat[chatId];
    if (perChat) return perChat;
  }
  return state.default;
}

/** Replace the choice for one scope (all chats or one chat). */
export function setWallpaper(scope: WallpaperScope, choice: WallpaperChoice): WallpaperSaveResult {
  const current = getWallpaperState();
  const next: WallpaperState =
    scope.kind === 'chat'
      ? { default: current.default, perChat: { ...current.perChat, [scope.chatId]: choice } }
      : { default: choice, perChat: current.perChat };
  return persist(next);
}

/** Reset one scope: all chats clears overrides too, a chat drops its override. */
export function resetWallpaper(scope: WallpaperScope): WallpaperSaveResult {
  const current = getWallpaperState();
  if (scope.kind === 'chat') {
    const perChat = { ...current.perChat };
    delete perChat[scope.chatId];
    return persist({ default: current.default, perChat });
  }
  return persist({ default: { kind: 'theme' }, perChat: {} });
}

/* -------------------------------------------------------------- appearance */

export function useWallpaperState(): WallpaperState {
  return useSyncExternalStore(subscribeWallpaper, getWallpaperState, getWallpaperState);
}

/** Resolve `system` against the OS preference, mirroring the theme store. */
export function useResolvedScheme(): WallpaperScheme {
  const mode = useTheme((state) => state.mode);
  const [systemDark, setSystemDark] = useState<boolean>(() => {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(query.matches);
    setSystemDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return mode === 'dark' || (mode === 'system' && systemDark) ? 'dark' : 'light';
}

/** Contrast overlay strength needed behind bubbles/text for WCAG AA. */
export type WallpaperOverlay = 'none' | 'soft' | 'strong';

export interface WallpaperLook {
  choice: WallpaperChoice;
  /** Null for none/theme: the existing app background stays untouched. */
  style: CSSProperties | null;
  overlay: WallpaperOverlay;
}

export function wallpaperLook(choice: WallpaperChoice, scheme: WallpaperScheme): WallpaperLook {
  switch (choice.kind) {
    case 'preset': {
      const preset = wallpaperPreset(choice.presetId);
      if (!preset) return { choice, style: null, overlay: 'none' };
      return {
        choice,
        style: {
          ...(scheme === 'dark' ? preset.dark : preset.light),
          backgroundAttachment: 'scroll',
          backgroundRepeat: 'repeat',
        },
        overlay: 'soft',
      };
    }
    case 'image':
      return {
        choice,
        style: {
          backgroundImage: `url("${choice.dataUrl}")`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundAttachment: 'scroll',
        },
        overlay: 'strong',
      };
    default:
      return { choice, style: null, overlay: 'none' };
  }
}

/** The look for a chat (override or default); subscribes to wallpaper changes. */
export function useChatWallpaper(chatId?: string): WallpaperLook {
  const state = useWallpaperState();
  const scheme = useResolvedScheme();
  const choice = wallpaperChoiceFor(state, chatId);
  return useMemo(() => wallpaperLook(choice, scheme), [choice, scheme]);
}

export function useHasChatOverride(chatId?: string): boolean {
  const state = useWallpaperState();
  return Boolean(chatId && state.perChat[chatId]);
}

/* ------------------------------------------------------------------ upload */

export class WallpaperError extends Error {}

function loadImageSource(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file)
      .then((bitmap) => ({
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      }))
      .catch(() => loadImageElement(file));
  }
  return loadImageElement(file);
}

function loadImageElement(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  const objectUrl = URL.createObjectURL(file);
  const release = () => URL.revokeObjectURL(objectUrl);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight, release });
    image.onerror = () => {
      release();
      reject(new WallpaperError('That file is not an image. Choose a JPG, PNG or WebP.'));
    };
    image.src = objectUrl;
  });
}

/**
 * Validate an upload, downscale it to <=1600 px and store it as a compressed
 * JPEG data URL (re-encoding strips EXIF/GPS metadata). Throws WallpaperError
 * with a user-facing message for every rejection.
 */
export async function prepareWallpaperImage(file: File): Promise<string> {
  if (file.type && !file.type.startsWith('image/')) {
    throw new WallpaperError('That file is not an image. Choose a JPG, PNG or WebP.');
  }
  if (file.size > MAX_WALLPAPER_FILE_BYTES) {
    throw new WallpaperError('That image is larger than 5 MB. Choose a smaller one.');
  }
  const loaded = await loadImageSource(file);
  try {
    if (!loaded.width || !loaded.height) {
      throw new WallpaperError('That image could not be read. Try a different file.');
    }
    const attempts: { dimension: number; quality: number }[] = [
      { dimension: MAX_WALLPAPER_DIMENSION, quality: 0.82 },
      { dimension: MAX_WALLPAPER_DIMENSION, quality: 0.68 },
      { dimension: 1200, quality: 0.68 },
      { dimension: 900, quality: 0.62 },
    ];
    for (const attempt of attempts) {
      const scale = Math.min(1, attempt.dimension / Math.max(loaded.width, loaded.height));
      const width = Math.max(1, Math.round(loaded.width * scale));
      const height = Math.max(1, Math.round(loaded.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new WallpaperError('This browser cannot process images for the wallpaper.');
      // Transparent PNGs would turn black in JPEG: paint a neutral base first.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(loaded.source, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', attempt.quality);
      if (dataUrl.startsWith('data:image/jpeg') && dataUrl.length <= MAX_DATA_URL_CHARS) {
        return dataUrl;
      }
    }
    throw new WallpaperError('That image is too large to store — try a smaller one');
  } finally {
    loaded.release();
  }
}

/** Shared clipboard-free helpers for the editor/preview. */
export function useWallpaperActions(scope: WallpaperScope): {
  choose: (choice: WallpaperChoice) => WallpaperSaveResult;
  reset: () => WallpaperSaveResult;
  saveImage: (file: File) => Promise<{ ok: true } | { ok: false; error: string }>;
} {
  const choose = useCallback((choice: WallpaperChoice) => setWallpaper(scope, choice), [scope]);
  const reset = useCallback(() => resetWallpaper(scope), [scope]);
  const saveImage = useCallback(
    async (file: File) => {
      try {
        const dataUrl = await prepareWallpaperImage(file);
        return setWallpaper(scope, { kind: 'image', dataUrl });
      } catch (error) {
        return {
          ok: false,
          error: error instanceof WallpaperError ? error.message : 'That image could not be stored.',
        };
      }
    },
    [scope],
  );
  return { choose, reset, saveImage };
}

/** Theme-aware swatch style for the preset grid. */
export function presetSwatch(preset: WallpaperPreset, scheme: WallpaperScheme): CSSProperties {
  return scheme === 'dark' ? preset.dark : preset.light;
}

/** Human label for a choice (used by Settings/chat menu rows). */
export function wallpaperLabel(choice: WallpaperChoice): string {
  switch (choice.kind) {
    case 'none':
      return 'None';
    case 'theme':
      return 'Match theme';
    case 'preset':
      return wallpaperPreset(choice.presetId)?.label ?? 'Preset';
    case 'image':
      return 'Your photo';
  }
}
