import { useEffect, useMemo, useState } from 'react';
import { Icon } from './sections.jsx';

/**
 * Downloads tab data: everything here comes from the published App releases
 * (GET /api/app/releases), which the admin App releases page owns. If the feed
 * cannot be reached the last known-good values are shown instead, clearly marked
 * as cached.
 */

const FALLBACK = {
  cached: true,
  releases: [
    {
      platform: 'windows',
      version: '1.1.0',
      fileName: 'chatgram-windows-setup.exe',
      fileUrl: '/downloads/chatgram-windows-setup.exe',
      sha256: '1943d51ae5c7ec7d48a10da38c1694dae9622f4ad0d9d90caa5b430456fdbae5',
      sizeBytes: 81823613,
      releaseNotes: 'Desktop app rebuilt for Chatgram 1.1 with Chatgram AI, the admin dashboard and the newer web build.',
      minSupportedVersion: '1.0.0',
      forceUpdate: false,
      releasedAt: '2026-10-25T09:43:39.468Z',
    },
    {
      platform: 'android',
      version: '1.1.0',
      fileName: 'chatgram-android.apk',
      fileUrl: '/downloads/chatgram-android.apk',
      sha256: 'a5891a584dd2035d6653b29e8b45ae561ae52c2bc505a2eda42f2870182e3fc5',
      sizeBytes: 4127661,
      releaseNotes: 'First direct-download Android build (debug-signed, sideload only).',
      minSupportedVersion: '1.0.0',
      forceUpdate: false,
      releasedAt: '2026-10-25T09:43:39.468Z',
    },
    {
      platform: 'web',
      version: '1.1.0',
      fileName: '',
      fileUrl: '/web/',
      sha256: '',
      sizeBytes: 0,
      releaseNotes: 'Web app: Chatgram AI as a standard conversation, the admin dashboard, moderation, data requests and admin TOTP/IP security.',
      minSupportedVersion: '1.0.0',
      forceUpdate: false,
      releasedAt: '2026-10-25T09:43:39.468Z',
    },
  ],
};

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return '—';
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso) {
  if (!iso) return 'not released yet';
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return '—';
  }
}

export function useReleases() {
  const [state, setState] = useState({ loading: true, error: '', releases: [], cached: false });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/app/releases')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((payload) => {
        if (cancelled) return;
        const releases = Array.isArray(payload?.releases) ? payload.releases : [];
        setState({ loading: false, error: '', releases: releases.length ? releases : FALLBACK.releases, cached: releases.length === 0 });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({ loading: false, error: String(error.message || error), releases: FALLBACK.releases, cached: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

function byPlatform(releases) {
  const map = new Map();
  for (const release of releases) map.set(release.platform, release);
  return map;
}

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      type="button"
      className="sha-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function Checksum({ sha256 }) {
  if (!sha256) return <span className="muted">Not provided</span>;
  return (
    <span className="sha">
      <code title={sha256}>{sha256.slice(0, 16)}…{sha256.slice(-8)}</code>
      <CopyButton value={sha256} />
    </span>
  );
}

function InstallSteps({ steps }) {
  return (
    <ol className="install-steps">
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  );
}

export function Downloads() {
  const { releases, cached, loading } = useReleases();
  const platforms = useMemo(() => byPlatform(releases), [releases]);
  const windows = platforms.get('windows');
  const android = platforms.get('android');
  const web = platforms.get('web');

  if (loading) {
    return <p className="muted">Loading the latest downloads…</p>;
  }

  return (
    <>
      {cached ? (
        <p className="dl-notice">
          Showing the last published build while the release feed is unreachable. Check the version below before
          installing.
        </p>
      ) : null}
      <div className="grid grid-3">
        <div className="dl-card">
          <div className="dl-top">
            <span className="dl-icon">{Icon.windows}</span>
            <span className="plat">Windows</span>
          </div>
          <h3>Chatgram for Windows</h3>
          <div className="meta">
            {windows?.version ? `Version ${windows.version}` : 'Version not published'} · Unsigned installer
          </div>
          <dl className="dl-meta">
            <div><dt>Size</dt><dd>{formatBytes(windows?.sizeBytes)}</dd></div>
            <div><dt>Released</dt><dd>{formatDate(windows?.releasedAt)}</dd></div>
            <div><dt>File</dt><dd>{windows?.fileName || 'chatgram-windows-setup.exe'}</dd></div>
            <div className="wide"><dt>SHA-256</dt><dd><Checksum sha256={windows?.sha256} /></dd></div>
          </dl>
          <InstallSteps
            steps={[
              'Download and run the installer.',
              'SmartScreen may warn because the build is unsigned — click “More info” → “Run anyway”.',
              'Verify the file: Get-FileHash .\\chatgram-windows-setup.exe -Algorithm SHA256',
              'Chatgram starts and stays in the tray when closed; future updates install automatically.',
            ]}
          />
          <a className="btn btn-primary full" href={windows?.fileUrl || '/downloads/chatgram-windows-setup.exe'}>
            Download for Windows
          </a>
          <div className="alt">Windows 10 or newer, 64-bit · updates itself from /downloads.</div>
        </div>

        <div className="dl-card">
          <div className="dl-top">
            <span className="dl-icon">{Icon.android}</span>
            <span className="plat">Android</span>
          </div>
          <h3>Chatgram for Android</h3>
          <div className="meta">
            {android?.version ? `Version ${android.version}` : 'Version not published'} · APK · Debug-signed
          </div>
          <div className="dl-android">
            <dl className="dl-meta">
              <div><dt>Size</dt><dd>{formatBytes(android?.sizeBytes)}</dd></div>
              <div><dt>Released</dt><dd>{formatDate(android?.releasedAt)}</dd></div>
              <div><dt>Requires</dt><dd>Android 7.0+ (API 24)</dd></div>
              <div className="wide"><dt>SHA-256</dt><dd><Checksum sha256={android?.sha256} /></dd></div>
            </dl>
            <figure className="dl-qr">
              <img src="/assets/apk-qr.svg" alt="QR code that opens the Chatgram APK download" loading="lazy" />
              <figcaption>Scan to install</figcaption>
            </figure>
          </div>
          <InstallSteps
            steps={[
              'Download the APK, then allow “Install unknown apps” for your browser or Files app.',
              'Open the file and install; launch Chatgram.',
              'This is a direct-download build, not a Play Store release.',
            ]}
          />
          <a className="btn btn-primary full" href={android?.fileUrl || '/downloads/chatgram-android.apk'}>
            Download APK
          </a>
          <div className="alt">Debug-signed, sideload only · camera/microphone are requested only when a call or voice note needs them.</div>
        </div>

        <div className="dl-card">
          <div className="dl-top">
            <span className="dl-icon">{Icon.globe}</span>
            <span className="plat">Web</span>
          </div>
          <h3>Chatgram in your browser</h3>
          <div className="meta">{web?.version ? `Version ${web.version}` : 'Always the latest build'} · No install</div>
          <p className="dl-body">
            The same account and the same chats — open <code>/web/</code> in any modern browser. Nothing to download.
          </p>
          <InstallSteps steps={['Open Chatgram in this browser.', 'Sign in with the same account you use on your phone or PC.']} />
          <a className="btn btn-light full" href={web?.fileUrl || '/web/'}>
            Open in browser
          </a>
          <div className="alt">Chrome, Edge, Firefox or Safari.</div>
        </div>
      </div>
    </>
  );
}

/** Changelog built from the published release notes (newest first). */
export function ReleaseNotes() {
  const { releases, loading } = useReleases();
  if (loading) return <p className="muted">Loading release notes…</p>;
  const ordered = [...releases].sort((a, b) => new Date(b.releasedAt || 0).getTime() - new Date(a.releasedAt || 0).getTime());
  return (
    <div className="changelog">
      {ordered.map((release) => (
        <div className="release" key={`${release.platform}-${release.version}`}>
          <div className="release-head">
            <span className="tag">v{release.version || '—'}</span>
            <span className="release-date">
              {release.platform === 'windows' ? 'Windows' : release.platform === 'android' ? 'Android' : 'Web'} ·{' '}
              {formatDate(release.releasedAt)}
            </span>
          </div>
          <ul>
            {String(release.releaseNotes || '')
              .split(/\r?\n|(?<=\.)\s(?=[A-Z])/)
              .map((line) => line.trim())
              .filter(Boolean)
              .map((item) => (
                <li key={item}>
                  <span className="tick">{Icon.check}</span>
                  {item}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export { FALLBACK as FALLBACK_RELEASES };
