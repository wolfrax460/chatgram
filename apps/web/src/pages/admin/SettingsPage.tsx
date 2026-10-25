import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Database, Download, Globe, HardDrive, Mail, RefreshCw, Save, Send, ShieldCheck, Timer } from 'lucide-react';
import { adminFetch, relativeTime, type AdminSessionInfo } from './api';
import { Chip, PageHead, Skeleton, useToast } from './ui';

type SettingsValues = {
  siteName: string;
  siteUrl: string;
  supportEmail: string;
  smtpFromName: string;
  smtpFromAddress: string;
  privacyUrl: string;
  termsUrl: string;
  dataRetentionDays: number;
  reviewLogRetentionDays: number;
};

type SettingsStatus = {
  emailProvider: string;
  smtpConfigured: boolean;
  telegramConfigured: boolean;
  backupRunning: boolean;
};

type BackupRow = { name: string; sizeBytes: number; createdAt: string };

type SettingsPayload = {
  settings: SettingsValues;
  status: SettingsStatus;
  backups: BackupRow[];
  lastBackupAt: string | null;
  lastBackupSizeBytes: number;
};

type Tab = 'general' | 'email' | 'retention' | 'legal' | 'backups';

const TABS: { key: Tab; label: string; icon: typeof Globe }[] = [
  { key: 'general', label: 'General', icon: Globe },
  { key: 'email', label: 'Email & Telegram', icon: Mail },
  { key: 'retention', label: 'Retention', icon: Timer },
  { key: 'legal', label: 'Legal links', icon: ShieldCheck },
  { key: 'backups', label: 'Backups', icon: Database },
];

function formatBytes(bytes: number) {
  if (!bytes) return '—';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SettingsPage({ session }: { session: AdminSessionInfo }) {
  const toast = useToast();
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [tab, setTab] = useState<Tab>('general');
  const [values, setValues] = useState<SettingsValues | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [backingUp, setBackingUp] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const payload = await adminFetch<SettingsPayload>('/api/admin/settings');
      setData(payload);
      setValues(payload.settings);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the settings.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => {
    if (!data || !values) return false;
    return (Object.keys(data.settings) as (keyof SettingsValues)[]).some((key) => String(data.settings[key]) !== String(values[key]));
  }, [data, values]);

  function set<K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) {
    setValues((current) => (current ? { ...current, [key]: value } : current));
  }

  async function save() {
    if (!values) return;
    setSaving(true);
    setError('');
    try {
      const result = await adminFetch<{ settings: SettingsValues; message: string }>('/api/admin/settings', {
        method: 'PUT',
        csrf: session.csrfToken,
        body: values,
      });
      setData((current) => (current ? { ...current, settings: result.settings } : current));
      setValues(result.settings);
      toast.show(result.message || 'Settings saved.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the settings.');
    } finally {
      setSaving(false);
    }
  }

  async function backupNow() {
    setBackingUp(true);
    setError('');
    try {
      const result = await adminFetch<{ message: string; backups: BackupRow[] }>('/api/admin/settings/backup', {
        method: 'POST',
        csrf: session.csrfToken,
      });
      toast.show(result.message);
      await load();
    } catch (backupError) {
      setError(backupError instanceof Error ? backupError.message : 'The backup failed.');
    } finally {
      setBackingUp(false);
    }
  }

  return (
    <div>
      <PageHead
        title="Settings"
        subtitle="Site identity, support email, email/Telegram status, retention windows, legal links and database backups. Secrets are never shown — only whether they are configured."
        actions={
          <div className="flex gap-2">
            <button type="button" className="admin-btn admin-btn-sm" onClick={() => void load()}>
              <RefreshCw className="h-3.5 w-3.5" /> Reload
            </button>
            <button type="button" className="admin-btn admin-btn-sm admin-btn-primary" disabled={saving || !dirty} onClick={() => void save()}>
              <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
            </button>
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap gap-2">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" className={`admin-btn admin-btn-sm ${tab === key ? 'admin-btn-primary' : ''}`} onClick={() => setTab(key)} aria-current={tab === key ? 'page' : undefined}>
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {error ? <p className="admin-chip admin-chip-danger mb-3">{error}</p> : null}
      {dirty ? <p className="admin-chip admin-chip-warning mb-3">Unsaved changes — use “Save changes” to apply them.</p> : null}

      {!data || !values ? (
        <div className="admin-card admin-card-pad">
          <Skeleton lines={6} />
        </div>
      ) : (
        <>
          {tab === 'general' ? (
            <div className="admin-card admin-card-pad">
              <p className="admin-card-title flex items-center gap-2"><Globe className="h-4 w-4" /> Site identity</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                  Site name
                  <input className="admin-input mt-1 w-full" value={values.siteName} maxLength={60} onChange={(event) => set('siteName', event.target.value)} />
                </label>
                <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                  Site URL
                  <input className="admin-input mt-1 w-full" value={values.siteUrl} maxLength={300} onChange={(event) => set('siteUrl', event.target.value)} placeholder="https://chatgram.example" />
                </label>
                <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                  Support email
                  <input className="admin-input mt-1 w-full" value={values.supportEmail} maxLength={200} onChange={(event) => set('supportEmail', event.target.value)} placeholder="support@example.com" />
                </label>
              </div>
              <p className="mt-3 text-[11.5px] text-[var(--ad-muted)]">The site name is used in the app title and emails; the support email is where users are told to write.</p>
            </div>
          ) : null}

          {tab === 'email' ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="admin-card admin-card-pad">
                <p className="admin-card-title flex items-center gap-2"><Mail className="h-4 w-4" /> Email / SMTP</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Chip tone={data.status.smtpConfigured ? 'success' : 'warning'}>
                    {data.status.smtpConfigured ? <><CheckCircle2 className="h-3 w-3" /> SMTP configured</> : 'SMTP not configured'}
                  </Chip>
                  <Chip>{data.status.emailProvider} provider</Chip>
                </div>
                <p className="mt-2 text-[12px] text-[var(--ad-muted)]">
                  Host, port, user and password come from the server environment (<code>SMTP_HOST</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code>) and are never displayed or stored in the database. Change them on the server, not here.
                </p>
                <div className="mt-3 grid gap-2">
                  <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                    From name
                    <input className="admin-input mt-1 w-full" value={values.smtpFromName} maxLength={80} onChange={(event) => set('smtpFromName', event.target.value)} />
                  </label>
                  <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                    From address
                    <input className="admin-input mt-1 w-full" value={values.smtpFromAddress} maxLength={200} onChange={(event) => set('smtpFromAddress', event.target.value)} placeholder="no-reply@example.com" />
                  </label>
                </div>
              </div>
              <div className="admin-card admin-card-pad">
                <p className="admin-card-title flex items-center gap-2"><Send className="h-4 w-4" /> Telegram bot</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Chip tone={data.status.telegramConfigured ? 'success' : 'default'}>
                    {data.status.telegramConfigured ? <><CheckCircle2 className="h-3 w-3" /> configured</> : 'not configured'}
                  </Chip>
                </div>
                <p className="mt-2 text-[12px] text-[var(--ad-muted)]">
                  The bot token is write-only: the dashboard only reports whether <code>TELEGRAM_BOT_TOKEN</code> and <code>TELEGRAM_CHAT_ID</code> are set, and never returns their values. Set them on the server to enable Telegram alerts.
                </p>
              </div>
            </div>
          ) : null}

          {tab === 'retention' ? (
            <div className="admin-card admin-card-pad">
              <p className="admin-card-title flex items-center gap-2"><Timer className="h-4 w-4" /> Data retention</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                  Chat/message retention (days)
                  <input type="number" min={30} max={3650} className="admin-input mt-1 w-full" value={values.dataRetentionDays} onChange={(event) => set('dataRetentionDays', Number(event.target.value))} />
                </label>
                <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                  Security review log retention (days)
                  <input type="number" min={30} max={3650} className="admin-input mt-1 w-full" value={values.reviewLogRetentionDays} onChange={(event) => set('reviewLogRetentionDays', Number(event.target.value))} />
                </label>
              </div>
              <p className="mt-3 text-[11.5px] text-[var(--ad-muted)]">
                Review-log retention is enforced when the “Who viewed what” log is opened; the default is 730 days (2 years). Message retention is a policy value recorded here.
              </p>
            </div>
          ) : null}

          {tab === 'legal' ? (
            <div className="admin-card admin-card-pad">
              <p className="admin-card-title flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Legal pages</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                  Privacy policy URL or path
                  <input className="admin-input mt-1 w-full" value={values.privacyUrl} maxLength={300} onChange={(event) => set('privacyUrl', event.target.value)} placeholder="/docs/#privacy" />
                </label>
                <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                  Terms URL or path
                  <input className="admin-input mt-1 w-full" value={values.termsUrl} maxLength={300} onChange={(event) => set('termsUrl', event.target.value)} placeholder="/docs/#terms" />
                </label>
              </div>
              <p className="mt-3 text-[11.5px] text-[var(--ad-muted)]">Relative paths start with <code>/</code>; absolute links must use http(s). Sign-up and Settings link users to these pages.</p>
            </div>
          ) : null}

          {tab === 'backups' ? (
            <div className="admin-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ad-border)] p-3">
                <div>
                  <p className="admin-card-title flex items-center gap-2"><HardDrive className="h-4 w-4" /> Database backups</p>
                  <p className="text-[12px] text-[var(--ad-muted)]">
                    Last backup: {data.lastBackupAt ? `${relativeTime(data.lastBackupAt)} · ${formatBytes(data.lastBackupSizeBytes)}` : 'never from this panel'}
                  </p>
                </div>
                <button type="button" className="admin-btn admin-btn-primary" disabled={backingUp || data.status.backupRunning} onClick={() => void backupNow()}>
                  <Database className="h-3.5 w-3.5" /> {backingUp || data.status.backupRunning ? 'Backing up…' : 'Back up now'}
                </button>
              </div>
              {data.backups.length === 0 ? (
                <div className="admin-empty p-6 text-center">
                  <Database className="mx-auto mb-2 h-6 w-6 text-[var(--ad-muted)]" />
                  <p className="text-[13px] font-semibold">No dashboard backups yet</p>
                  <p className="text-[12px] text-[var(--ad-muted)]">Run “Back up now”, or use the documented server backup command (<code>mongodump</code>).</p>
                </div>
              ) : (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Backup</th>
                        <th>Created</th>
                        <th>Size</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {data.backups.map((row) => (
                        <tr key={row.name}>
                          <td className="font-mono text-[11.5px]">{row.name}</td>
                          <td>{relativeTime(row.createdAt)}</td>
                          <td>{formatBytes(row.sizeBytes)}</td>
                          <td className="text-right">
                            <a className="admin-btn admin-btn-sm no-underline" href="/docs/#backups" target="_blank" rel="noreferrer">
                              <Download className="h-3.5 w-3.5" /> Restore guide
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="border-t border-[var(--ad-border)] p-3 text-[11.5px] text-[var(--ad-muted)]">
                Restore: stop the API, <code>mongorestore --gzip --archive=&lt;file&gt; --drop</code>, then start it again. Follow <a className="underline" href="/docs/#backups" target="_blank" rel="noreferrer">the restore guide</a> and take a fresh backup first.
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
