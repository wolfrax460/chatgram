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
  status: 'active' | 'suspended' | 'banned';
  suspendedUntil: string | null;
  moderationReason: string;
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
    verifiedAt: string | null;
    deletionScheduledAt: string | null;
    warningCount: number;
    sessionCount: number;
    status: 'active' | 'suspended' | 'banned';
    suspendedUntil: string | null;
    moderationReason: string;
  };
  warnings: { id: string; reason: string; createdAt: string }[];
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

/**
 * A Telegram reply the admin wrote on a report (two-way replies, Chunk 1).
 * Optional everywhere because older staging/production builds may not store it
 * yet — the UI simply hides the block when the field is absent.
 */
export interface InboxTelegramReply {
  text: string;
  at: string | null;
  sentToUser: boolean;
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
  duplicateCount: number;
  createdAt: string;
  lastSeenAt: string;
  /* 1A AI report fields (server fills these; defaults keep legacy rows safe). */
  title?: string;
  summary?: string;
  userText?: string;
  source?: string;
  askerName?: string;
  askerId?: string | null;
  ref?: string;
  fixPrompt?: string;
  fixPromptSource?: string;
  fixPromptQuestions?: string[];
  transcript?: string;
  telegramMessageId?: number | null;
  telegramReply?: InboxTelegramReply | null;
}

export interface InboxPayload {
  items: InboxRow[];
  total: number;
  page: number;
  pageCount: number;
}

export interface InboxCombineRecord {
  id: string;
  ref: string;
  title: string;
}

/** Response of POST /api/admin/ai/inbox/combine. */
export interface InboxCombineResult {
  prompt: string;
  records: InboxCombineRecord[];
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

/** Exact local timestamp for report details (the admin needs the real time). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Copy text to the clipboard. Uses the async Clipboard API when available and
 * falls back to a hidden textarea + execCommand for older/embedded browsers and
 * non-secure origins. Returns true when the copy actually happened.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or insecure context: fall through to the DOM fallback.
  }
  try {
    if (typeof document === 'undefined') return false;
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '-9999px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, area.value.length);
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

export function initials(name: string | undefined): string {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
}

/* ------------------------------------------------- 9d security-review oversight */

export interface ReviewRow {
  id: string;
  reason: string;
  reference: string;
  scope: 'conversations' | 'search';
  status: 'active' | 'ended' | 'expired';
  createdAt: string;
  expiresAt: string;
  endedAt: string | null;
  secondsLeft: number;
  views: number;
  user: { id: string; displayName: string; email: string; avatarUrl: string } | null;
}

export interface ReviewLogPayload {
  reviews: ReviewRow[];
  page: number;
  limit: number;
  total: number;
  retentionDays: number;
}

export interface ReviewStats {
  lastHour: number;
  lastDay: number;
  active: number;
  burstThreshold: number;
  rateLimitPerHour: number;
  retentionDays: number;
  burst: boolean;
}

export interface ReviewConversation {
  id: string;
  type: 'direct' | 'group';
  title: string;
  participants: { id: string; displayName: string; avatarUrl: string }[];
  lastMessageAt: string | null;
  lastMessage: string;
  frozen: boolean;
}

export interface ReviewMessage {
  id: string;
  senderId: string;
  senderName: string;
  type: string;
  content: string;
  mediaUrl: string;
  sentAt: string;
  editedAt: string | null;
  isDeleted: boolean;
  readCount: number;
}

export interface UserSessionRow {
  id: string;
  ip: string;
  userAgent: string;
  deviceLabel: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

export interface LoginEventRow {
  id: string;
  ip: string;
  userAgent: string;
  method: string;
  at: string;
}

export interface UserSessionsPayload {
  sessions: UserSessionRow[];
  logins: LoginEventRow[];
}
