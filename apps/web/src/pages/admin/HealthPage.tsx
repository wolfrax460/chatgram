import { useCallback, useEffect, useState } from 'react';
import {
  Activity, Bot, Copy, Database, HardDrive, History, Play, RefreshCw, Server, ShieldAlert, Terminal, Users, Wifi,
} from 'lucide-react';
import { adminFetch, formatBytes, formatNumber, relativeTime, type AdminSessionInfo } from './api';
import { Chip, PageHead, Select, Skeleton, useToast, Toast } from './ui';

type HealthPayload = {
  api: {
    ok: boolean;
    environment: string;
    version: string;
    uptimeSeconds: number;
    startedAt: string;
    pid: number;
    node: string;
    memory: { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number };
    host: { platform: string; cpus: number; loadAverage: number[]; totalMemoryBytes: number; freeMemoryBytes: number };
  };
  database: { state: string; name: string };
  sockets: { connections: number; online: number; staleAfterMs: number };
  ai: {
    degraded: boolean;
    failuresLast10Min: number;
    providers: { key: string; label: string; enabled: boolean; hasKey: boolean; requests: number; errorRate: number; averageLatencyMs: number | null; lastErrorCode: string | null }[];
  };
  backup: { name: string; bytes: number; at: string } | null;
  disk: { freeBytes: number; totalBytes: number } | null;
  generatedAt: string;
};

type CollectionRow = {
  name: string;
  documents: number;
  dataSizeBytes: number;
  storageSizeBytes: number;
  indexSizeBytes: number;
};

type StoragePayload = {
  database: string;
  collections: number;
  documents: number;
  dataSizeBytes: number;
  storageSizeBytes: number;
  indexSizeBytes: number;
  usedBytes: number;
  remainingBytes: number;
  limitBytes: number;
  limitSource: string;
  percentUsed: number;
  collectionsTable: CollectionRow[];
  generatedAt: string;
};

type DiagnosticCheck = { id: string; label: string; description: string; category: string };

type DiagnosticOutput = {
  id: string;
  label: string;
  ranAt: string;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
  output: string;
  truncated: boolean;
};

/** Copy text to the clipboard, with a fallback for insecure contexts. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea fallback */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
function duration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function Meter({ used, total, label }: { used: number; total: number; label: string }) {
  const ratio = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-[var(--ad-muted)]">
        <span>{label}</span>
        <span className="tabular-nums">{ratio}%</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--ad-sunken)]">
        <div
          className={`h-full rounded-full ${ratio > 90 ? 'bg-[var(--ad-danger)]' : ratio > 70 ? 'bg-[var(--ad-warning)]' : 'bg-[var(--ad-accent)]'}`}
          style={{ width: `${ratio}%` }}
        />
      </div>
    </div>
  );
}

/** System health: live service cards, database storage and read-only VM diagnostics. */
export default function HealthPage({ session }: { session?: AdminSessionInfo }) {
  const [data, setData] = useState<HealthPayload | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const [storage, setStorage] = useState<StoragePayload | null>(null);
  const [storageError, setStorageError] = useState('');

  const [checks, setChecks] = useState<DiagnosticCheck[]>([]);
  const [checkId, setCheckId] = useState('disk');
  const [result, setResult] = useState<DiagnosticOutput | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const { message: toast, show: showToast } = useToast();

  const load = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      setData(await adminFetch<HealthPayload>('/api/admin/health'));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not read the system health.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  const loadStorage = useCallback(async () => {
    try {
      setStorage(await adminFetch<StoragePayload>('/api/admin/system/storage'));
      setStorageError('');
    } catch (loadError) {
      setStorageError(loadError instanceof Error ? loadError.message : 'Could not read the database storage.');
    }
  }, []);

  const loadChecks = useCallback(async () => {
    try {
      const payload = await adminFetch<{ checks: DiagnosticCheck[] }>('/api/admin/system/diagnostics');
      setChecks(payload.checks);
      if (payload.checks.length > 0 && !payload.checks.some((check) => check.id === checkId)) {
        setCheckId(payload.checks[0]?.id ?? 'disk');
      }
    } catch {
      setChecks([]);
    }
  }, [checkId]);

  useEffect(() => {
    void load();
    void loadStorage();
    void loadChecks();
    const timer = window.setInterval(() => void load(), 15_000);
    const storageTimer = window.setInterval(() => void loadStorage(), 60_000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(storageTimer);
    };
  }, [load, loadStorage, loadChecks]);

  async function runDiagnostic() {
    if (!checkId || running) return;
    setRunning(true);
    setRunError('');
    try {
      const payload = await adminFetch<DiagnosticOutput>('/api/admin/system/diagnostics/run', {
        method: 'POST',
        csrf: session?.csrfToken,
        body: { checkId },
      });
      setResult(payload);
    } catch (runFailure) {
      setRunError(runFailure instanceof Error ? runFailure.message : 'That diagnostic could not run.');
    } finally {
      setRunning(false);
    }
  }

  const selected = checks.find((check) => check.id === checkId);

  return (
    <div>
      <Toast message={toast} />
      <PageHead
        title="System health"
        subtitle={data ? `Generated ${relativeTime(data.generatedAt)} · refreshes every 15 s` : 'Checking the services…'}
        actions={
          <button type="button" className="admin-btn" onClick={() => void load()} disabled={refreshing}>
            <RefreshCw className="h-3.5 w-3.5" /> {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />
      {error ? <p role="alert" className="admin-chip admin-chip-danger mb-3">{error}</p> : null}
      {!data ? (
        <div className="admin-card admin-card-pad">
          <Skeleton lines={6} />
        </div>
      ) : (
        <>
          <div className="admin-grid sm:grid-cols-2 xl:grid-cols-4">
            <div className="admin-card admin-card-pad">
              <p className="admin-card-title">
                <Server className="h-4 w-4" /> API
              </p>
              <p className="mt-2 text-[18px] font-bold">{duration(data.api.uptimeSeconds)} uptime</p>
              <p className="mt-1 text-[11.5px] text-[var(--ad-muted)]">
                {data.api.environment} · v{data.api.version} · node {data.api.node} · pid {data.api.pid}
              </p>
              <div className="mt-3">
                <Meter used={data.api.memory.rssBytes} total={data.api.host.totalMemoryBytes} label={`RSS ${formatBytes(data.api.memory.rssBytes)}`} />
              </div>
            </div>
            <div className="admin-card admin-card-pad">
              <p className="admin-card-title">
                <Database className="h-4 w-4" /> MongoDB
              </p>
              <p className="mt-2 flex items-center gap-2">
                <Chip tone={data.database.state === 'connected' ? 'success' : 'danger'}>{data.database.state}</Chip>
                <span className="text-[12px] text-[var(--ad-muted)]">{data.database.name || 'database'}</span>
              </p>
              {storage ? (
                <>
                  <p className="mt-2 text-[18px] font-bold tabular-nums">
                    {formatBytes(storage.usedBytes)} <span className="text-[12px] font-medium text-[var(--ad-muted)]">of {formatBytes(storage.limitBytes)}</span>
                  </p>
                  <div className="mt-2">
                    <Meter used={storage.usedBytes} total={storage.limitBytes} label={`${storage.percentUsed}% used · ${formatBytes(storage.remainingBytes)} free`} />
                  </div>
                </>
              ) : (
                <p className="mt-3 text-[11.5px] text-[var(--ad-muted)]">Reading storage usage…</p>
              )}
            </div>
            <div className="admin-card admin-card-pad">
              <p className="admin-card-title">
                <Wifi className="h-4 w-4" /> Realtime
              </p>
              <p className="mt-2 text-[18px] font-bold">{formatNumber(data.sockets.connections)} sockets</p>
              <p className="mt-1 text-[11.5px] text-[var(--ad-muted)]">
                {formatNumber(data.sockets.online)} people online · stale after {Math.round(data.sockets.staleAfterMs / 1000)} s
              </p>
            </div>
            <div className="admin-card admin-card-pad">
              <p className="admin-card-title">
                <Bot className="h-4 w-4" /> AI layer
              </p>
              <p className="mt-2">
                <Chip tone={data.ai.degraded ? 'warning' : 'success'}>{data.ai.degraded ? 'degraded' : 'healthy'}</Chip>
              </p>
              <p className="mt-1 text-[11.5px] text-[var(--ad-muted)]">{data.ai.failuresLast10Min} provider failures in the last 10 minutes</p>
            </div>
          </div>

          <div className="admin-grid mt-3 lg:grid-cols-2">
            <div className="admin-card admin-card-pad">
              <p className="admin-card-title">
                <Users className="h-4 w-4" /> Host
              </p>
              <div className="mt-2 space-y-2 text-[12.5px]">
                <div className="flex justify-between"><span className="text-[var(--ad-muted)]">Platform</span><span>{data.api.host.platform}</span></div>
                <div className="flex justify-between"><span className="text-[var(--ad-muted)]">CPU cores</span><span>{data.api.host.cpus}</span></div>
                <div className="flex justify-between"><span className="text-[var(--ad-muted)]">Load average</span><span className="tabular-nums">{data.api.host.loadAverage.join(' / ')}</span></div>
                <div className="flex justify-between"><span className="text-[var(--ad-muted)]">Free RAM</span><span>{formatBytes(data.api.host.freeMemoryBytes)} of {formatBytes(data.api.host.totalMemoryBytes)}</span></div>
              </div>
              <div className="mt-3">
                <Meter used={data.api.host.totalMemoryBytes - data.api.host.freeMemoryBytes} total={data.api.host.totalMemoryBytes} label="RAM used" />
              </div>
              {data.disk ? (
                <div className="mt-3">
                  <Meter used={data.disk.totalBytes - data.disk.freeBytes} total={data.disk.totalBytes} label={`Disk ${formatBytes(data.disk.freeBytes)} free`} />
                </div>
              ) : null}
            </div>
            <div className="admin-card admin-card-pad">
              <p className="admin-card-title">
                <History className="h-4 w-4" /> Backups
              </p>
              {data.backup ? (
                <div className="mt-2 text-[12.5px]">
                  <p className="font-mono text-[12px]">{data.backup.name}</p>
                  <p className="mt-1 text-[var(--ad-muted)]">
                    {formatBytes(data.backup.bytes)} · {relativeTime(data.backup.at)} ({new Date(data.backup.at).toLocaleString()})
                  </p>
                  <div className="mt-2">
                    <Chip tone={Date.now() - new Date(data.backup.at).getTime() > 48 * 3600 * 1000 ? 'warning' : 'success'}>
                      {Date.now() - new Date(data.backup.at).getTime() > 48 * 3600 * 1000 ? 'older than 48 h' : 'recent'}
                    </Chip>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-[12.5px] text-[var(--ad-muted)]">No backup archive found on this host.</p>
              )}
              <p className="mt-3 flex items-center gap-2 text-[11.5px] text-[var(--ad-muted)]">
                <HardDrive className="h-3.5 w-3.5" /> Restore instructions live in docs/deploy.md §5.
              </p>
            </div>
          </div>

          {/* Database storage: how much of the plan is used and what is left. */}
          <div className="admin-card admin-card-pad mt-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="admin-card-title">
                <Database className="h-4 w-4" /> Database storage
              </p>
              <button type="button" className="admin-btn admin-btn-sm" onClick={() => void loadStorage()} aria-label="Refresh database storage">
                <RefreshCw className="h-3 w-3" /> Refresh
              </button>
            </div>
            {storageError ? (
              <p role="alert" className="admin-chip admin-chip-danger mt-2">{storageError}</p>
            ) : !storage ? (
              <div className="mt-2"><Skeleton lines={3} /></div>
            ) : (
              <>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg bg-[var(--ad-sunken)] p-3">
                    <p className="text-[11px] uppercase tracking-wide text-[var(--ad-faint)]">Used</p>
                    <p className="mt-0.5 text-[16px] font-bold tabular-nums">{formatBytes(storage.usedBytes)}</p>
                    <p className="text-[11px] text-[var(--ad-muted)]">{storage.percentUsed}% of {formatBytes(storage.limitBytes)}</p>
                  </div>
                  <div className="rounded-lg bg-[var(--ad-sunken)] p-3">
                    <p className="text-[11px] uppercase tracking-wide text-[var(--ad-faint)]">Remaining</p>
                    <p className="mt-0.5 text-[16px] font-bold tabular-nums">{formatBytes(storage.remainingBytes)}</p>
                    <p className="text-[11px] text-[var(--ad-muted)]">before the plan limit</p>
                  </div>
                  <div className="rounded-lg bg-[var(--ad-sunken)] p-3">
                    <p className="text-[11px] uppercase tracking-wide text-[var(--ad-faint)]">Documents</p>
                    <p className="mt-0.5 text-[16px] font-bold tabular-nums">{formatNumber(storage.documents)}</p>
                    <p className="text-[11px] text-[var(--ad-muted)]">{formatNumber(storage.collections)} collections</p>
                  </div>
                  <div className="rounded-lg bg-[var(--ad-sunken)] p-3">
                    <p className="text-[11px] uppercase tracking-wide text-[var(--ad-faint)]">Size split</p>
                    <p className="mt-0.5 text-[13px] font-semibold tabular-nums">
                      data {formatBytes(storage.dataSizeBytes)} · index {formatBytes(storage.indexSizeBytes)}
                    </p>
                    <p className="text-[11px] text-[var(--ad-muted)]">on-disk {formatBytes(storage.storageSizeBytes)}</p>
                  </div>
                </div>
                <div className="mt-3">
                  <Meter
                    used={storage.usedBytes}
                    total={storage.limitBytes}
                    label={`${storage.database} · limit from ${storage.limitSource}`}
                  />
                </div>
                {storage.percentUsed >= 85 ? (
                  <p className="admin-chip admin-chip-warning mt-3">
                    <ShieldAlert className="h-3.5 w-3.5" /> Storage is nearly full. Archive or delete old media, or move to a larger Atlas tier.
                  </p>
                ) : null}
                {storage.collectionsTable.length > 0 ? (
                  <div className="admin-scroll mt-3 overflow-x-auto">
                    <table className="admin-table">
                      <thead>
                        <tr><th>Collection</th><th>Documents</th><th>Data</th><th>Indexes</th><th>On disk</th></tr>
                      </thead>
                      <tbody>
                        {storage.collectionsTable.map((row) => (
                          <tr key={row.name} style={{ cursor: 'default' }}>
                            <td className="font-mono text-[12px]">{row.name}</td>
                            <td className="tabular-nums">{formatNumber(row.documents)}</td>
                            <td className="tabular-nums">{formatBytes(row.dataSizeBytes)}</td>
                            <td className="tabular-nums">{formatBytes(row.indexSizeBytes)}</td>
                            <td className="tabular-nums">{formatBytes(row.storageSizeBytes)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                <p className="mt-2 text-[11px] text-[var(--ad-faint)]">
                  Largest {storage.collectionsTable.length} collections · read from MongoDB dbStats/collStats · refreshed every 60 s.
                </p>
              </>
            )}
          </div>

          {/* VM diagnostics: fixed, allowlisted commands only. */}
          <div className="admin-card admin-card-pad mt-3">
            <p className="admin-card-title">
              <Terminal className="h-4 w-4" /> Server diagnostics
            </p>
            <p className="mt-1 text-[11.5px] text-[var(--ad-muted)]">
              Runs a fixed, read-only command on the Oracle VM (disk, memory, services, PM2, logs, backups). The server
              accepts only a check id from this list — never a shell command — and records every run in the audit log with
              credential-like output redacted.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-[240px] flex-1">
                <Select
                  label="Diagnostic"
                  value={checkId}
                  onChange={(value) => { setCheckId(value); setRunError(''); }}
                  options={checks.map((check) => ({ value: check.id, label: `${check.label} — ${check.description}` }))}
                />
              </div>
              <button type="button" className="admin-btn admin-btn-primary" onClick={() => void runDiagnostic()} disabled={running || checks.length === 0}>
                <Play className="h-3.5 w-3.5" /> {running ? 'Running…' : 'Run'}
              </button>
            </div>
            {selected ? <p className="mt-1 text-[11.5px] text-[var(--ad-faint)]">{selected.description}</p> : null}
            {runError ? <p role="alert" className="admin-chip admin-chip-danger mt-2">{runError}</p> : null}
            {result ? (
              <div className="mt-3">
                <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--ad-muted)]">
                  <Chip tone={result.exitCode === 0 ? 'success' : result.exitCode === null ? undefined : 'danger'}>
                    exit {result.exitCode === null ? 'n/a' : result.exitCode}
                  </Chip>
                  {result.timedOut ? <Chip tone="warning">timed out</Chip> : null}
                  {result.truncated ? <Chip tone="warning">truncated</Chip> : null}
                  <span>{result.durationMs} ms</span>
                  <span>· {relativeTime(result.ranAt)}</span>
                  <button
                    type="button"
                    className="admin-btn admin-btn-sm ml-auto"
                    onClick={async () => {
                      const ok = await copyText(result.output);
                      showToast(ok ? 'Output copied.' : 'Could not copy.');
                    }}
                  >
                    <Copy className="h-3 w-3" /> Copy
                  </button>
                </div>
                <pre className="admin-scroll mt-2 max-h-[340px] overflow-auto rounded-lg bg-[var(--ad-sunken)] p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words">
                  {result.output}
                </pre>
              </div>
            ) : null}
          </div>

          <div className="admin-card admin-card-pad mt-3">
            <p className="admin-card-title">
              <Activity className="h-4 w-4" /> AI providers
            </p>
            {data.ai.providers.length === 0 ? (
              <p className="mt-2 text-[12.5px] text-[var(--ad-muted)]">No providers configured in the dashboard — the environment key is used instead.</p>
            ) : (
              <div className="admin-scroll mt-2 overflow-x-auto">
                <table className="admin-table">
                  <thead>
                    <tr><th>Provider</th><th>State</th><th>Requests</th><th>Latency</th><th>Error rate</th><th>Last error</th></tr>
                  </thead>
                  <tbody>
                    {data.ai.providers.map((row) => (
                      <tr key={row.key} style={{ cursor: 'default' }}>
                        <td><p className="font-semibold">{row.label}</p><p className="text-[11px] text-[var(--ad-faint)]">{row.key}</p></td>
                        <td>{row.enabled ? <Chip tone="success">enabled</Chip> : <Chip>disabled</Chip>}{row.hasKey ? null : <span className="ml-1 text-[10.5px] text-[var(--ad-faint)]">no key</span>}</td>
                        <td className="tabular-nums">{formatNumber(row.requests)}</td>
                        <td className="tabular-nums">{row.averageLatencyMs ? `${row.averageLatencyMs} ms` : '—'}</td>
                        <td className={`tabular-nums ${row.errorRate > 0 ? 'text-[var(--ad-danger)]' : ''}`}>{Math.round(row.errorRate * 100)}%</td>
                        <td className="text-[11.5px]">{row.lastErrorCode || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
