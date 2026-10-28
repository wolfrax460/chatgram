import { useEffect, useState } from 'react';
import { CheckCircle2, Download, RefreshCw, RotateCcw, ShieldCheck, TriangleAlert } from 'lucide-react';
import {
  formatBytes,
  installedDesktopVersion,
  useDesktopUpdate,
  type DesktopUpdateState,
} from '../lib/desktopUpdates';

/**
 * Chunk 7B: Windows update controls inside Settings -> About.
 *
 * Progress and release notes live here (never over the app), so a background
 * download cannot interrupt what the user is doing.
 */
function statusLine(state: DesktopUpdateState): string {
  switch (state.status) {
    case 'checking':
      return 'Checking for updates…';
    case 'available':
      return state.version ? `Version ${state.version} is available.` : 'An update is available.';
    case 'downloading':
      return state.version ? `Downloading version ${state.version}…` : 'Downloading the update…';
    case 'ready':
      return state.version ? `Version ${state.version} is ready to install.` : 'The update is ready to install.';
    case 'error':
      return state.error || 'The last update check failed.';
    case 'required':
      return 'This version can no longer connect. An update is required.';
    default:
      return 'Chatgram is up to date.';
  }
}

/** Open the download page in the shell (or the browser) when auto-update is unavailable. */
function openDownloadPage(): void {
  // Open the installer itself from the direct host: an installed 1.1.3 has a
  // broken updater and its shell "downloads" page points at the wrong screen, so
  // the reliable action is the 82 MB file (Range-capable, resumable) straight
  // from the VM. Install it once; 1.1.4+ updates itself in the background.
  const direct = 'https://chatgram.duckdns.org/downloads/chatgram-windows-setup.exe';
  const opened = window.open(direct, '_blank', 'noopener');
  if (opened) return;
  const bridge = (window as unknown as { chatgramDesktop?: { updates?: { openDownloads?: () => Promise<boolean> } } })
    .chatgramDesktop;
  void bridge?.updates?.openDownloads?.().catch(() => undefined);
}
export function DesktopUpdateCard() {
  const { state, busy, check, download, install, setAutoDownload } = useDesktopUpdate();
  const [installed, setInstalled] = useState<string | null>(null);

  useEffect(() => {
    void installedDesktopVersion().then(setInstalled);
  }, []);

  // Web browser: nothing to show.
  if (!installed && state.status === 'idle' && state.devMode === false && !state.lastCheckedAt) return null;

  const percent = Math.max(0, Math.min(100, Math.round(state.percent || 0)));

  return (
    <div className="border-t border-ink-200 dark:border-white/10" data-testid="desktop-update-card">
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600/10 text-brand-600 dark:text-brand-300">
          <RotateCcw className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Chatgram for Windows{installed ? ` · ${installed}` : ''}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink-500 dark:text-ink-400">
            {state.status === 'error' || state.status === 'required' ? (
              <TriangleAlert className="h-3.5 w-3.5 text-rose-500" />
            ) : state.status === 'ready' ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            ) : null}
            <span>{statusLine(state)}</span>
          </p>

          {state.status === 'downloading' ? (
            <div className="mt-2">
              <div className="h-2 overflow-hidden rounded-full bg-ink-200 dark:bg-white/10">
                <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300" style={{ width: `${percent}%` }} />
              </div>
              <p className="mt-1 text-[11.5px] text-ink-500 dark:text-ink-400" data-testid="desktop-update-progress">
                {percent}%
                {state.total ? ` · ${formatBytes(state.transferred)} of ${formatBytes(state.total)}` : ''}
                {state.bytesPerSecond ? ` · ${formatBytes(state.bytesPerSecond)}/s` : ''}
              </p>
            </div>
          ) : null}

          {state.lastCheckedAt ? (
            <p className="mt-1 text-[11.5px] text-ink-400 dark:text-ink-500">
              Last checked {new Date(state.lastCheckedAt).toLocaleString()}
            </p>
          ) : null}

          {state.notes ? (
            <details className="mt-2 text-[12px] text-ink-600 dark:text-ink-300">
              <summary className="cursor-pointer font-semibold text-brand-600 dark:text-brand-300">What&apos;s new</summary>
              <p className="mt-1 whitespace-pre-wrap leading-relaxed">{state.notes}</p>
            </details>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {state.status === 'ready' ? (
              <button type="button" className="btn-primary !h-8 !px-3 !text-[12px]" onClick={() => void install()} data-testid="desktop-update-restart">
                <RotateCcw className="h-3.5 w-3.5" /> Restart to install
              </button>
            ) : null}
            {state.status === 'available' ? (
              <button type="button" className="btn-primary !h-8 !px-3 !text-[12px]" onClick={() => void download()}>
                <Download className="h-3.5 w-3.5" /> Download update
              </button>
            ) : null}
            {state.status === 'error' || state.devMode ? (
              // Auto-update cannot work in this build (electron-updater missing), so
              // give a button that actually does something: open the download page.
              <button
                type="button"
                className="btn-primary !h-8 !px-3 !text-[12px]"
                onClick={() => openDownloadPage()}
                data-testid="desktop-update-download-page"
              >
                <Download className="h-3.5 w-3.5" /> Download installer
              </button>
            ) : null}
            <button
              type="button"
              className="btn-ghost !h-8 !px-3 !text-[12px]"
              onClick={() => void check()}
              disabled={busy || state.status === 'downloading'}
              data-testid="desktop-update-check"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${state.status === 'checking' ? 'animate-spin' : ''}`} />
              {state.status === 'checking' ? 'Checking…' : 'Check for updates'}
            </button>
          </div>

          <label className="mt-3 flex items-center gap-2 text-[12.5px] text-ink-600 dark:text-ink-300">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-600"
              checked={state.autoDownload}
              onChange={(event) => void setAutoDownload(event.target.checked)}
              data-testid="desktop-update-auto"
            />
            Download updates automatically
          </label>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-ink-400 dark:text-ink-500">
            <ShieldCheck className="h-3 w-3" /> Updates are checked with your version and verified before installing.
          </p>
        </div>
      </div>
    </div>
  );
}
