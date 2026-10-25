import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Globe, Hash, RefreshCw, Save, ShieldAlert, ShieldCheck, Timer, Trash2, Users } from 'lucide-react';
import { adminFetch, type AdminSessionInfo, relativeTime } from './api';
import { Chip, PageHead, Skeleton, useToast } from './ui';

type IpBan = { ip: string; reason: string; createdAt: string };

type SafetySettings = {
  blockedWords: string[];
  blockedLinkDomains: string[];
  blockedEmailDomains: string[];
  messagesPerMinute: number;
  signupsPerHourPerIp: number;
  massMessageHourly: number;
  signupThrottleEnabled: boolean;
  ipBans: IpBan[];
};

type SafetySignals = {
  massMessaging: { userId: string; displayName: string; messagesLastHour: number; threshold: number }[];
  signupBursts: { ip: string; count: number; newestAt: string }[];
  blockedEmailDomainsCount: number;
  bannedIpCount: number;
  generatedAt: string;
};

type SafetyPayload = { settings: SafetySettings; signals: SafetySignals };

function toLines(values: string[]) {
  return (values || []).join('\n');
}

function fromLines(value: string) {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export default function SafetyPage({ session }: { session: AdminSessionInfo }) {
  const toast = useToast();
  const [data, setData] = useState<SafetyPayload | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [wordsText, setWordsText] = useState('');
  const [linksText, setLinksText] = useState('');
  const [domainsText, setDomainsText] = useState('');
  const [limits, setLimits] = useState({ messagesPerMinute: 60, signupsPerHourPerIp: 20, massMessageHourly: 200, signupThrottleEnabled: true });
  const [banIp, setBanIp] = useState('');
  const [banReason, setBanReason] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const payload = await adminFetch<SafetyPayload>('/api/admin/safety');
      setData(payload);
      setWordsText(toLines(payload.settings.blockedWords));
      setLinksText(toLines(payload.settings.blockedLinkDomains));
      setDomainsText(toLines(payload.settings.blockedEmailDomains));
      setLimits({
        messagesPerMinute: payload.settings.messagesPerMinute,
        signupsPerHourPerIp: payload.settings.signupsPerHourPerIp,
        massMessageHourly: payload.settings.massMessageHourly,
        signupThrottleEnabled: payload.settings.signupThrottleEnabled,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the safety settings.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => {
    if (!data) return false;
    return (
      wordsText !== toLines(data.settings.blockedWords) ||
      linksText !== toLines(data.settings.blockedLinkDomains) ||
      domainsText !== toLines(data.settings.blockedEmailDomains) ||
      limits.messagesPerMinute !== data.settings.messagesPerMinute ||
      limits.signupsPerHourPerIp !== data.settings.signupsPerHourPerIp ||
      limits.massMessageHourly !== data.settings.massMessageHourly ||
      limits.signupThrottleEnabled !== data.settings.signupThrottleEnabled
    );
  }, [data, wordsText, linksText, domainsText, limits]);

  async function save() {
    setSaving(true);
    setError('');
    try {
      const result = await adminFetch<{ settings: SafetySettings; message: string }>('/api/admin/safety', {
        method: 'PUT',
        csrf: session.csrfToken,
        body: {
          blockedWords: fromLines(wordsText),
          blockedLinkDomains: fromLines(linksText),
          blockedEmailDomains: fromLines(domainsText),
          messagesPerMinute: Number(limits.messagesPerMinute),
          signupsPerHourPerIp: Number(limits.signupsPerHourPerIp),
          massMessageHourly: Number(limits.massMessageHourly),
          signupThrottleEnabled: limits.signupThrottleEnabled,
        },
      });
      toast.show(result.message || 'Safety settings saved.');
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the safety settings.');
    } finally {
      setSaving(false);
    }
  }

  async function addBan() {
    setError('');
    try {
      const result = await adminFetch<{ message: string }>('/api/admin/safety/ip-bans', {
        method: 'POST',
        csrf: session.csrfToken,
        body: { ip: banIp.trim(), reason: banReason.trim() },
      });
      toast.show(result.message);
      setBanIp('');
      setBanReason('');
      await load();
    } catch (banError) {
      setError(banError instanceof Error ? banError.message : 'Could not add the IP ban.');
    }
  }

  async function removeBan(ip: string) {
    setError('');
    try {
      const result = await adminFetch<{ message: string }>(`/api/admin/safety/ip-bans/${encodeURIComponent(ip)}`, {
        method: 'DELETE',
        csrf: session.csrfToken,
      });
      toast.show(result.message);
      await load();
    } catch (unbanError) {
      setError(unbanError instanceof Error ? unbanError.message : 'Could not remove the IP ban.');
    }
  }

  return (
    <div>
      <PageHead
        title="Safety & abuse"
        subtitle="Blocked words, links and email domains, IP bans, message/signup rate limits and live spam signals. Every change is audited."
        actions={
          <div className="flex gap-2">
            <button type="button" className="admin-btn admin-btn-sm" onClick={() => void load()}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
            <button type="button" className="admin-btn admin-btn-sm admin-btn-primary" disabled={saving || !dirty} onClick={() => void save()}>
              <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
            </button>
          </div>
        }
      />

      {error ? <p className="admin-chip admin-chip-danger mb-3">{error}</p> : null}
      {!data ? (
        <div className="admin-card admin-card-pad">
          <Skeleton lines={6} />
        </div>
      ) : (
        <>
          <div className="review-stats">
            <div className="admin-card admin-kpi">
              <span className="admin-section-label">Blocked words</span>
              <strong className="admin-kpi-value">{data.settings.blockedWords.length}</strong>
              <span className="admin-chip">matched in message text</span>
            </div>
            <div className="admin-card admin-kpi">
              <span className="admin-section-label">Blocked link domains</span>
              <strong className="admin-kpi-value">{data.settings.blockedLinkDomains.length}</strong>
              <span className="admin-chip">refused on send</span>
            </div>
            <div className="admin-card admin-kpi">
              <span className="admin-section-label">Blocked email domains</span>
              <strong className="admin-kpi-value">{data.settings.blockedEmailDomains.length}</strong>
              <span className="admin-chip">refused at sign-up</span>
            </div>
            <div className="admin-card admin-kpi">
              <span className="admin-section-label">Banned IPs</span>
              <strong className="admin-kpi-value">{data.settings.ipBans.length}</strong>
              <span className={`admin-chip ${data.settings.ipBans.length ? 'admin-chip-warning' : 'admin-chip-success'}`}>
                {data.settings.ipBans.length ? 'active block' : 'no blocks'}
              </span>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <div className="admin-card admin-card-pad">
              <p className="admin-card-title flex items-center gap-2"><Hash className="h-4 w-4" /> Blocked words</p>
              <p className="text-[12px] text-[var(--ad-muted)]">One word or phrase per line (or comma separated). Any message containing one is refused.</p>
              <textarea className="admin-input mt-2 h-32 w-full font-mono text-[12px]" value={wordsText} onChange={(event) => setWordsText(event.target.value)} placeholder={'spamword\nanother phrase'} />
            </div>
            <div className="admin-card admin-card-pad">
              <p className="admin-card-title flex items-center gap-2"><Globe className="h-4 w-4" /> Blocked link & email domains</p>
              <p className="text-[12px] text-[var(--ad-muted)]">Links to these domains are refused in messages; email domains cannot sign up.</p>
              <label className="mt-2 block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                Message link domains
                <textarea className="admin-input mt-1 h-16 w-full font-mono text-[12px]" value={linksText} onChange={(event) => setLinksText(event.target.value)} placeholder={'bad.example\nspam.example'} />
              </label>
              <label className="mt-2 block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                Email domains (sign-up)
                <textarea className="admin-input mt-1 h-16 w-full font-mono text-[12px]" value={domainsText} onChange={(event) => setDomainsText(event.target.value)} placeholder={'tempmail.example'} />
              </label>
            </div>
          </div>

          <div className="admin-card admin-card-pad mt-3">
            <p className="admin-card-title flex items-center gap-2"><Timer className="h-4 w-4" /> Rate limits & throttling</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                Messages per minute, per user
                <input type="number" min={5} max={600} className="admin-input mt-1 w-full" value={limits.messagesPerMinute} onChange={(event) => setLimits((value) => ({ ...value, messagesPerMinute: Number(event.target.value) }))} />
              </label>
              <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                Signups per hour, per IP
                <input type="number" min={1} max={1000} className="admin-input mt-1 w-full" value={limits.signupsPerHourPerIp} onChange={(event) => setLimits((value) => ({ ...value, signupsPerHourPerIp: Number(event.target.value) }))} />
              </label>
              <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                Mass-messaging alert threshold (per hour)
                <input type="number" min={10} max={10000} className="admin-input mt-1 w-full" value={limits.massMessageHourly} onChange={(event) => setLimits((value) => ({ ...value, massMessageHourly: Number(event.target.value) }))} />
              </label>
              <label className="flex items-end gap-2 pb-1 text-[12px] font-semibold">
                <input type="checkbox" checked={limits.signupThrottleEnabled} onChange={(event) => setLimits((value) => ({ ...value, signupThrottleEnabled: event.target.checked }))} />
                Signup throttling enabled
              </label>
            </div>
          </div>

          <div className="admin-card mt-3">
            <div className="border-b border-[var(--ad-border)] p-3">
              <p className="admin-card-title flex items-center gap-2"><Ban className="h-4 w-4" /> IP bans</p>
              <p className="text-[12px] text-[var(--ad-muted)]">A banned IP cannot use the API or sign in (the admin panel and health stay reachable so you can undo it).</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <input className="admin-input w-48" value={banIp} onChange={(event) => setBanIp(event.target.value)} placeholder="203.0.113.7" aria-label="IP address to ban" />
                <input className="admin-input flex-1" value={banReason} onChange={(event) => setBanReason(event.target.value)} placeholder="Reason (required, audited)" aria-label="IP ban reason" />
                <button type="button" className="admin-btn admin-btn-danger" disabled={!banIp.trim() || !banReason.trim()} onClick={() => void addBan()}>
                  <ShieldAlert className="h-3.5 w-3.5" /> Block IP
                </button>
              </div>
            </div>
            {data.settings.ipBans.length === 0 ? (
              <p className="p-4 text-[12.5px] text-[var(--ad-muted)]">No IP bans. Use this for repeat abusers; keep it empty for normal users behind shared networks.</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>IP</th>
                      <th>Reason</th>
                      <th>Added</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.settings.ipBans.map((entry) => (
                      <tr key={entry.ip}>
                        <td className="font-mono text-[12px]">{entry.ip}</td>
                        <td className="max-w-[360px] truncate" title={entry.reason}>{entry.reason}</td>
                        <td>{entry.createdAt ? relativeTime(entry.createdAt) : '—'}</td>
                        <td className="text-right">
                          <button type="button" className="admin-btn admin-btn-sm" onClick={() => void removeBan(entry.ip)}>
                            <Trash2 className="h-3.5 w-3.5" /> Unban
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid gap-3 xl:grid-cols-2 mt-3">
            <div className="admin-card admin-card-pad">
              <p className="admin-card-title flex items-center gap-2"><Users className="h-4 w-4" /> Mass messaging (last hour)</p>
              {data.signals.massMessaging.length === 0 ? (
                <p className="mt-2 text-[12.5px] text-[var(--ad-muted)]">No account is above {data.signals.massMessaging[0]?.threshold || data.settings.massMessageHourly} messages in the last hour.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {data.signals.massMessaging.map((row) => (
                    <li key={row.userId} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--ad-border)] p-2 text-[12.5px]">
                      <span className="truncate">{row.displayName}</span>
                      <Chip tone="danger">{row.messagesLastHour} messages</Chip>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="admin-card admin-card-pad">
              <p className="admin-card-title flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Signup bursts (this process, last hour)</p>
              {data.signals.signupBursts.length === 0 ? (
                <p className="mt-2 text-[12.5px] text-[var(--ad-muted)]">No unusual signup volume per IP.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {data.signals.signupBursts.map((row) => (
                    <li key={row.ip} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--ad-border)] p-2 text-[12.5px]">
                      <span className="font-mono">{row.ip}</span>
                      <Chip tone="warning">{row.count} signups</Chip>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[11px] text-[var(--ad-muted)]">Signup counters are per API process and reset on restart; they are a burst signal, not a permanent record.</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
