import { Download, Smartphone, X } from 'lucide-react';
import { formatUpdateBytes, useAndroidUpdate } from '../lib/androidUpdates';

/**
 * Chunk 7C: "Update ready: tap to install" for the Android shell.
 *
 * The shell is the only place that can install — this banner downloads and then
 * opens Android's installer (one tap). It never blocks the app; a *required*
 * update is shown by `AndroidUpdateGate` instead.
 *
 * Downloads work over Wi-Fi **or mobile data**, whichever is available, unless
 * the user opted into Wi-Fi only in Settings.
 */
export function AndroidUpdateBanner() {
  const { isAndroid, state, installed, download, install, dismiss, busy } = useAndroidUpdate();
  if (!isAndroid) return null;
  if (state.status === 'required') return null; // the gate owns that case
  if (state.status === 'idle' || state.status === 'checking') return null;

  const percent = state.total > 0 ? Math.min(100, Math.round((state.downloaded / state.total) * 100)) : 0;
  const ready = state.status === 'ready';

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="android-update-banner"
      className="fixed inset-x-0 top-0 z-[60] border-b border-brand-600/30 bg-brand-700 px-3 py-2 text-[12.5px] font-semibold text-white shadow-lg"
    >
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-2">
        <Smartphone className="h-4 w-4 shrink-0" />
        {state.status === 'downloading' ? (
          <span>
            Downloading update {state.version ? `(${state.version})` : ''}
            {state.total > 0 ? ` · ${percent}% of ${formatUpdateBytes(state.total)}` : '…'}
          </span>
        ) : state.status === 'error' ? (
          <span>{state.error || 'The update could not be downloaded.'}</span>
        ) : ready ? (
          <span>Update ready{state.version ? ` (${state.version})` : ''}: tap to install.</span>
        ) : (
          <span>
            Update available{state.version ? ` (${state.version})` : ''}
            {installed?.version ? ` · you have ${installed.version}` : ''}.
          </span>
        )}

        {state.status === 'downloading' && state.total > 0 ? (
          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-white/25">
            <span className="block h-full rounded-full bg-white" style={{ width: `${percent}%` }} />
          </span>
        ) : null}

        {ready ? (
          <button
            type="button"
            className="rounded-lg bg-white/15 px-2.5 py-1 font-bold hover:bg-white/25"
            onClick={() => void install()}
            data-testid="android-update-install"
          >
            Tap to install
          </button>
        ) : null}
        {state.status === 'available' || state.status === 'error' ? (
          <button
            type="button"
            className="rounded-lg bg-white/15 px-2.5 py-1 font-bold hover:bg-white/25"
            onClick={() => void download()}
            disabled={busy}
          >
            <Download className="mr-1 inline h-3.5 w-3.5" /> Download
          </button>
        ) : null}
        {!ready && state.status !== 'downloading' ? (
          <button
            type="button"
            aria-label="Dismiss update notice"
            className="ml-1 rounded p-0.5 hover:bg-white/20"
            onClick={() => void dismiss()}
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-center text-[10.5px] font-medium text-white/70">
        {state.wifiOnly ? 'Downloads wait for Wi-Fi (Wi-Fi only is on).' : 'Downloads over Wi-Fi or mobile data, whichever is available.'}
      </p>
    </div>
  );
}
