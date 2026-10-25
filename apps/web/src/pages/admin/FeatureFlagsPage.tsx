import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Save, ShieldAlert } from 'lucide-react';
import { adminFetch, type AdminSessionInfo } from './api';
import { Chip, PageHead, Skeleton, Toast, useToast } from './ui';

type PlatformSettings = {
  registrationEnabled: boolean;
  statusEnabled: boolean;
  groupsEnabled: boolean;
  fileUploadsEnabled: boolean;
  aiEnabled: boolean;
  supportWidgetEnabled: boolean;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  readOnlyMode: boolean;
  maxUploadMb: number;
};

const FEATURES: { key: keyof PlatformSettings; label: string; hint: string }[] = [
  { key: 'registrationEnabled', label: 'Registration', hint: 'New accounts can be created' },
  { key: 'statusEnabled', label: 'Status', hint: 'Posting and viewing statuses' },
  { key: 'groupsEnabled', label: 'Groups', hint: 'Creating new groups' },
  { key: 'fileUploadsEnabled', label: 'File uploads', hint: 'Attaching files and documents' },
  { key: 'aiEnabled', label: 'Chatgram AI', hint: 'The AI rail, AI conversation and group mentions' },
  { key: 'supportWidgetEnabled', label: 'Support widget', hint: 'The help widget and new support tickets' },
];

/** Feature flags, maintenance/read-only mode and platform limits (9b item 10). */
export default function FeatureFlagsPage({ session }: { session: AdminSessionInfo }) {
  const toast = useToast();
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const payload = await adminFetch<{ settings: PlatformSettings }>('/api/admin/platform-settings');
      setSettings(payload.settings);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the platform settings.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!settings) return;
    setBusy(true);
    setError('');
    try {
      const payload = await adminFetch<{ message: string; settings: PlatformSettings }>('/api/admin/platform-settings', {
        method: 'PUT',
        csrf: session.csrfToken,
        body: { settings },
      });
      setSettings(payload.settings);
      toast.show(payload.message);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the platform settings.');
    } finally {
      setBusy(false);
    }
  }

  function patch(changes: Partial<PlatformSettings>) {
    setSettings((current) => (current ? { ...current, ...changes } : current));
  }

  return (
    <div>
      <PageHead
        title="Feature flags & maintenance"
        subtitle="Turn platform features on or off, take the app into maintenance or read-only mode, and set upload limits."
        actions={
          <button type="button" className="admin-btn admin-btn-primary" onClick={() => void save()} disabled={busy || !settings}>
            <Save className="h-3.5 w-3.5" /> Save changes
          </button>
        }
      />
      {error ? <p role="alert" className="admin-chip admin-chip-danger mb-3">{error}</p> : null}
      {!settings ? (
        <div className="admin-card admin-card-pad"><Skeleton lines={6} /></div>
      ) : (
        <>
          <div className="admin-grid lg:grid-cols-2">
            <div className="admin-card admin-card-pad">
              <p className="admin-card-title">Feature flags</p>
              <p className="mt-1 text-[11.5px] text-[var(--ad-muted)]">Disabled features return a clear “temporarily disabled” message; the admin panel and health check stay reachable.</p>
              <div className="mt-3 space-y-2">
                {FEATURES.map((feature) => (
                  <label key={feature.key} className="flex items-start justify-between gap-3 rounded-xl border border-[var(--ad-border)] p-2.5">
                    <span>
                      <span className="block text-[12.5px] font-semibold">{feature.label}</span>
                      <span className="block text-[11px] text-[var(--ad-muted)]">{feature.hint}</span>
                    </span>
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={settings[feature.key] === true}
                      onChange={(event) => patch({ [feature.key]: event.target.checked } as Partial<PlatformSettings>)}
                      aria-label={feature.label}
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="admin-card admin-card-pad">
                <p className="admin-card-title">Maintenance mode</p>
                <p className="mt-1 text-[11.5px] text-[var(--ad-muted)]">Every non-admin API call returns 503 with your message; the web app shows a maintenance screen.</p>
                <label className="mt-2 flex items-center gap-2 text-[12.5px] font-semibold">
                  <input type="checkbox" checked={settings.maintenanceMode} onChange={(event) => patch({ maintenanceMode: event.target.checked })} aria-label="Maintenance mode" />
                  Put Chatgram into maintenance
                </label>
                <label className="mt-2 block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                  Message shown to users
                  <textarea className="admin-input mt-1 min-h-[70px] resize-y" value={settings.maintenanceMessage} onChange={(event) => patch({ maintenanceMessage: event.target.value })} maxLength={500} />
                </label>
                {settings.maintenanceMode ? (
                  <p className="admin-chip admin-chip-warning mt-2"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" /> Users cannot use the app right now.</p>
                ) : null}
              </div>

              <div className="admin-card admin-card-pad">
                <p className="admin-card-title">Read-only mode</p>
                <p className="mt-1 text-[11.5px] text-[var(--ad-muted)]">Reads keep working; posting, edits and uploads return 503. Sign-in and password flows still work.</p>
                <label className="mt-2 flex items-center gap-2 text-[12.5px] font-semibold">
                  <input type="checkbox" checked={settings.readOnlyMode} onChange={(event) => patch({ readOnlyMode: event.target.checked })} aria-label="Read-only mode" />
                  Read-only mode
                </label>
              </div>

              <div className="admin-card admin-card-pad">
                <p className="admin-card-title">Upload limit</p>
                <p className="mt-1 text-[11.5px] text-[var(--ad-muted)]">Platform-wide maximum upload size in MB (existing per-type limits still apply).</p>
                <label className="mt-2 block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                  Max upload size (MB)
                  <input
                    className="admin-input mt-1 w-40"
                    type="number"
                    min={1}
                    max={2048}
                    value={settings.maxUploadMb}
                    onChange={(event) => patch({ maxUploadMb: Number(event.target.value) || 1 })}
                  />
                </label>
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--ad-muted)]">
                  <ShieldAlert className="h-3.5 w-3.5" /> Every change here is audited (`platform_settings_update`).
                </p>
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Chip tone={settings.maintenanceMode ? 'danger' : 'success'}>{settings.maintenanceMode ? 'maintenance on' : 'live'}</Chip>
            <Chip tone={settings.readOnlyMode ? 'warning' : 'success'}>{settings.readOnlyMode ? 'read-only' : 'writable'}</Chip>
            {FEATURES.map((feature) => (
              <Chip key={feature.key} tone={settings[feature.key] ? 'default' : 'warning'}>
                {feature.label}: {settings[feature.key] ? 'on' : 'off'}
              </Chip>
            ))}
          </div>
        </>
      )}
      <Toast message={toast.message} />
    </div>
  );
}
