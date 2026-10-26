import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, BellRing, Clock, Eye, ExternalLink, RotateCcw, Save, ShieldAlert,
} from 'lucide-react';
import { LOCALE_LABELS, LOCALES } from '../../lib/i18n';
import {
  EMPTY_PREVIEW_DRAFT, readPreviewDraft, writePreviewDraft,
  type MaintenancePreviewDraft,
} from '../../lib/maintenance';
import { adminFetch, type AdminSessionInfo } from './api';
import { Chip, ConfirmDialog, PageHead, Skeleton, Toast, useToast } from './ui';

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

const AUDIT_HREF = `${import.meta.env.BASE_URL}admin/audit`;
const BROADCASTS_HREF = `${import.meta.env.BASE_URL}admin/broadcasts`;
const PREVIEW_URL = `${import.meta.env.BASE_URL}?maintenance-preview=1`;

function blankDraft(): MaintenancePreviewDraft {
  return { ...EMPTY_PREVIEW_DRAFT, messages: { ...EMPTY_PREVIEW_DRAFT.messages } };
}

/**
 * Feature flags, maintenance/read-only mode and platform limits (9b item 10).
 *
 * Part F adds: the safety confirmation before maintenance blocks everyone, the
 * wording that explains maintenance vs read-only, and the maintenance-page
 * design draft + Preview button. The server currently stores only the single
 * `maintenanceMessage`; the extended fields are a browser-local preview draft
 * and are labelled as such (see docs/reports/maintenance-page.md).
 */
export default function FeatureFlagsPage({ session }: { session: AdminSessionInfo }) {
  const toast = useToast();
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** Server state when the page loaded (drives the re-confirmation on enable). */
  const [maintenanceWasOn, setMaintenanceWasOn] = useState(false);
  const [confirmedEnable, setConfirmedEnable] = useState(false);
  const [confirmEnableOpen, setConfirmEnableOpen] = useState(false);
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [draft, setDraft] = useState<MaintenancePreviewDraft>(() => readPreviewDraft());

  const load = useCallback(async () => {
    setError('');
    try {
      const payload = await adminFetch<{ settings: PlatformSettings }>('/api/admin/platform-settings');
      setSettings(payload.settings);
      setMaintenanceWasOn(payload.settings.maintenanceMode);
      setConfirmedEnable(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the platform settings.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function persist() {
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
      setMaintenanceWasOn(payload.settings.maintenanceMode);
      setConfirmedEnable(false);
      toast.show(payload.message);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the platform settings.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!settings) return;
    // Turning maintenance on for the first time must pass the "block all users"
    // confirmation before the server is called.
    if (settings.maintenanceMode && !maintenanceWasOn && !confirmedEnable) {
      setConfirmSaveOpen(true);
      return;
    }
    await persist();
  }

  async function confirmSaveAndPersist() {
    setConfirmSaveOpen(false);
    setConfirmedEnable(true);
    await persist();
  }

  function patch(changes: Partial<PlatformSettings>) {
    setSettings((current) => (current ? { ...current, ...changes } : current));
  }

  function patchDraft(changes: Partial<MaintenancePreviewDraft>) {
    setDraft((current) => ({ ...current, ...changes }));
  }

  function patchDraftMessage(locale: (typeof LOCALES)[number], value: string) {
    setDraft((current) => ({ ...current, messages: { ...current.messages, [locale]: value } }));
  }

  function saveDraftPreview() {
    const saved = writePreviewDraft(draft);
    toast.show(
      saved
        ? 'Preview draft saved in this browser only — the server has no fields for it yet.'
        : 'This browser blocked local storage, so the preview draft could not be saved.',
    );
    return saved;
  }

  function openPreview() {
    saveDraftPreview();
    window.open(PREVIEW_URL, '_blank', 'noopener,noreferrer');
  }

  function resetDraft() {
    const blank = blankDraft();
    setDraft(blank);
    writePreviewDraft(blank);
    toast.show('Preview draft cleared in this browser.');
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
              <div className="admin-card admin-card-pad" data-testid="maintenance-switch-card">
                <p className="admin-card-title">Maintenance mode</p>
                <p className="mt-1 text-[11.5px] text-[var(--ad-muted)]">
                  <strong>Maintenance blocks everyone</strong> (including reading chats): every non-admin API call returns 503
                  with your message, and the full-page maintenance screen replaces the app. Admins, the admin panel and the
                  health check stay reachable.
                </p>
                <label className="mt-2 flex items-center gap-2 text-[12.5px] font-semibold">
                  <input
                    type="checkbox"
                    checked={settings.maintenanceMode}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setConfirmEnableOpen(true);
                        return;
                      }
                      setConfirmedEnable(false);
                      patch({ maintenanceMode: false });
                    }}
                    aria-label="Maintenance mode"
                  />
                  Put Chatgram into maintenance
                </label>
                <label className="mt-2 block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                  Message shown to users (single language — this is the only message the server stores today)
                  <textarea className="admin-input mt-1 min-h-[70px] resize-y" value={settings.maintenanceMessage} onChange={(event) => patch({ maintenanceMessage: event.target.value })} maxLength={500} />
                </label>
                {settings.maintenanceMode ? (
                  <p className="admin-chip admin-chip-warning mt-2"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" /> Users cannot use the app right now — they only see the maintenance page.</p>
                ) : null}
              </div>

              <div className="admin-card admin-card-pad" data-testid="read-only-switch-card">
                <p className="admin-card-title">Read-only mode</p>
                <p className="mt-1 text-[11.5px] text-[var(--ad-muted)]">
                  <strong>Read-only is the soft option:</strong> chats stay readable, but sending, uploading, editing and calls
                  are blocked with 503 while it is on. Sign-in and password flows still work. {settings.maintenanceMode ? 'Maintenance mode currently overrides read-only.' : ''}
                </p>
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
                  <ShieldAlert className="h-3.5 w-3.5" /> Every change here is audited as <code>platform_settings_update</code>.
                  <a className="inline-flex items-center gap-1 underline" href={AUDIT_HREF} target="_blank" rel="noreferrer">Audit log <ExternalLink className="h-3 w-3" /></a>
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

          {/* Part F — maintenance page experience. Browser-local design draft only. */}
          <div className="admin-card admin-card-pad mt-3" data-testid="maintenance-experience-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="admin-card-title">Maintenance page experience</p>
              <Chip tone="warning">preview draft — not saved to the server</Chip>
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--ad-muted)]">
              The maintenance page (<code>apps/web/src/components/MaintenancePage.tsx</code>) is live and already uses the real
              maintenance flag and message above. The fields below are a <strong>design preview stored only in this browser</strong>:
              the server has no fields for them yet, so they are not shown to users during a real maintenance window and are not
              audited. The Preview button renders the page locally via <code>?maintenance-preview=1</code> without enabling
              maintenance. See <code>docs/reports/maintenance-page.md</code> for the server changes needed.
            </p>

            <div className="mt-3 admin-grid lg:grid-cols-2">
              <div className="rounded-xl border border-[var(--ad-border)] p-3">
                <p className="text-[12.5px] font-semibold">Custom message (4 languages)</p>
                <p className="mt-1 text-[11px] text-[var(--ad-muted)]">The server stores one message; these extra languages are preview-only.</p>
                <div className="mt-2 space-y-2">
                  {LOCALES.map((code) => (
                    <label key={code} className="block text-[11px] font-semibold text-[var(--ad-muted)]">
                      {code.toUpperCase()} · {LOCALE_LABELS[code]}
                      <textarea
                        className="admin-input mt-1 min-h-[52px] resize-y"
                        value={draft.messages[code]}
                        maxLength={500}
                        placeholder={code === 'en' ? 'Shown as “A note from the Chatgram team” on the maintenance page' : `Optional ${LOCALE_LABELS[code]} note`}
                        onChange={(event) => patchDraftMessage(code, event.target.value)}
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-[var(--ad-border)] p-3">
                <p className="flex items-center gap-1.5 text-[12.5px] font-semibold"><Clock className="h-3.5 w-3.5" /> Timing, phase and auto-off</p>
                <p className="text-[11px] text-[var(--ad-muted)]">Preview-only: these need new PlatformSettings fields and server enforcement.</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="block text-[11px] font-semibold text-[var(--ad-muted)]">
                    Start time
                    <input type="datetime-local" className="admin-input mt-1" value={draft.startsAt} onChange={(event) => patchDraft({ startsAt: event.target.value })} />
                  </label>
                  <label className="block text-[11px] font-semibold text-[var(--ad-muted)]">
                    Expected end time
                    <input type="datetime-local" className="admin-input mt-1" value={draft.endsAt} onChange={(event) => patchDraft({ endsAt: event.target.value })} />
                  </label>
                </div>
                <label className="block text-[11px] font-semibold text-[var(--ad-muted)]">
                  Phase label (e.g. “Updating the database”)
                  <input className="admin-input mt-1" value={draft.phase} maxLength={80} onChange={(event) => patchDraft({ phase: event.target.value })} />
                </label>
                <label className="block text-[11px] font-semibold text-[var(--ad-muted)]">
                  Auto-off after (hours) — not enforced yet
                  <input
                    className="admin-input mt-1 w-32"
                    type="number"
                    min={1}
                    max={72}
                    placeholder="e.g. 4"
                    value={draft.autoOffHours ?? ''}
                    onChange={(event) => patchDraft({ autoOffHours: event.target.value === '' ? null : Number(event.target.value) })}
                  />
                </label>
                <div className="rounded-lg border border-[var(--ad-border)] p-2">
                  <label className="flex items-start gap-2 text-[11.5px] font-semibold">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={draft.bannerEnabled}
                      onChange={(event) => patchDraft({ bannerEnabled: event.target.checked })}
                    />
                    <span>
                      Dismissible “scheduled maintenance” banner 30 minutes before
                      <span className="mt-0.5 block text-[11px] font-normal text-[var(--ad-muted)]">
                        Not wired automatically. Banners can already be scheduled through Broadcasts (choose a banner, set the
                        publish time 30 minutes before maintenance); this checkbox only records the intent in the draft.
                      </span>
                    </span>
                  </label>
                  <a className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold underline" href={BROADCASTS_HREF} target="_blank" rel="noreferrer">
                    <BellRing className="h-3 w-3" /> Open Broadcasts <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="admin-btn" onClick={saveDraftPreview}>Save preview draft</button>
              <button type="button" className="admin-btn admin-btn-primary" onClick={openPreview}>
                <Eye className="h-3.5 w-3.5" /> Preview maintenance page
              </button>
              <button type="button" className="admin-btn" onClick={resetDraft}>
                <RotateCcw className="h-3.5 w-3.5" /> Reset draft
              </button>
            </div>

            <div className="mt-3 rounded-xl border border-[var(--ad-border)] p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--ad-muted)]">Not stored by the server yet (documented gap)</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-[var(--ad-muted)]">
                <li>Four-language maintenance messages (only the single message above exists).</li>
                <li>Expected end time + countdown, start time and phase label — the page shows “We'll be back shortly.” instead.</li>
                <li>Scheduled maintenance banner automation and auto-off after N hours (real banner scheduling happens in Broadcasts).</li>
                <li>Per-field audit entries: a save is audited as one <code>platform_settings_update</code> row.</li>
              </ul>
            </div>
          </div>
        </>
      )}

      {confirmEnableOpen ? (
        <ConfirmDialog
          title="Block all users?"
          body="This puts Chatgram into maintenance: every non-admin API call returns 503 and users only see the maintenance page. Admins, the admin panel and health checks stay reachable. Users will not be able to read, send, call or upload until you turn it off."
          confirmLabel="Yes, block all users"
          danger
          onConfirm={() => {
            setConfirmEnableOpen(false);
            setConfirmedEnable(true);
            patch({ maintenanceMode: true });
          }}
          onCancel={() => setConfirmEnableOpen(false)}
        />
      ) : null}

      {confirmSaveOpen ? (
        <ConfirmDialog
          title="Save with maintenance ON?"
          body="This will block all users until maintenance is turned off. Continue?"
          confirmLabel="Block all users"
          danger
          busy={busy}
          onConfirm={() => void confirmSaveAndPersist()}
          onCancel={() => setConfirmSaveOpen(false)}
        />
      ) : null}

      <Toast message={toast.message} />
    </div>
  );
}
