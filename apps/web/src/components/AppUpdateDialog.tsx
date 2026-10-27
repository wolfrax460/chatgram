import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { getCallState, subscribeCalls } from '../lib/calls';
import { saveComposerDraftForRefresh, useUpdateAvailable } from '../lib/appUpdate';
import { formatUpdateBytes, useAndroidUpdate } from '../lib/androidUpdates';

/**
 * One update dialog instead of a permanent banner.
 *
 * Rules (owner decision, supersedes the banner):
 *  - never a bar at the top of a chat or over the bottom navigation;
 *  - one centered dialog with the version, short notes, "Update now" + "Ignore";
 *  - "Ignore" remembers the version (localStorage on web, also honoured on the
 *    Android shell) and that version never prompts again - only a NEWER one does;
 *  - the update stays reachable in Settings -> About / App updates afterwards;
 *  - never shown during an active call (it is simply queued until the call ends).
 */
const IGNORED_KEY = 'chatgram.ignoredUpdateVersion';

function readIgnored(): string {
  try {
    return localStorage.getItem(IGNORED_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeIgnored(value: string): void {
  try {
    localStorage.setItem(IGNORED_KEY, value);
  } catch {
    /* storage is best-effort */
  }
}

const ACTIVE_CALL = new Set(['calling', 'incoming', 'connecting', 'reconnecting', 'active']);

export function AppUpdateDialog() {
  const web = useUpdateAvailable();
  const android = useAndroidUpdate();
  const call = useSyncExternalStore(subscribeCalls, getCallState);
  const [ignored, setIgnored] = useState(readIgnored);
  const [busy, setBusy] = useState(false);

  const token = android.isAndroid && android.state.version
    ? `android:${android.state.version}`
    : web.available && web.buildId
      ? `web:${web.buildId}`
      : '';

  const visible = Boolean(token) && token !== ignored && !ACTIVE_CALL.has(call.status);
  const downloading = android.state.status === 'downloading';
  const ready = android.state.status === 'ready';
  const percent = android.state.total > 0 ? Math.min(100, Math.round((android.state.downloaded / android.state.total) * 100)) : 0;

  useEffect(() => {
    // If the ignored token is cleared elsewhere (or a newer build appears), re-read.
    setIgnored(readIgnored());
  }, [token]);

  const ignore = useCallback(() => {
    if (!token) return;
    writeIgnored(token);
    setIgnored(token);
    web.dismiss();
  }, [token, web]);

  const updateNow = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    try {
      if (android.isAndroid) {
        if (ready) await android.install();
        else await android.download();
      } else {
        saveComposerDraftForRefresh();
        window.location.reload();
      }
    } finally {
      setBusy(false);
    }
  }, [token, android, ready]);

  if (!visible) return null;

  const versionLabel = android.isAndroid && android.state.version
    ? `Chatgram ${android.state.version}`
    : 'A new version of Chatgram';
  const notes = android.isAndroid ? android.state.notes : '';

  return (
    <div className="fixed inset-0 z-[75] grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="App update available" data-testid="app-update-dialog">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-ink-800">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600/10 text-brand-700 dark:text-brand-300">
              <RefreshCw className="h-4.5 w-4.5" />
            </span>
            <div>
              <p className="font-bold">{versionLabel} is available</p>
              <p className="text-[12px] text-ink-500 dark:text-ink-300">
                {android.isAndroid ? 'Update to keep everything working smoothly.' : 'Reload to get the latest build.'}
              </p>
            </div>
          </div>
          <button type="button" className="btn-ghost !px-1.5" aria-label="Dismiss" onClick={ignore}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {notes ? (
          <p className="mt-3 max-h-28 overflow-y-auto whitespace-pre-wrap rounded-lg bg-ink-100/70 p-2 text-[12px] text-ink-700 dark:bg-white/5 dark:text-ink-200">
            {notes}
          </p>
        ) : null}

        {android.isAndroid && (downloading || ready) ? (
          <div className="mt-3">
            <div className="h-2 overflow-hidden rounded-full bg-ink-200 dark:bg-white/10">
              <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300" style={{ width: `${ready ? 100 : percent}%` }} />
            </div>
            <p className="mt-1 text-[11.5px] text-ink-500 dark:text-ink-300">
              {ready
                ? 'Downloaded and verified - restart to update.'
                : `${percent}%${android.state.total ? ` of ${formatUpdateBytes(android.state.total)}` : ''}`}
            </p>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-ghost !h-9" onClick={ignore} data-testid="app-update-ignore">
            Ignore
          </button>
          <button type="button" className="btn-primary !h-9" onClick={() => void updateNow()} disabled={busy || downloading} data-testid="app-update-now">
            <Download className="mr-1 inline h-4 w-4" />
            {ready ? 'Restart to update' : downloading ? `Downloading ${percent}%` : 'Update now'}
          </button>
        </div>
        <p className="mt-2 text-right text-[11px] text-ink-400 dark:text-ink-500">
          You can always update later in Settings → About.
        </p>
      </div>
    </div>
  );
}
