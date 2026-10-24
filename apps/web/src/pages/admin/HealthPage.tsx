import { useCallback, useEffect, useState } from 'react';
import { Activity, Bot, Database, HardDrive, History, RefreshCw, Server, Users, Wifi } from 'lucide-react';
import { adminFetch, formatBytes, formatNumber, relativeTime } from './api';
import { Chip, PageHead, Skeleton } from './ui';

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

/** System health: live service cards for the API, DB, sockets, AI, backup and disk. */
export default function HealthPage() {
  const [data, setData] = useState<HealthPayload | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

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

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <div>
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
              <p className="mt-3 text-[11.5px] text-[var(--ad-muted)]">Connection is live; realtime and AI health are in the cards beside this one.</p>
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
