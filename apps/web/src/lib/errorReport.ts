/**
 * Client side of Help → Errors: turn a user's complaint into a precise
 * debugging / feature-request prompt.
 *
 * The intended endpoint is `POST /api/help/error-report` (auth) →
 * `{ id, kind: 'bug'|'feature', prompt, summary }`. It is being added in
 * parallel, so every failure that means "the server is not available" (404 not
 * deployed yet, 503 AI down, network) is handled by building the same prompt
 * locally, telling the user plainly that it was saved rather than sent, and
 * retrying from the next Help visit.
 *
 * Context is deliberately limited to safe, non-personal facts: app version,
 * hosting shell, current route and (when cheap) the last Help action. Message
 * text is user-authored; obvious credentials are masked before it leaves the
 * browser.
 */
import { ApiError } from '@chatgram/api-client';
import { api, APP_VERSION } from './api';
import { appShell, type AppShell } from './nativeNotifications';

export type ErrorReportKind = 'bug' | 'feature';
export type ErrorReportPlatform = 'web' | 'android' | 'windows';

export interface ErrorReportContext {
  appVersion?: string;
  platform?: ErrorReportPlatform;
  screen?: string;
  lastAction?: string;
  errorCode?: string;
}

export interface ErrorReportInput {
  message: string;
  context?: ErrorReportContext;
}

/** What the server returns for a report it classified. */
export interface ErrorReportResult {
  id: string;
  kind: ErrorReportKind;
  prompt: string;
  summary: string;
}

/** A report the server did not take, kept locally and retried later. */
export interface PendingErrorReport {
  localId: string;
  createdAt: string;
  input: ErrorReportInput;
  kind: ErrorReportKind;
  prompt: string;
  summary: string;
}

export type ErrorReportOutcome =
  | { status: 'sent'; result: ErrorReportResult }
  | { status: 'queued'; report: PendingErrorReport }
  | { status: 'rejected'; message: string };

export const MAX_ERROR_REPORT_CHARS = 2000;
const PENDING_KEY = 'chatgram.errorReports.pending';
const MAX_PENDING_REPORTS = 5;

/* ------------------------------------------------------------------ context */

function shellToPlatform(shell: AppShell): ErrorReportPlatform {
  return shell === 'android' ? 'android' : shell === 'windows' ? 'windows' : 'web';
}

export function platformLabel(platform: ErrorReportPlatform | undefined): string {
  if (platform === 'android') return 'Android app';
  if (platform === 'windows') return 'Windows app';
  return 'Web browser';
}

/** Human label for the current route (in-app tabs are not routes). */
export function currentScreenLabel(): string {
  try {
    const path = window.location.pathname.replace(/^\/web\/?/, '/').replace(/\/+$/, '') || '/';
    if (path === '/') return 'Chats (main app)';
    if (path.startsWith('/join')) return 'Group invite link';
    if (path.startsWith('/admin')) return 'Admin dashboard';
    return path;
  } catch {
    return 'Chats (main app)';
  }
}

/** Safe context collected before the user sends anything. */
export function defaultErrorReportContext(): ErrorReportContext {
  return {
    appVersion: APP_VERSION,
    platform: shellToPlatform(appShell()),
    screen: currentScreenLabel(),
  };
}

/** Replace anything that looks like a credential before it leaves the browser. */
export function redactSecrets(text: string): string {
  return text
    .replace(/(password\s*(?:is|=|:)\s*)(\S+)/gi, '$1****')
    .replace(/((?:token|secret|otp|code)\s*(?:is|=|:)\s*)(\S+)/gi, '$1****')
    .replace(/(verification code\s*(?:is|=|:)\s*)(\d{4,8})/gi, '$1****');
}

/* ------------------------------------------------------- local prompt build */

const FEATURE_REQUEST_RE =
  /\b(feature request|please add|please support|would be (nice|great|useful)|it would be (nice|great|better)|can you (add|make|implement)|suggest(ion)?|i wish)\b/i;

/** Cheap client-side classification, used only for the local fallback prompt. */
export function classifyErrorReport(message: string): ErrorReportKind {
  return FEATURE_REQUEST_RE.test(message) ? 'feature' : 'bug';
}

function firstLine(text: string, limit: number): string {
  const line = text.split('\n').map((part) => part.trim()).find(Boolean) ?? '';
  return line.length > limit ? `${line.slice(0, limit - 1).trimEnd()}…` : line;
}

/**
 * Deterministic template prompt, identical to what the team asks for when the
 * AI is unavailable server-side. Pure function so the fallback is predictable.
 */
export function buildLocalErrorPrompt(input: ErrorReportInput): {
  kind: ErrorReportKind;
  prompt: string;
  summary: string;
} {
  const message = input.message.trim();
  const kind = classifyErrorReport(message);
  const context = input.context ?? {};
  const version = context.appVersion ?? APP_VERSION;
  const platform = context.platform ?? shellToPlatform(appShell());
  const screen = context.screen ?? currentScreenLabel();
  const lastAction = context.lastAction?.trim();

  const title =
    firstLine(message, 90) ||
    (kind === 'feature' ? 'Feature request reported from Help' : 'Problem reported from Help');

  const steps = [
    `1. Open Chatgram — ${platformLabel(platform)} (version ${version}).`,
    `2. Go to: ${screen}.`,
    lastAction
      ? `3. ${lastAction.replace(/[.\s]+$/, '')}.`
      : '3. Repeat the action described in "What happened".',
    kind === 'feature'
      ? '4. Notice that the requested behaviour is missing or limited.'
      : '4. Observe the problem described in "What happened".',
  ];

  const expectedVsActual =
    kind === 'feature'
      ? [
          '- Expected: the requested behaviour exists and is discoverable.',
          '- Actual: it is missing or limited, as described above.',
        ]
      : [
          '- Expected: the action completes without the reported problem.',
          '- Actual: the problem described under "What happened".',
        ];

  const acceptance =
    kind === 'feature'
      ? [
          '- The requested behaviour is available and discoverable in the UI.',
          '- It works in the web app, the Android app and the Windows app.',
          '- No regressions in the surrounding flow.',
        ]
      : [
          '- The reported behaviour no longer occurs.',
          '- The flow completes without an error or data loss.',
          '- Verified on the platform reported above.',
        ];

  const prompt = [
    `Title: ${title}`,
    '',
    'What happened:',
    message,
    '',
    'Steps to reproduce:',
    ...steps,
    '',
    'Expected vs actual:',
    ...expectedVsActual,
    '',
    `App version: ${version}`,
    `Platform: ${platformLabel(platform)}`,
    ...(context.errorCode ? [`Error code: ${context.errorCode}`] : []),
    ...(lastAction ? [`Last action: ${lastAction}`] : []),
    '',
    'Acceptance criteria:',
    ...acceptance,
  ].join('\n');

  return {
    kind,
    prompt,
    summary: `${kind === 'feature' ? 'Feature request' : 'Problem'}: ${title}`,
  };
}

/* -------------------------------------------------------------- local queue */

function isPendingErrorReport(value: unknown): value is PendingErrorReport {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<PendingErrorReport> & { input?: unknown };
  const input = row.input as Partial<ErrorReportInput> | undefined;
  return (
    typeof row.localId === 'string' &&
    typeof row.createdAt === 'string' &&
    typeof row.prompt === 'string' &&
    typeof row.summary === 'string' &&
    typeof input?.message === 'string'
  );
}

export function loadPendingErrorReports(): PendingErrorReport[] {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPendingErrorReport).slice(-MAX_PENDING_REPORTS);
  } catch {
    return [];
  }
}

function persistPendingErrorReports(reports: PendingErrorReport[]): void {
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(reports.slice(-MAX_PENDING_REPORTS)));
  } catch {
    /* storage can be unavailable (private mode): the prompt is still on screen */
  }
}

/** Queue a report, keeping at most the five newest (oldest dropped). */
export function enqueuePendingErrorReport(report: PendingErrorReport): PendingErrorReport[] {
  const reports = [
    ...loadPendingErrorReports().filter((row) => row.localId !== report.localId),
    report,
  ].slice(-MAX_PENDING_REPORTS);
  persistPendingErrorReports(reports);
  return reports;
}

export function removePendingErrorReport(localId: string): PendingErrorReport[] {
  const reports = loadPendingErrorReports().filter((row) => row.localId !== localId);
  persistPendingErrorReports(reports);
  return reports;
}

function createPendingReport(input: ErrorReportInput): PendingErrorReport {
  const built = buildLocalErrorPrompt(input);
  return {
    localId: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    input,
    kind: built.kind,
    prompt: built.prompt,
    summary: built.summary,
  };
}

/** Build the local prompt and queue it (used when the endpoint is unavailable). */
export function queueLocalErrorReport(input: ErrorReportInput): PendingErrorReport {
  const report = createPendingReport(input);
  enqueuePendingErrorReport(report);
  return report;
}

/* ------------------------------------------------------------------ network */

function sanitizeInput(input: ErrorReportInput): ErrorReportInput {
  const message = redactSecrets(input.message).trim().slice(0, MAX_ERROR_REPORT_CHARS);
  const context = input.context ?? {};
  const cleanContext: ErrorReportContext = {};
  if (context.appVersion) cleanContext.appVersion = context.appVersion;
  if (context.platform) cleanContext.platform = context.platform;
  if (context.screen) cleanContext.screen = context.screen;
  if (context.lastAction) cleanContext.lastAction = context.lastAction;
  if (context.errorCode) cleanContext.errorCode = context.errorCode;
  return { message, context: cleanContext };
}

async function postErrorReport(input: ErrorReportInput): Promise<ErrorReportResult> {
  return api.request<ErrorReportResult>('/api/help/error-report', {
    method: 'POST',
    body: { message: input.message, context: input.context },
  });
}

/**
 * Send a report. Returns which of the three states happened so the UI can be
 * honest: `sent`, `queued` (local fallback, shown with the "not accepted"
 * wording) or `rejected` (the server refused the content or the session).
 */
export async function submitErrorReport(input: ErrorReportInput): Promise<ErrorReportOutcome> {
  const clean = sanitizeInput(input);
  if (!clean.message) {
    return { status: 'rejected', message: 'Describe the problem first.' };
  }
  return sendOrQueue(clean);
}

async function sendOrQueue(clean: ErrorReportInput): Promise<ErrorReportOutcome> {
  try {
    const result = await postErrorReport(clean);
    const prompt = typeof result?.prompt === 'string' ? result.prompt.trim() : '';
    if (!prompt) {
      return { status: 'queued', report: queueLocalErrorReport(clean) };
    }
    return {
      status: 'sent',
      result: {
        id: typeof result.id === 'string' ? result.id : '',
        kind: result.kind === 'feature' ? 'feature' : 'bug',
        prompt,
        summary: typeof result.summary === 'string' && result.summary ? result.summary : firstLine(clean.message, 120),
      },
    };
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 0;
    if (status === 400 || status === 422) {
      return {
        status: 'rejected',
        message: error instanceof Error ? error.message : 'The report could not be accepted.',
      };
    }
    // 404 (route not deployed yet), 503 (AI unavailable), 401 (signed out) and
    // network failures: keep the report locally instead of losing it.
    return { status: 'queued', report: queueLocalErrorReport(clean) };
  }
}

/**
 * Retry the queue (called when the Help widget opens). Reports the server
 * rejects outright are dropped; transient failures stay queued.
 */
export async function flushPendingErrorReports(): Promise<{
  delivered: number;
  remaining: PendingErrorReport[];
}> {
  const queued = loadPendingErrorReports();
  if (queued.length === 0) return { delivered: 0, remaining: [] };
  let delivered = 0;
  const remaining: PendingErrorReport[] = [];
  for (const report of queued) {
    try {
      const result = await postErrorReport({
        message: report.input.message,
        context: report.input.context,
      });
      if (typeof result?.prompt === 'string' && result.prompt.trim()) {
        delivered += 1;
        continue;
      }
      remaining.push(report);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      if (status === 400 || status === 422) continue; // permanently unacceptable
      remaining.push(report);
    }
  }
  persistPendingErrorReports(remaining);
  return { delivered, remaining };
}

/** Clipboard helper (same API the message copy buttons use). */
export async function copyErrorReportText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
