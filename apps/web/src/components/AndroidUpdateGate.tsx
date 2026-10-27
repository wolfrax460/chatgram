import { RotateCw, ShieldAlert } from 'lucide-react';
import { formatUpdateBytes, useAndroidUpdate } from '../lib/androidUpdates';

/**
 * Chunk 7C: blocking "Update required" screen.
 *
 * Shown when the server says the installed version is below
 * `minSupportedVersion` or a release is forced. It cannot be dismissed; it
 * downloads (Wi-Fi or mobile data) and then opens Android's installer.
 */
export function AndroidUpdateGate() {
  const { isAndroid, state, download, install, busy } = useAndroidUpdate();
  if (!isAndroid || !state.required) return null;

  const percent = state.total > 0 ? Math.min(100, Math.round((state.downloaded / state.total) * 100)) : 0;
  const ready = state.status === 'ready';
  const downloading = state.status === 'downloading';

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-ink-900/95 p-6 text-center" data-testid="android-update-gate">
      <div className="w-full max-w-sm">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-brand-600 text-white">
          <ShieldAlert className="h-8 w-8" />
        </span>
        <h2 className="mt-3 text-xl font-bold text-white">Update required</h2>
        <p className="mt-1 text-sm text-ink-200">
          {state.version
            ? `This version of Chatgram can no longer connect. Update to ${state.version} to keep chatting.`
            : 'This version of Chatgram can no longer connect.'}
        </p>

        <div className="mt-5">
          <div className="h-2 overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full bg-brand-400 transition-[width] duration-300" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-2 text-[12px] text-ink-300">
            {downloading
              ? `${percent}%${state.total ? ` · ${formatUpdateBytes(state.downloaded)} of ${formatUpdateBytes(state.total)}` : ''}`
              : ready
                ? 'Downloaded and verified. Tap install to finish.'
                : state.error || 'Preparing the update…'}
          </p>
        </div>

        <div className="mt-5 flex flex-col items-center gap-2">
          {ready ? (
            <button type="button" className="btn-primary w-full" onClick={() => void install()} data-testid="android-update-gate-install">
              <RotateCw className="mr-1.5 inline h-4 w-4" /> Install update
            </button>
          ) : (
            <button type="button" className="btn-primary w-full" onClick={() => void download()} disabled={busy || downloading}>
              {downloading ? 'Downloading…' : state.status === 'error' ? 'Try again' : 'Download and install'}
            </button>
          )}
          <p className="text-[11px] text-ink-400">
            {state.wifiOnly
              ? 'Wi-Fi only is on, so this waits for a Wi-Fi connection. Change it in Settings after updating.'
              : 'Downloading over Wi-Fi or mobile data, whichever is available.'}
          </p>
        </div>
      </div>
    </div>
  );
}
