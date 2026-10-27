import { useEffect } from 'react';
import { Download, RefreshCw, Smartphone } from 'lucide-react';
import { formatUpdateBytes, useAndroidUpdate } from '../lib/androidUpdates';

/**
 * Chunk 7C: Settings → About controls for the Android shell.
 *
 * Shows the installed version and the update state, and exposes the network
 * preference. Wi-Fi only is **off by default**: updates download over Wi-Fi or
 * mobile data, whichever is available, and only wait for Wi-Fi when the user
 * asks for that to save data.
 */
export function AndroidUpdateCard() {
  const { isAndroid, state, installed, busy, check, download, install, setWifiOnly, openInstallSettings } = useAndroidUpdate();

  // Keep the About card honest when it is opened long after launch.
  useEffect(() => {
    if (!isAndroid) return;
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAndroid]);

  if (!isAndroid) return null;

  const percent = state.total > 0 ? Math.min(100, Math.round((state.downloaded / state.total) * 100)) : 0;
  const ready = state.status === 'ready';
  const downloading = state.status === 'downloading';
  const available = state.status === 'available' || state.status === 'required';

  return (
    <div className="border-t border-ink-200 dark:border-white/10" data-testid="android-update-card">
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600/10 text-brand-600 dark:text-brand-300">
          <Smartphone className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Chatgram for Android</p>
          <p className="mt-0.5 text-[13px] text-ink-500 dark:text-ink-400">
            {installed ? `Version ${installed.version} (build ${installed.versionCode})` : 'Version…'}
            {state.version && state.status !== 'idle' ? ` · latest ${state.version}` : ''}
          </p>

          {downloading ? (
            <div className="mt-2">
              <div className="h-2 overflow-hidden rounded-full bg-ink-200 dark:bg-white/10">
                <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300" style={{ width: `${percent}%` }} />
              </div>
              <p className="mt-1 text-[11.5px] text-ink-500 dark:text-ink-400">
                {percent}%{state.total ? ` · ${formatUpdateBytes(state.downloaded)} of ${formatUpdateBytes(state.total)}` : ''}
              </p>
            </div>
          ) : null}

          {state.error ? <p className="mt-1 text-[11.5px] text-rose-600 dark:text-rose-400">{state.error}</p> : null}
          {ready ? (
            <p className="mt-1 text-[11.5px] text-emerald-600 dark:text-emerald-400">
              Downloaded and verified — tap install to finish.
            </p>
          ) : null}

          {state.notes ? (
            <details className="mt-2 text-[12px] text-ink-600 dark:text-ink-300">
              <summary className="cursor-pointer font-semibold text-brand-600 dark:text-brand-300">What&apos;s new</summary>
              <p className="mt-1 whitespace-pre-wrap leading-relaxed">{state.notes}</p>
            </details>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {ready ? (
              <button type="button" className="btn-primary !h-8 !px-3 !text-[12px]" onClick={() => void install()} data-testid="android-update-card-install">
                Install update
              </button>
            ) : available ? (
              <button type="button" className="btn-primary !h-8 !px-3 !text-[12px]" onClick={() => void download()} disabled={busy}>
                <Download className="h-3.5 w-3.5" /> Download update
              </button>
            ) : null}
            <button type="button" className="btn-ghost !h-8 !px-3 !text-[12px]" onClick={() => void check()} disabled={busy || downloading} data-testid="android-update-card-check">
              <RefreshCw className={`h-3.5 w-3.5 ${state.status === 'checking' ? 'animate-spin' : ''}`} />
              {state.status === 'checking' ? 'Checking…' : 'Check for updates'}
            </button>
            <button type="button" className="btn-ghost !h-8 !px-3 !text-[12px]" onClick={() => void openInstallSettings()}>
              Allow installs
            </button>
          </div>

          <label className="mt-3 flex items-start gap-2 text-[12.5px] text-ink-600 dark:text-ink-300">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-brand-600"
              checked={state.wifiOnly}
              onChange={(event) => void setWifiOnly(event.target.checked)}
              data-testid="android-update-wifi-only"
            />
            <span>
              <span className="block font-medium">Download updates over Wi-Fi only</span>
              <span className="block text-[11.5px] text-ink-400 dark:text-ink-500">
                Off (default): updates download over Wi-Fi or mobile data, whichever is available.
              </span>
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
