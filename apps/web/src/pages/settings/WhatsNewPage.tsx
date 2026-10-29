import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ExternalLink, RefreshCw, Sparkles } from 'lucide-react';
import { ApiError } from '@chatgram/api-client';
import { api } from '../../lib/api';
import type { SettingsPageProps } from './types';
import { SettingsNotice, SettingsPage, focusRing } from './ui';

/**
 * What's new — release notes.
 * Contract being built in parallel: GET /api/app/changelog?limit=20.
 * The exact schema is not final, so parsing is tolerant (array or
 * entries/changelog/releases/items; version/platform/date/notes aliases).
 * 404 → honest "Changelog is not available yet" with the /docs/ link fallback;
 * other failures → error state with retry.
 */
const CAPPED_NOTES_CHARS = 320;

interface ChangelogEntry {
  id: string;
  version: string;
  platform: string;
  date: string | null;
  notes: string;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseNotes(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          return asText(record.text) || asText(record.note) || asText(record.title);
        }
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

function parseDate(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function parseEntries(payload: unknown): ChangelogEntry[] {
  const record = (payload ?? {}) as Record<string, unknown>;
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(record.entries)
      ? record.entries
      : Array.isArray(record.changelog)
        ? record.changelog
        : Array.isArray(record.releases)
          ? record.releases
          : Array.isArray(record.items)
            ? record.items
            : [];
  const entries: ChangelogEntry[] = [];
  list.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const item = raw as Record<string, unknown>;
    const platforms = Array.isArray(item.platforms)
      ? item.platforms.filter((platform): platform is string => typeof platform === 'string').join(', ')
      : '';
    const notes = parseNotes(item.notes ?? item.body ?? item.changes ?? item.description ?? item.summary);
    if (!notes) return;
    entries.push({
      id: asText(item.id) || asText(item._id) || `${asText(item.version ?? item.appVersion ?? item.tag)}-${index}`,
      version: asText(item.version) || asText(item.appVersion) || asText(item.tag) || asText(item.name) || 'Release',
      platform:
        asText(item.platform) || asText(item.target) || asText(item.channel) || platforms || 'All platforms',
      date: parseDate(item.date ?? item.publishedAt ?? item.releasedAt ?? item.createdAt),
      notes,
    });
  });
  // Newest first: dated entries descending, undated entries keep server order.
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const aTime = a.entry.date ? Date.parse(a.entry.date) : Number.NaN;
      const bTime = b.entry.date ? Date.parse(b.entry.date) : Number.NaN;
      if (!Number.isNaN(aTime) && !Number.isNaN(bTime)) return bTime - aTime || a.index - b.index;
      if (!Number.isNaN(aTime)) return -1;
      if (!Number.isNaN(bTime)) return 1;
      return a.index - b.index;
    })
    .map((item) => item.entry);
}

function isMissingRoute(error: unknown): boolean {
  const status = error instanceof ApiError ? error.status : 0;
  return status === 404 || status === 405 || status === 501;
}

function platformTone(platform: string): string {
  const value = platform.toLowerCase();
  if (value.includes('android')) return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (value.includes('windows') || value.includes('desktop')) return 'bg-sky-500/10 text-sky-700 dark:text-sky-300';
  if (value.includes('web') || value.includes('browser')) return 'bg-violet-500/10 text-violet-700 dark:text-violet-300';
  return 'bg-ink-200/70 text-ink-600 dark:bg-white/10 dark:text-ink-300';
}

function ChangelogCard({ entry }: { entry: ChangelogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const long = entry.notes.length > CAPPED_NOTES_CHARS || entry.notes.split('\n').length > 6;
  const dateLabel = entry.date
    ? new Date(entry.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  // Curated server versions look like `web-2026.10.29`; only add a `v` prefix
  // for plain numeric versions so the tag never reads "vweb-…".
  const versionLabel = /^\d/.test(entry.version) ? `v${entry.version}` : entry.version;
  return (
    <article
      data-testid="whats-new-entry"
      className="rounded-2xl border border-ink-200 bg-white p-3 dark:border-white/10 dark:bg-white/[.03]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-testid="whats-new-version"
          className="rounded-full bg-brand-600/10 px-2 py-0.5 text-[11px] font-bold text-brand-700 dark:text-brand-300"
        >
          {versionLabel}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${platformTone(entry.platform)}`}>
          {entry.platform}
        </span>
        {dateLabel ? <span className="ml-auto text-[11px] text-ink-500 dark:text-ink-400">{dateLabel}</span> : null}
      </div>
      <div className={`relative mt-2 ${!expanded && long ? 'max-h-[7.5rem] overflow-hidden' : ''}`}>
        <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-200">
          {entry.notes}
        </p>
        {!expanded && long ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white to-transparent dark:from-[#151f26]" />
        ) : null}
      </div>
      {long ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className={`mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand-700 dark:text-brand-300 ${focusRing}`}
        >
          <ChevronDown className={`h-3.5 w-3.5 transition ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </article>
  );
}

export default function WhatsNewPage({ onBack }: SettingsPageProps) {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setUnavailable(false);
    try {
      const payload = await api.request<unknown>('/api/app/changelog?limit=20');
      setEntries(parseEntries(payload));
    } catch (err) {
      if (isMissingRoute(err)) {
        setUnavailable(true);
        setEntries([]);
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not load the release notes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const empty = useMemo(() => !loading && !error && !unavailable && entries.length === 0, [loading, error, unavailable, entries.length]);

  return (
    <SettingsPage
      title="What's new"
      description="Release notes for Chatgram"
      onBack={onBack}
      testId="whats-new-page"
    >
      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading release notes">
          {[0, 1, 2].map((index) => (
            <div key={index} className="animate-pulse rounded-2xl border border-ink-200 p-3 dark:border-white/10">
              <div className="h-4 w-24 rounded bg-ink-200 dark:bg-white/10" />
              <div className="mt-2 h-3 w-full rounded bg-ink-200/70 dark:bg-white/5" />
              <div className="mt-1.5 h-3 w-4/5 rounded bg-ink-200/70 dark:bg-white/5" />
            </div>
          ))}
        </div>
      ) : null}

      {unavailable ? (
        <div>
          <SettingsNotice tone="warning">
            Changelog is not available yet. The release-notes route is still being rolled out.
          </SettingsNotice>
          <a
            href="/docs/"
            target="_blank"
            rel="noreferrer noopener"
            className={`btn-ghost mt-3 w-full ${focusRing}`}
            data-testid="whats-new-docs-link"
          >
            <ExternalLink className="h-4 w-4" /> Read the documentation instead
          </a>
        </div>
      ) : null}

      {error ? (
        <div>
          <SettingsNotice tone="error">{error}</SettingsNotice>
          <button
            type="button"
            onClick={() => void load()}
            data-testid="whats-new-retry"
            className={`btn-ghost mt-3 w-full ${focusRing}`}
          >
            <RefreshCw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : null}

      {empty ? (
        <div className="px-2 py-10 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-ink-400" aria-hidden="true" />
          <p className="mt-2 text-[14px] font-semibold">No release notes yet</p>
          <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-relaxed text-ink-500 dark:text-ink-400">
            Release notes will appear here after the next update.
          </p>
        </div>
      ) : null}

      {!loading && !error && !unavailable && entries.length > 0 ? (
        <div className="space-y-2">
          {entries.map((entry) => (
            <ChangelogCard key={entry.id} entry={entry} />
          ))}
          <p className="flex items-center justify-center gap-1.5 pt-2 text-[11px] text-ink-500 dark:text-ink-400">
            Showing the {entries.length} newest release
            {entries.length === 1 ? '' : 's'}.
          </p>
        </div>
      ) : null}
    </SettingsPage>
  );
}

