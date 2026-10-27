import { useState } from 'react';
import { Download, RotateCcw, X } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { getCallState, subscribeCalls } from '../lib/calls';
import { useDesktopUpdate } from '../lib/desktopUpdates';

/**
 * Chunk 7B: "Update ready: Restart to install" for the Windows shell.
 *
 * The shell downloads in the background and installs on quit by itself, so this
 * banner is only a shortcut. It never restarts anything on its own, and it stays
 * out of the way of a live call.
 */
const ACTIVE_CALL_STATUSES = new Set(['calling', 'incoming', 'connecting', 'reconnecting', 'active']);

export function DesktopUpdateBanner() {
  const { api, state, install, download } = useDesktopUpdate();
  const [dismissed, setDismissed] = useState(false);
  const callState = useSyncExternalStore(subscribeCalls, getCallState);

  if (!api) return null;
  if (state.status !== 'ready' && !(state.status === 'available' && !state.autoDownload)) return null;
  if (callState.status && ACTIVE_CALL_STATUSES.has(callState.status)) return null;
  if (dismissed) return null;

  const ready = state.status === 'ready';

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="desktop-update-banner"
      className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-3 border-b border-brand-600/30 bg-brand-700 px-3 py-2 text-[12.5px] font-semibold text-white shadow-lg"
    >
      <span>
        {ready
          ? `Update ready${state.version ? ` (${state.version})` : ''}: restart to install.`
          : `Update available${state.version ? ` (${state.version})` : ''}.`}
      </span>
      {ready ? (
        <button
          type="button"
          className="rounded-lg bg-white/15 px-2.5 py-1 font-bold hover:bg-white/25"
          onClick={() => void install()}
          data-testid="desktop-update-banner-restart"
        >
          <RotateCcw className="mr-1 inline h-3.5 w-3.5" /> Restart now
        </button>
      ) : (
        <button
          type="button"
          className="rounded-lg bg-white/15 px-2.5 py-1 font-bold hover:bg-white/25"
          onClick={() => void download()}
        >
          <Download className="mr-1 inline h-3.5 w-3.5" /> Download
        </button>
      )}
      <button type="button" aria-label="Dismiss update notice" className="ml-1 rounded p-0.5 hover:bg-white/20" onClick={() => setDismissed(true)}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
