import { useEffect, useState } from 'react';
import { Download, HardDrive, Trash2, Wifi } from 'lucide-react';
import type { SettingsPageProps } from './types';
import { SettingsGroup, SettingsNotice, SettingsPage, SettingsRow, SettingsSpinner, SettingsCross, focusRing } from './ui';

interface StorageFacts {
  /** Total origin usage in bytes when the browser reports it. */
  used: number | null;
  quota: number | null;
  cacheEntries: number | null;
  /** Bytes estimated from the Cache Storage responses we can read. */
  cachedBytes: number | null;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Storage: estimates from the browser only, never invented. */
export default function StoragePage({ onBack }: SettingsPageProps) {
  const [facts, setFacts] = useState<StorageFacts>({ used: null, quota: null, cacheEntries: null, cachedBytes: null });
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function measure() {
    setLoading(true);
    setError('');
    try {
      let used: number | null = null;
      let quota: number | null = null;
      if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate();
        used = typeof estimate.usage === 'number' ? estimate.usage : null;
        quota = typeof estimate.quota === 'number' ? estimate.quota : null;
      }
      let cacheEntries: number | null = null;
      let cachedBytes: number | null = null;
      if (typeof caches !== 'undefined') {
        const names = await caches.keys();
        cacheEntries = names.length;
        let bytes = 0;
        for (const name of names) {
          const cache = await caches.open(name);
          const requests = await cache.keys();
          for (const request of requests) {
            const response = await cache.match(request);
            const length = Number(response?.headers.get('content-length') ?? 0);
            bytes += Number.isFinite(length) ? length : 0;
          }
        }
        cachedBytes = bytes;
      }
      setFacts({ used, quota, cacheEntries, cachedBytes });
    } catch {
      setError('The browser did not report storage usage on this device.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void measure();
  }, []);

  async function clearCache() {
    setClearing(true);
    setError('');
    setNotice('');
    try {
      // Only the origin's Cache Storage (media/app shell bytes). Chats, settings
      // and the session are untouched, so clearing never signs the user out.
      if (typeof caches !== 'undefined') {
        const names = await caches.keys();
        await Promise.all(names.map((name) => caches.delete(name)));
      }
      setNotice('Cache cleared. Messages are downloaded again as you open chats.');
      await measure();
    } catch {
      setError('Could not clear the cache on this device.');
    } finally {
      setClearing(false);
    }
  }

  const quotaPercent =
    facts.used !== null && facts.quota ? Math.min(100, Math.round((facts.used / facts.quota) * 100)) : null;

  return (
    <SettingsPage title="Storage and data" description="What Chatgram keeps on this device" onBack={onBack} testId="settings-page-storage">
      {error ? <div className="mb-2"><SettingsNotice tone="error">{error}</SettingsNotice></div> : null}
      {notice ? <div className="mb-2"><SettingsNotice tone="success">{notice}</SettingsNotice></div> : null}

      <SettingsGroup title="Storage used">
        {loading ? (
          <SettingsSpinner label="Measuring storage…" />
        ) : (
          <div className="px-4 py-3" data-testid="settings-storage-usage">
            <p className="text-[20px] font-bold">{formatBytes(facts.used)}</p>
            <p className="text-[12px] text-ink-500 dark:text-ink-400">
              {facts.quota !== null ? `of ${formatBytes(facts.quota)} the browser allows` : 'reported by this browser'}
            </p>
            {quotaPercent !== null ? (
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-200 dark:bg-white/10" role="img" aria-label={`${quotaPercent}% of the storage allowance used`}>
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.max(2, quotaPercent)}%` }} />
              </div>
            ) : null}
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-600 dark:text-ink-300">
              {facts.cacheEntries === null
                ? 'Cache Storage is not available in this browser.'
                : `${facts.cacheEntries} cache${facts.cacheEntries === 1 ? '' : 's'} on this device${facts.cachedBytes !== null ? ` · roughly ${formatBytes(facts.cachedBytes)} of cached media and app files` : ''}.`}
            </p>
          </div>
        )}
        <div className="border-t border-ink-100 dark:border-white/[.06]">
          <button
            type="button"
            onClick={() => void clearCache()}
            disabled={clearing}
            data-testid="settings-clear-cache"
            className={`flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-ink-100/70 disabled:opacity-60 dark:hover:bg-white/[.04] ${focusRing}`}
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600/10 text-brand-600 dark:text-brand-300" aria-hidden="true">
              <Trash2 className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Clear cache</span>
              <span className="block text-[13px] text-ink-500 dark:text-ink-400">
                {clearing ? 'Clearing…' : 'Frees cached media. Does not sign you out.'}
              </span>
            </span>
          </button>
        </div>
        <div className="px-4 pb-3">
          <button type="button" className={`text-[12px] font-semibold text-brand-700 underline dark:text-brand-300 ${focusRing}`} onClick={() => void measure()}>
            Recount storage
          </button>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Automatic download">
        <SettingsRow
          icon={Download}
          title="When to download media"
          subtitle="Wi-Fi vs mobile data rules"
          badge="Coming soon"
          disabled
          testId="settings-auto-download"
        />
        <SettingsRow
          icon={Wifi}
          title="Data saver for calls"
          subtitle="Use less mobile data during voice and video calls"
          badge="Coming soon"
          disabled
          testId="settings-data-saver"
        />
        <div className="px-4 pb-3">
          <SettingsCross>
            Download rules and call data saving need the media and WebRTC layers, which are owned elsewhere; there is
            no server setting for them yet, so they are shown disabled rather than pretended.
          </SettingsCross>
        </div>
      </SettingsGroup>

      <SettingsGroup>
        <div className="flex items-center gap-2 px-4 py-3 text-[11.5px] leading-relaxed text-ink-500 dark:text-ink-400">
          <HardDrive className="h-4 w-4 shrink-0" aria-hidden="true" />
          Estimates come from this browser&apos;s storage API. Chatgram does not upload your storage numbers.
        </div>
      </SettingsGroup>
    </SettingsPage>
  );
}
