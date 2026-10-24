/** Admin dashboard API client + shared types (Change 2). */

export class AdminError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface AdminSessionInfo {
  authenticated: boolean;
  csrfToken: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  activeSessions: number;
  totpEnabled: boolean;
}

export async function adminFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; csrf?: string } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.csrf ? { 'X-Admin-CSRF': options.csrf } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message =
      (payload as { message?: string } | null)?.message ||
      (response.status === 401
        ? 'Your admin session expired. Sign in again.'
        : `Request failed (${response.status}).`);
    throw new AdminError(response.status, message);
  }
  return payload as T;
}

export interface OverviewKpis {
  usersTotal: number;
  newUsersToday: number;
  newUsersChange: number;
  dailyActive: number;
  monthlyActive: number;
  messagesToday: number;
  messagesChange: number;
  groups: number;
  statuses: number;
  storageBytes: number;
  onlineNow: number;
  openTickets: number;
  inboxNew: number;
  aiRequestsToday: number;
  aiDegraded: boolean;
  aiFailures10Min: number;
  openReports: number;
  negativeFeedback: number;
}

export interface SeriesPoint {
  day: string;
  count: number;
}

export interface OverviewPayload {
  kpis: OverviewKpis;
  series: {
    signups: SeriesPoint[];
    messages: SeriesPoint[];
    activeUsers: SeriesPoint[];
    aiByProvider: { provider: string; count: number }[];
  };
  generatedAt: string;
}

export interface AdminUserRow {
  id: string;
  displayName: string;
  email: string;
  phone: string;
  avatarUrl: string;
  createdAt: string;
  lastSeen: string | null;
  online: boolean;
  twoFactorEnabled: boolean;
  mustChangePassword: boolean;
  isSupportAccount: boolean;
  isAiAccount: boolean;
  reportCount: number;
}

export interface AdminUsersPayload {
  users: AdminUserRow[];
  total: number;
  page: number;
  limit: number;
  pageCount: number;
}

export interface AdminUserDetailPayload {
  user: {
    id: string;
    displayName: string;
    email: string;
    phone: string;
    avatarUrl: string;
    about: string;
    createdAt: string;
    lastSeen: string | null;
    online: boolean;
    twoFactorEnabled: boolean;
    mustChangePassword: boolean;
    isSupportAccount: boolean;
    isAiAccount: boolean;
  };
  counts: {
    messages: number;
    chats: number;
    groups: number;
    statuses: number;
    reportsAgainst: number;
    reportsMade: number;
  };
  lastMessageAt: string | null;
}

export interface InboxRow {
  id: string;
  type: string;
  question: string;
  count: number;
  status: string;
  askerHash: string;
  providerKey: string | null;
  errorReason: string | null;
  answer: string;
  canAnswerUser: boolean;
  createdAt: string;
  lastSeenAt: string;
}

export interface InboxPayload {
  items: InboxRow[];
  total: number;
  page: number;
  pageCount: number;
}

export interface ProviderRow {
  key: string;
  label: string;
  provider: string;
  model: string;
  baseUrl: string;
  enabled: boolean;
  timeoutMs: number;
  dailyTokenBudget: number;
  hasKey: boolean;
  keyLast4: string | null;
  health: {
    requests: number;
    successes: number;
    failures: number;
    tokens: number;
    averageLatencyMs: number | null;
    lastErrorCode: string | null;
    errorRate: number;
    lastSuccessAt: string | null;
  } | null;
}

export interface FeatureAssignment {
  label: string;
  primary: string | null;
  fallbacks: string[];
}

export interface ProvidersPayload {
  providers: ProviderRow[];
  features: Record<string, FeatureAssignment>;
  availableProviders: { id: string; label: string; needsKey: boolean; defaultBaseUrl: string }[];
  canUndo: boolean;
}

export interface AiPolicy {
  blockedTopics: string[];
  hourlyLimit: number;
  dailyLimit: number;
  maxInputChars: number;
  alertsEnabled: boolean;
  source?: string;
}

/* ------------------------------------------------------------- formatting */

export function formatNumber(value: number | undefined | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat().format(value);
}

export function formatBytes(bytes: number | undefined | null): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function initials(name: string | undefined): string {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
}
