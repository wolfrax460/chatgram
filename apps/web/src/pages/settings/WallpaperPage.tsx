import { useMemo, useRef, useState } from 'react';
import { Check, Image as ImageIcon, Loader2, RotateCcw, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { SettingsPageProps } from './types';
import { SettingsGroup, SettingsNotice, SettingsPage, SettingsCross, focusRing } from './ui';
import {
  WALLPAPER_PRESETS,
  presetSwatch,
  useResolvedScheme,
  useWallpaperActions,
  useWallpaperState,
  wallpaperChoiceFor,
  wallpaperLabel,
  wallpaperLook,
  type WallpaperChoice,
  type WallpaperScope,
} from '../../lib/wallpaper';

/** One fake bubble pair rendered over the chosen wallpaper (live preview). */
function WallpaperPreview({
  style,
  overlay,
  label,
  chatName,
}: {
  style: CSSProperties | null;
  overlay: 'none' | 'soft' | 'strong';
  label: string;
  chatName?: string;
}) {
  const overlayClass =
    overlay === 'strong' ? 'bg-white/60 dark:bg-ink-900/65' : overlay === 'soft' ? 'bg-white/35 dark:bg-ink-900/40' : '';
  return (
    <div
      data-testid="wallpaper-preview"
      aria-label={`Wallpaper preview: ${label}`}
      className="relative isolate h-44 w-full overflow-hidden rounded-2xl border border-ink-200 bg-ink-100 dark:border-white/10 dark:bg-ink-800"
    >
      <div className="absolute inset-0" style={style ?? undefined} aria-hidden="true" />
      {overlay !== 'none' ? <div className={`absolute inset-0 ${overlayClass}`} aria-hidden="true" /> : null}
      <div className="relative flex h-full flex-col justify-center gap-2 px-3">
        <div className="max-w-[78%] self-start rounded-2xl rounded-bl-md border border-ink-200/70 bg-white px-3 py-1.5 text-[12.5px] text-ink-800 shadow-sm dark:border-white/[.06] dark:bg-ink-700 dark:text-ink-100">
          How does it look, {chatName ?? 'friend'}?
        </div>
        <div className="max-w-[78%] self-end rounded-2xl rounded-br-md bg-brand-600 px-3 py-1.5 text-[12.5px] text-white shadow-sm">
          Looks good <Check className="ml-1 inline h-3 w-3" aria-hidden="true" />
        </div>
      </div>
      <span className="absolute bottom-1.5 left-2 rounded-full bg-black/35 px-2 py-0.5 text-[10.5px] font-semibold text-white">
        {label}
      </span>
    </div>
  );
}

/**
 * Wallpaper editor, shared by Settings → Chats → Wallpaper and by the chat
 * header "More → Wallpaper" sheet (same state, different scope availability).
 */
export function WallpaperEditor({ chatId, chatName, initialScope }: { chatId?: string; chatName?: string; initialScope?: 'all' | 'chat' }) {
  const scheme = useResolvedScheme();
  const state = useWallpaperState();
  // The chat-sheet entry point starts scoped to that chat (requirement 5); the
  // Settings page starts at the default for all chats.
  const [scopeKind, setScopeKind] = useState<'all' | 'chat'>(initialScope === 'chat' && chatId ? 'chat' : 'all');
  const scope: WallpaperScope = scopeKind === 'chat' && chatId ? { kind: 'chat', chatId } : { kind: 'all' };
  const { choose, reset, saveImage } = useWallpaperActions(scope);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const scopeChoice: WallpaperChoice = useMemo(
    () => (scope.kind === 'chat' ? wallpaperChoiceFor(state, scope.chatId) : state.default),
    [scope, state],
  );
  const look = useMemo(() => wallpaperLook(scopeChoice, scheme), [scopeChoice, scheme]);

  function apply(choice: WallpaperChoice) {
    setError('');
    setNotice('');
    const result = choose(choice);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(choice.kind === 'image' ? 'Wallpaper updated.' : `${wallpaperLabel(choice)} applied.`);
  }

  async function upload(file: File) {
    setUploading(true);
    setError('');
    setNotice('');
    try {
      const result = await saveImage(file);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice('Photo applied as wallpaper.');
    } finally {
      setUploading(false);
    }
  }

  function resetScope() {
    setError('');
    setNotice('');
    const result = reset();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(scope.kind === 'chat' ? 'This chat uses the default wallpaper again.' : 'All wallpapers reset.');
  }

  const options: { choice: WallpaperChoice; label: string }[] = [
    { choice: { kind: 'theme' }, label: 'Match theme' },
    { choice: { kind: 'none' }, label: 'None' },
  ];

  return (
    <div className="space-y-3">
      {error ? <SettingsNotice tone="error">{error}</SettingsNotice> : null}
      {notice ? <SettingsNotice tone="success">{notice}</SettingsNotice> : null}

      <WallpaperPreview style={look.style} overlay={look.overlay} label={wallpaperLabel(scopeChoice)} chatName={chatName} />

      {chatId ? (
        <div className="flex gap-2" role="group" aria-label="Where to apply the wallpaper">
          <button
            type="button"
            onClick={() => setScopeKind('all')}
            aria-pressed={scope.kind === 'all'}
            data-testid="wallpaper-scope-all"
            className={`flex-1 rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition ${focusRing} ${
              scope.kind === 'all'
                ? 'border-brand-600 bg-brand-600/10 text-brand-700 dark:text-brand-300'
                : 'border-ink-200 text-ink-600 hover:bg-ink-100/70 dark:border-white/10 dark:text-ink-300 dark:hover:bg-white/5'
            }`}
          >
            Apply to all chats
          </button>
          <button
            type="button"
            onClick={() => setScopeKind('chat')}
            aria-pressed={scope.kind === 'chat'}
            data-testid="wallpaper-scope-chat"
            className={`flex-1 rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition ${focusRing} ${
              scope.kind === 'chat'
                ? 'border-brand-600 bg-brand-600/10 text-brand-700 dark:text-brand-300'
                : 'border-ink-200 text-ink-600 hover:bg-ink-100/70 dark:border-white/10 dark:text-ink-300 dark:hover:bg-white/5'
            }`}
          >
            This chat only
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            aria-pressed={true}
            data-testid="wallpaper-scope-all"
            className={`flex-1 rounded-xl border border-brand-600 bg-brand-600/10 px-3 py-2 text-[12.5px] font-semibold text-brand-700 dark:text-brand-300 ${focusRing}`}
          >
            Apply to all chats
          </button>
          <button
            type="button"
            disabled
            data-testid="wallpaper-scope-chat"
            title="Open a chat and use More → Wallpaper to set a single chat"
            className="flex-1 rounded-xl border border-ink-200 px-3 py-2 text-[12.5px] font-semibold text-ink-400 opacity-60 dark:border-white/10 dark:text-ink-500"
          >
            This chat only
          </button>
        </div>
      )}

      <SettingsGroup title="Default options">
        <div className="grid grid-cols-2 gap-2 p-3">
          {options.map((option) => {
            const active = scopeChoice.kind === option.choice.kind;
            return (
              <button
                key={option.choice.kind}
                type="button"
                aria-pressed={active}
                onClick={() => apply(option.choice)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-[12.5px] font-semibold transition ${focusRing} ${
                  active
                    ? 'border-brand-600 ring-2 ring-brand-500/40'
                    : 'border-ink-200 hover:bg-ink-100/70 dark:border-white/10 dark:hover:bg-white/5'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-8 w-8 shrink-0 rounded-lg ${
                    option.choice.kind === 'theme'
                      ? 'bg-gradient-to-br from-white to-ink-300 dark:from-ink-700 dark:to-ink-900'
                      : 'border border-dashed border-ink-300 dark:border-white/20'
                  }`}
                />
                {option.label}
              </button>
            );
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Colours and patterns">
        <div className="grid grid-cols-4 gap-2 p-3 sm:grid-cols-4">
          {WALLPAPER_PRESETS.map((preset) => {
            const active = scopeChoice.kind === 'preset' && scopeChoice.presetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                data-testid="wallpaper-preset"
                data-preset-id={preset.id}
                aria-pressed={active}
                aria-label={`Wallpaper: ${preset.label}`}
                title={preset.label}
                onClick={() => apply({ kind: 'preset', presetId: preset.id })}
                className={`group relative flex flex-col items-center gap-1 rounded-xl p-1.5 transition ${focusRing} ${
                  active ? 'ring-2 ring-brand-500' : 'hover:bg-ink-100/70 dark:hover:bg-white/5'
                }`}
              >
                <span
                  aria-hidden="true"
                  className="h-12 w-full rounded-lg border border-ink-200/70 shadow-inner dark:border-white/10"
                  style={presetSwatch(preset, scheme)}
                />
                <span className="w-full truncate text-center text-[10.5px] font-semibold text-ink-600 dark:text-ink-300">
                  {preset.label}
                </span>
                {active ? (
                  <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-brand-600 text-white">
                    <Check className="h-2.5 w-2.5" aria-hidden="true" />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 border-t border-ink-100 px-3 py-3 dark:border-white/[.06]">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            data-testid="wallpaper-file-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void upload(file);
            }}
          />
          <button
            type="button"
            data-testid="wallpaper-upload"
            disabled={uploading}
            onClick={() => {
              setError('');
              fileRef.current?.click();
            }}
            className={`btn-primary flex-1 ${focusRing}`}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
            {uploading ? 'Preparing photo…' : 'Upload an image'}
          </button>
          {scopeChoice.kind === 'image' && !uploading ? <X className="h-4 w-4 text-ink-400" aria-hidden="true" /> : null}
        </div>
        <div className="px-3 pb-3">
          <SettingsCross>
            Photos stay on this device: they are resized to at most 1600 px, re-encoded (which removes EXIF/GPS data) and
            stored locally. Maximum file size 5 MB.
          </SettingsCross>
        </div>
      </SettingsGroup>

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="wallpaper-reset"
          onClick={resetScope}
          className={`btn-ghost ${focusRing}`}
        >
          <RotateCcw className="h-4 w-4" /> Reset {scope.kind === 'chat' ? 'this chat' : 'all chats'}
        </button>
        <p className="flex-1 text-right text-[11px] text-ink-500 dark:text-ink-400">
          Current: {wallpaperLabel(scopeChoice)}
        </p>
      </div>
    </div>
  );
}

/** Settings → Chats → Wallpaper page (default wallpaper for all chats). */
export default function WallpaperPage({ onBack }: SettingsPageProps) {
  return (
    <SettingsPage
      title="Wallpaper"
      description="A background for your conversations"
      onBack={onBack}
      testId="wallpaper-page"
    >
      <WallpaperEditor />
    </SettingsPage>
  );
}

