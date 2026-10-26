import { useState, useSyncExternalStore } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { getCallState, subscribeCalls } from '../lib/calls';
import { saveComposerDraftForRefresh, useUpdateAvailable } from '../lib/appUpdate';

/**
 * Chunk 7D: "A new version of Chatgram is available. Refresh".
 *
 * The banner only appears when the deployed /web/version.json build id differs
 * from the one this page loaded with. It never reloads by itself, and it is
 * hidden entirely while a call is active so a refresh can never interrupt one.
 * Pressing Refresh keeps a typed composer draft (localStorage, try/catch).
 */
const ACTIVE_CALL_STATUSES = new Set(['calling', 'incoming', 'connecting', 'reconnecting', 'active']);

export function UpdateBanner() {
  const { available, dismiss } = useUpdateAvailable();
  const callState = useSyncExternalStore(subscribeCalls, getCallState);
  const [refreshing, setRefreshing] = useState(false);

  if (!available) return null;
  // Never cover or interrupt a live call with an update prompt.
  if (ACTIVE_CALL_STATUSES.has(callState.status)) return null;

  function refresh() {
    setRefreshing(true);
    saveComposerDraftForRefresh();
    window.location.reload();
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="update-banner"
      className="fixed inset-x-0 top-0 z-[65] flex items-center justify-center gap-3 border-b border-brand-600/30 bg-brand-600 px-3 py-2 text-[12.5px] font-semibold text-white shadow-sm"
    >
      <span>A new version of Chatgram is available.</span>
      <button
        type="button"
        onClick={refresh}
        disabled={refreshing}
        className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[12px] font-bold hover:bg-white/25 disabled:opacity-60"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="ml-1 rounded-full p-1 hover:bg-white/15"
        aria-label="Dismiss update notice"
        title="Dismiss"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
