import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowUpRight, Bot, Clock, Inbox, LifeBuoy, MessageSquare, ShieldAlert, Sparkles, Users,
} from 'lucide-react';
import {
  adminFetch, formatBytes, formatNumber, relativeTime, type AdminSessionInfo, type OverviewPayload,
} from './api';
import { BarChart, Chip, EmptyState, PageHead, Skeleton, Sparkline, StatCard } from './ui';

/**
 * Overview: the operational heartbeat of Chatgram — KPI cards with sparklines,
 * 14/30/90-day series, AI usage per provider and a "needs attention" panel.
 */
export default function OverviewPage({ session, days }: { session: AdminSessionInfo; days: number }) {
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      setData(await adminFetch<OverviewPayload>(`/api/admin/overview?days=${days}`));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the overview.');
    } finally {
      setRefreshing(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const kpis = data?.kpis;
  const series = data?.series;

  return (
    <div>
      <PageHead
        title="Overview"
        subtitle={`How Chatgram is doing today${data ? ` · updated ${relativeTime(data.generatedAt)}` : ''}`}
        actions={
          <>
            <Chip tone={kpis?.aiDegraded ? 'warning' : 'success'}>
              <Bot className="h-3 w-3" /> {kpis?.aiDegraded ? `AI degraded (${kpis.aiFailures10Min} failures)` : 'AI healthy'}
            </Chip>
            <button type="button" className="admin-btn" onClick={() => void load()} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </>
        }
      />
      {error ? <p role="alert" className="admin-chip admin-chip-danger mb-3">{error}</p> : null}

      {!kpis || !series ? (
        <div className="admin-grid sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="admin-card admin-card-pad">
              <Skeleton lines={3} />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="admin-grid sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Users" value={formatNumber(kpis.usersTotal)} trend={kpis.newUsersChange} values={series.signups.map((point) => point.count)} />
            <StatCard label="Messages today" value={formatNumber(kpis.messagesToday)} trend={kpis.messagesChange} values={series.messages.slice(-7).map((point) => point.count)} />
            <StatCard label="Online now" value={formatNumber(kpis.onlineNow)} hint={`${formatNumber(kpis.dailyActive)} active today`} />
            <StatCard label="Monthly active" value={formatNumber(kpis.monthlyActive)} hint="unique senders, 30 days" />
            <StatCard label="Groups" value={formatNumber(kpis.groups)} hint="group conversations" />
            <StatCard label="Statuses" value={formatNumber(kpis.statuses)} hint={`${formatBytes(kpis.storageBytes)} of media`} />
            <StatCard label="AI requests today" value={formatNumber(kpis.aiRequestsToday)} tone={kpis.aiDegraded ? 'warning' : 'default'} hint={kpis.aiDegraded ? 'provider failures detected' : 'answered by the AI layer'} />
            <StatCard label="Open tickets" value={formatNumber(kpis.openTickets)} hint={`${formatNumber(kpis.inboxNew)} AI inbox items`} tone={kpis.openTickets > 0 ? 'warning' : 'default'} />
          </div>

          <div className="admin-grid mt-3 lg:grid-cols-3">
            <div className="admin-card admin-card-pad lg:col-span-2">
              <div className="flex items-center justify-between">
                <p className="admin-card-title">Messages per day</p>
                <span className="admin-chip">{days} days</span>
              </div>
              <div className="mt-3">
                <BarChart points={series.messages} label="Messages per day" />
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="admin-section-label">New users</p>
                  <Sparkline values={series.signups.map((point) => point.count)} width={250} height={44} label="Signups" />
                  <p className="mt-1 text-[11.5px] text-[var(--ad-muted)]">{formatNumber(series.signups.reduce((sum, point) => sum + point.count, 0))} new accounts in this period</p>
                </div>
                <div>
                  <p className="admin-section-label">Active users</p>
                  <Sparkline values={series.activeUsers.map((point) => point.count)} width={250} height={44} label="Active users" accent="var(--ad-warning)" />
                  <p className="mt-1 text-[11.5px] text-[var(--ad-muted)]">People who sent at least one message</p>
                </div>
              </div>
            </div>

            <div className="admin-card admin-card-pad">
              <p className="admin-card-title">
                Needs attention
                {kpis.inboxNew + kpis.openReports + kpis.openTickets > 0 ? <Chip tone="warning">open</Chip> : <Chip tone="success">all clear</Chip>}
              </p>
              <ul className="mt-3 space-y-2 text-[12.5px]">
                <li>
                  <Link to="/admin/reports" className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--ad-sunken)]">
                    <AlertTriangle className="h-4 w-4 text-[var(--ad-warning)]" />
                    <span className="flex-1">Open reports</span>
                    <span className="font-semibold">{formatNumber(kpis.openReports)}</span>
                    <ArrowUpRight className="h-3.5 w-3.5 opacity-60" />
                  </Link>
                </li>
                <li>
                  <Link to="/admin/inbox" className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--ad-sunken)]">
                    <Inbox className="h-4 w-4 text-[var(--ad-accent)]" />
                    <span className="flex-1">AI inbox questions</span>
                    <span className="font-semibold">{formatNumber(kpis.inboxNew)}</span>
                    <ArrowUpRight className="h-3.5 w-3.5 opacity-60" />
                  </Link>
                </li>
                <li>
                  <Link to="/admin/support" className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--ad-sunken)]">
                    <LifeBuoy className="h-4 w-4 text-[var(--ad-warning)]" />
                    <span className="flex-1">Open support tickets</span>
                    <span className="font-semibold">{formatNumber(kpis.openTickets)}</span>
                    <ArrowUpRight className="h-3.5 w-3.5 opacity-60" />
                  </Link>
                </li>
                <li>
                  <Link to="/admin/inbox" className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--ad-sunken)]">
                    <ShieldAlert className="h-4 w-4 text-[var(--ad-danger)]" />
                    <span className="flex-1">Thumbs-down answers</span>
                    <span className="font-semibold">{formatNumber(kpis.negativeFeedback)}</span>
                    <ArrowUpRight className="h-3.5 w-3.5 opacity-60" />
                  </Link>
                </li>
                <li>
                  <Link to="/admin/providers" className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--ad-sunken)]">
                    <Bot className="h-4 w-4 text-[var(--ad-accent)]" />
                    <span className="flex-1">AI provider failures (10 min)</span>
                    <span className="font-semibold">{formatNumber(kpis.aiFailures10Min)}</span>
                    <ArrowUpRight className="h-3.5 w-3.5 opacity-60" />
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="admin-grid mt-3 lg:grid-cols-2">
            <div className="admin-card admin-card-pad">
              <p className="admin-card-title">
                <Sparkles className="h-4 w-4" /> AI usage per provider
              </p>
              {series.aiByProvider.length === 0 ? (
                <div className="mt-3">
                  <EmptyState title="No AI answers in this period" body="As soon as Chatgram AI answers, requests and providers show up here." icon={<Sparkles className="h-6 w-6" />} />
                </div>
              ) : (
                <ul className="mt-3 space-y-2">
                  {series.aiByProvider.map((row) => {
                    const max = Math.max(...series.aiByProvider.map((item) => item.count), 1);
                    return (
                      <li key={row.provider} className="flex items-center gap-3">
                        <span className="w-24 shrink-0 truncate text-[12px] font-medium">{row.provider}</span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--ad-sunken)]">
                          <span className="block h-full rounded-full bg-[var(--ad-accent)]" style={{ width: `${(row.count / max) * 100}%` }} />
                        </span>
                        <span className="w-10 text-right text-[12px] tabular-nums">{formatNumber(row.count)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="admin-card admin-card-pad">
              <p className="admin-card-title">
                <MessageSquare className="h-4 w-4" /> Quick actions
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {[
                  { label: 'Search users', to: '/admin/users', icon: Users },
                  { label: 'Open the AI inbox', to: '/admin/inbox', icon: Inbox },
                  { label: 'Model providers', to: '/admin/providers', icon: Bot },
                  { label: 'Admin security', to: '/admin/security', icon: Clock },
                ].map((action) => (
                  <Link key={action.to} to={action.to} className="admin-btn justify-start no-underline">
                    <action.icon className="h-3.5 w-3.5" /> {action.label}
                  </Link>
                ))}
              </div>
              <p className="mt-3 text-[11.5px] text-[var(--ad-muted)]">
                Signed in as an admin session — Chatgram accounts cannot open this dashboard. Every action is written to the audit log.
              </p>
              <p className="mt-1 text-[11px] text-[var(--ad-faint)]">Session started {new Date(session.createdAt).toLocaleString()}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
