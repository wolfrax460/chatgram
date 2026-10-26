import { useCallback, useEffect, useState } from 'react';
import { Globe, RefreshCw, Save, Smartphone, Monitor, Activity } from 'lucide-react';
import { adminFetch, formatBytes, relativeTime, type AdminSessionInfo } from './api';
import { Chip, EmptyState, PageHead, Skeleton, Toast, useToast } from './ui';

type Release = {
  platform: 'windows' | 'android' | 'web';
  version: string;
  versionCode: number;
  fileName: string;
  fileUrl: string;
  sha256: string;
  sha512: string;
  sizeBytes: number;
  releaseNotes: string;
  minSupportedVersion: string;
  forceUpdate: boolean;
  published: boolean;
  withdrawn: boolean;
  withdrawnAt: string | null;
  releasedAt: string | null;
  updatedAt: string | null;
};

type VersionRow = {
  platform: string;
  version: string;
  devices: number;
  lastCheckAt: string | null;
  latestVersion: string;
  outdated: boolean;
  withdrawn: boolean;
};

type PlatformRow = {
  platform: string;
  latestVersion: string;
  latestReleasedAt: string | null;
  withdrawn: boolean;
  devices: number;
  lastCheckAt: string | null;
};

type VersionsInUse = {
  generatedAt: string;
  totalDevices: number;
  lastCheckAt: string | null;
  platforms: PlatformRow[];
  versions: VersionRow[];
};

const PLATFORM_META: Record<Release['platform'], { label: string; hint: string; icon: typeof Monitor }> = {
  windows: { label: 'Windows', hint: 'NSIS installer under /downloads/chatgram-windows-setup.exe', icon: Monitor },
  android: { label: 'Android', hint: 'Signed debug APK under /downloads/chatgram-android.apk', icon: Smartphone },
  web: { label: 'Web', hint: 'Browser app — live build changes are detected through /web/version.json', icon: Globe },
};

function ReleaseCard({
  release,
  onSave,
  busy,
}: {
  release: Release;
  onSave: (next: Release) => Promise<void>;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<Release>(release);
  useEffect(() => setDraft(release), [release]);
  const meta = PLATFORM_META[draft.platform];
  const Icon = meta.icon;
  const dirty = JSON.stringify(draft) !== JSON.stringify(release);
  return (
    <div className="admin-card admin-card-pad">
      <div className="flex items-center justify-between">
        <p className="admin-card-title flex items-center gap-2"><Icon className="h-4 w-4" /> {meta.label}</p>
        <span className="flex items-center gap-1.5">
          {draft.published ? <Chip tone="success">published</Chip> : <Chip>draft</Chip>}
          {draft.withdrawn ? <Chip tone="danger">withdrawn</Chip> : null}
          {draft.forceUpdate ? <Chip tone="warning">force update</Chip> : null}
          {dirty ? <Chip tone="accent">unsaved</Chip> : null}
        </span>
      </div>
      <p className="mt-1 text-[11.5px] text-[var(--ad-muted)]">{meta.hint}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
          Version (e.g. 1.4.0)
          <input className="admin-input mt-1" value={draft.version} onChange={(event) => setDraft({ ...draft, version: event.target.value })} placeholder="1.0.0" />
        </label>
        <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
          Version code (Android versionCode)
          <input
            className="admin-input mt-1"
            type="number"
            min={0}
            value={draft.versionCode || ''}
            onChange={(event) => setDraft({ ...draft, versionCode: Number(event.target.value) || 0 })}
            placeholder="e.g. 2"
          />
        </label>
        <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
          Minimum supported version
          <input className="admin-input mt-1" value={draft.minSupportedVersion} onChange={(event) => setDraft({ ...draft, minSupportedVersion: event.target.value })} placeholder="1.0.0" />
        </label>
        <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
          File name
          <input className="admin-input mt-1" value={draft.fileName} onChange={(event) => setDraft({ ...draft, fileName: event.target.value })} placeholder="chatgram-windows-setup.exe" />
        </label>
        <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
          File URL (https or /downloads/…)
          <input className="admin-input mt-1" value={draft.fileUrl} onChange={(event) => setDraft({ ...draft, fileUrl: event.target.value })} placeholder="/downloads/chatgram-windows-setup.exe" />
        </label>
        <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
          SHA-256 (64 hex characters)
          <input className="admin-input mt-1 font-mono text-[11.5px]" value={draft.sha256} onChange={(event) => setDraft({ ...draft, sha256: event.target.value })} placeholder="e3b0c442…" />
        </label>
        <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
          SHA-512 (Windows, 128 hex characters)
          <input className="admin-input mt-1 font-mono text-[11.5px]" value={draft.sha512} onChange={(event) => setDraft({ ...draft, sha512: event.target.value })} placeholder="cf83e135… (optional)" />
        </label>
        <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
          Size in bytes
          <input
            className="admin-input mt-1"
            type="number"
            min={0}
            value={draft.sizeBytes || ''}
            onChange={(event) => setDraft({ ...draft, sizeBytes: Number(event.target.value) || 0 })}
            placeholder="e.g. 84500000"
          />
        </label>
        <div className="flex flex-wrap items-end gap-3 text-[12px] font-semibold sm:col-span-2">
          <label className="flex items-center gap-2"><input type="checkbox" checked={draft.published} onChange={(event) => setDraft({ ...draft, published: event.target.checked })} /> Published</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={draft.forceUpdate} onChange={(event) => setDraft({ ...draft, forceUpdate: event.target.checked })} /> Force update</label>
          <label className="flex items-center gap-2" title="Withdrawn releases are never offered to apps and disappear from the public feed.">
            <input type="checkbox" checked={draft.withdrawn} onChange={(event) => setDraft({ ...draft, withdrawn: event.target.checked })} /> Withdrawn
          </label>
        </div>
        <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)] sm:col-span-2">
          Release notes (shown on the landing page)
          <textarea
            className="admin-input mt-1 min-h-[90px] resize-y"
            value={draft.releaseNotes}
            onChange={(event) => setDraft({ ...draft, releaseNotes: event.target.value })}
            placeholder="What changed in this version…"
          />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => void onSave(draft)} disabled={busy || !dirty}>
          <Save className="h-3.5 w-3.5" /> Save {meta.label}
        </button>
        <span className="text-[11px] text-[var(--ad-muted)]">
          {draft.published && draft.releasedAt ? `published ${relativeTime(draft.releasedAt)}` : draft.updatedAt ? `draft updated ${relativeTime(draft.updatedAt)}` : 'not published yet'}
          {draft.sizeBytes ? ` · ${formatBytes(draft.sizeBytes)}` : ''}
          {draft.withdrawn && draft.withdrawnAt ? ` · withdrawn ${relativeTime(draft.withdrawnAt)}` : ''}
        </span>
      </div>
      {draft.published && draft.fileUrl ? (
        <p className="mt-2 break-all text-[11px] text-[var(--ad-faint)]">
          Public: {`/api/app/releases`} → {draft.fileUrl} · update check: {`/api/app/version?platform=${draft.platform}`}
        </p>
      ) : null}
    </div>
  );
}

/** "Versions in use" (Chunk 7A): anonymous install counts per platform/version. */
function VersionsInUsePanel() {
  const [data, setData] = useState<VersionsInUse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const payload = await adminFetch<VersionsInUse>('/api/admin/releases/versions');
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the versions in use.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="admin-card admin-card-pad mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="admin-card-title flex items-center gap-2"><Activity className="h-4 w-4" /> Versions in use</p>
        <button type="button" className="admin-btn admin-btn-sm" onClick={() => void load()} disabled={busy}>
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin motion-reduce:animate-none' : ''}`} /> Refresh
        </button>
      </div>
      <p className="mt-1 text-[11.5px] text-[var(--ad-muted)]">
        Anonymous install counts reported by the apps with <span className="font-mono">GET /api/app/version</span>. Only a random install id,
        platform, installed version and the check time are stored — no name, email or device fingerprint.
      </p>
      {error ? <p role="alert" className="admin-chip admin-chip-danger mt-3">{error}</p> : null}
      {!data ? (
        <div className="mt-3"><Skeleton lines={4} /></div>
      ) : data.versions.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            title="No installs have checked for updates yet"
            body="Once a Windows or Android app calls the update endpoint, its anonymous install rows appear here."
            icon={<Activity className="h-6 w-6" />}
          />
        </div>
      ) : (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {data.platforms.map((row) => (
              <div key={row.platform} className="rounded-xl border border-[var(--ad-border)] p-3">
                <p className="text-[12px] font-bold capitalize">{row.platform}</p>
                <p className="text-[11.5px] text-[var(--ad-muted)]">
                  {row.devices} install{row.devices === 1 ? '' : 's'} · latest {row.latestVersion || '—'}
                </p>
                <p className="text-[11px] text-[var(--ad-faint)]">
                  last check {row.lastCheckAt ? relativeTime(row.lastCheckAt) : 'never'}
                  {row.withdrawn ? ' · latest release withdrawn' : ''}
                </p>
              </div>
            ))}
          </div>
          <div className="admin-scroll mt-3 max-h-[45vh] overflow-y-auto rounded-xl border border-[var(--ad-border)]">
            <table className="admin-table">
              <thead>
                <tr><th>Platform</th><th>Version</th><th>Installs</th><th>Last check</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.versions.map((row) => (
                  <tr key={`${row.platform}-${row.version}`}>
                    <td className="capitalize">{row.platform}</td>
                    <td className="font-mono text-[11.5px]">{row.version || '—'}</td>
                    <td>{row.devices}</td>
                    <td className="whitespace-nowrap text-[11.5px] text-[var(--ad-muted)]">
                      {row.lastCheckAt ? relativeTime(row.lastCheckAt) : '—'}
                    </td>
                    <td>
                      {row.outdated ? <Chip tone="warning">outdated</Chip> : <Chip tone="success">latest</Chip>}
                      {row.withdrawn ? <span className="ml-1"><Chip tone="danger">withdrawn</Chip></span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-[var(--ad-faint)]">
            {data.totalDevices} install{data.totalDevices === 1 ? '' : 's'} total · last check{' '}
            {data.lastCheckAt ? relativeTime(data.lastCheckAt) : 'never'} · generated {relativeTime(data.generatedAt)}
          </p>
        </>
      )}
    </div>
  );
}

/** App releases: Windows/Android/Web versions that feed the apps and the landing page. */
export default function ReleasesPage({ session }: { session: AdminSessionInfo }) {
  const toast = useToast();
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const payload = await adminFetch<{ releases: Release[] }>('/api/admin/releases');
      setReleases(payload.releases);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the releases.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(next: Release) {
    if (!releases) return;
    setBusy(true);
    setError('');
    try {
      const merged = releases.map((row) => (row.platform === next.platform ? next : row));
      const payload = await adminFetch<{ message: string; releases: Release[] }>('/api/admin/releases', {
        method: 'PUT',
        csrf: session.csrfToken,
        body: { releases: merged },
      });
      setReleases(payload.releases);
      toast.show(payload.message);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the release.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHead
        title="App releases"
        subtitle="Published Windows, Android and Web releases — the landing Downloads tab and the apps read /api/app/releases; the apps check /api/app/version."
      />
      {error ? <p role="alert" className="admin-chip admin-chip-danger mb-3">{error}</p> : null}
      {!releases ? (
        <div className="admin-card admin-card-pad"><Skeleton lines={6} /></div>
      ) : (
        <div className="admin-grid xl:grid-cols-2">
          {releases.map((release) => (
            <ReleaseCard key={release.platform} release={release} onSave={save} busy={busy} />
          ))}
        </div>
      )}
      <VersionsInUsePanel />
      <p className="mt-3 text-[11.5px] text-[var(--ad-muted)]">
        The installer and APK files are deployed under <span className="font-mono">/downloads/</span> with the web deploy; the checksum and
        size here must match the published file. Only published, non-withdrawn releases appear on the public feed and are offered to the apps.
      </p>
      <Toast message={toast.message} />
    </div>
  );
}
