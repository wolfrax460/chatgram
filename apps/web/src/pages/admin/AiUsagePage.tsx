import { useCallback, useEffect, useState } from 'react';
import { Bot, HelpCircle, MessageSquare, Sparkles } from 'lucide-react';
import { adminFetch, formatNumber, relativeTime } from './api';
import { BarChart, Chip, EmptyState, PageHead, Select, Skeleton } from './ui';

type UsagePayload = {
  days: number;
  totals: { answers: number; questions: number; unknown: number; conversations: number; knowledgeEntries: number; knowledgeUses: number };
  series: { day: string; count: number }[];
  byProvider: { provider: string; count: number }[];
  topQuestions: { question: string; count: number; lastAt: string }[];
  inboxByType: { type: string; count: number }[];
};

/** Chatgram AI usage: answers per day/provider, unknowns, top questions, inbox types. */
export default function AiUsagePage() {
  const [data, setData] = useState<UsagePayload | null>(null);
  const [days, setDays] = useState('14');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await adminFetch<UsagePayload>(`/api/admin/ai/usage?days=${days}`));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the AI usage report.');
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <PageHead
        title="AI usage"
        subtitle={data ? `Last ${data.days} days · ${formatNumber(data.totals.answers)} answers from ${formatNumber(data.totals.conversations)} conversations` : 'How Chatgram AI is being used'}
        actions={
          <Select
            label="AI usage date range"
            value={days}
            onChange={setDays}
            options={[
              { value: '7', label: 'Last 7 days' },
              { value: '14', label: 'Last 14 days' },
              { value: '30', label: 'Last 30 days' },
              { value: '90', label: 'Last 90 days' },
            ]}
          />
        }
      />
      {error ? <p role="alert" className="admin-chip admin-chip-danger mb-3">{error}</p> : null}
      {!data ? (
        <div className="admin-card admin-card-pad"><Skeleton lines={6} /></div>
      ) : (
        <>
          <div className="admin-grid sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Answers', value: data.totals.answers, icon: Bot },
              { label: 'Questions', value: data.totals.questions, icon: MessageSquare },
              { label: 'Unknown answers', value: data.totals.unknown, icon: HelpCircle },
              { label: 'Knowledge entries', value: data.totals.knowledgeEntries, icon: Sparkles },
            ].map((card) => (
              <div key={card.label} className="admin-card admin-card-pad">
                <p className="admin-kpi-label flex items-center gap-1.5"><card.icon className="h-3.5 w-3.5" /> {card.label}</p>
                <p className="admin-kpi-value mt-1">{formatNumber(card.value)}</p>
              </div>
            ))}
          </div>

          <div className="admin-grid mt-3 lg:grid-cols-3">
            <div className="admin-card admin-card-pad lg:col-span-2">
              <div className="flex items-center justify-between">
                <p className="admin-card-title">Answers per day</p>
                <Chip>{data.days} days</Chip>
              </div>
              <div className="mt-3"><BarChart points={data.series} label="AI answers per day" /></div>
            </div>
            <div className="admin-card admin-card-pad">
              <p className="admin-card-title">Answers per provider</p>
              {data.byProvider.length === 0 ? (
                <p className="mt-2 text-[12.5px] text-[var(--ad-muted)]">No answers in this period.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {data.byProvider.map((row) => {
                    const max = Math.max(...data.byProvider.map((entry) => entry.count), 1);
                    return (
                      <li key={row.provider} className="flex items-center gap-2">
                        <span className="w-24 shrink-0 truncate text-[12px] font-medium">{row.provider}</span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--ad-sunken)]">
                          <span className="block h-full rounded-full bg-[var(--ad-accent)]" style={{ width: `${(row.count / max) * 100}%` }} />
                        </span>
                        <span className="w-9 text-right text-[12px] tabular-nums">{formatNumber(row.count)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="admin-card-title mt-4">Inbox by type</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {data.inboxByType.length === 0 ? <span className="text-[12px] text-[var(--ad-muted)]">Inbox is empty.</span> : null}
                {data.inboxByType.map((row) => (
                  <Chip key={row.type} tone="warning">{row.type}: {row.count}</Chip>
                ))}
              </div>
              <p className="mt-3 text-[11.5px] text-[var(--ad-muted)]">Knowledge base answers used {formatNumber(data.totals.knowledgeUses)} times.</p>
            </div>
          </div>

          <div className="admin-card admin-card-pad mt-3">
            <p className="admin-card-title">Top questions</p>
            {data.topQuestions.length === 0 ? (
              <div className="mt-2"><EmptyState title="No questions yet" body="Chatgram AI questions appear here once people start asking." /></div>
            ) : (
              <div className="admin-scroll mt-2 overflow-x-auto">
                <table className="admin-table">
                  <thead><tr><th>Question</th><th>Asked</th><th>Last asked</th></tr></thead>
                  <tbody>
                    {data.topQuestions.map((row) => (
                      <tr key={row.question} style={{ cursor: 'default' }}>
                        <td className="max-w-[640px]"><p className="truncate text-[12.5px]">{row.question}</p></td>
                        <td className="tabular-nums">{formatNumber(row.count)}</td>
                        <td className="text-[11.5px] text-[var(--ad-muted)]">{relativeTime(row.lastAt)}</td>
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
