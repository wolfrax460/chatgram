/**
 * Typed REST client for the Chatgram backend.
 *
 * Responsibilities:
 *  - attach the bearer token,
 *  - transparently refresh once on 401 and replay the request,
 *  - normalise the backend's `{ message, code }` error shape into ApiError,
 *  - expose one typed method per endpoint in docs/api-contract.md.
 *
 * No React, no browser-only globals beyond fetch/FormData — so the same client
 * works in the browser, Electron and Capacitor.
 */
import {
  chatFromJson,
  messageFromJson,
  statusFromJson,
  userFromJson,
  type Chat,
  type Message,
  type MessageType,
  type Privacy,
  type StatusItem,
  type User,
} from '@chatgram/core';

export interface ApiConfig {
  baseUrl: string;
  /** Where to persist tokens. Provide a storage shim for Capacitor/Electron. */
  storage?: TokenStorage;
}

export interface TokenStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

const ACCESS_KEY = 'chatgram.accessToken';
const REFRESH_KEY = 'chatgram.refreshToken';

const memoryStorage: TokenStorage = (() => {
  const map = new Map<string, string>();
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k),
  };
})();

function defaultStorage(): TokenStorage {
  if (typeof localStorage === 'undefined') return memoryStorage;
  return {
    get: (k) => localStorage.getItem(k),
    set: (k, v) => localStorage.setItem(k, v),
    remove: (k) => localStorage.removeItem(k),
  };
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Skip auth header (login/register). */
  anonymous?: boolean;
  /** Send FormData without a JSON content type. */
  form?: FormData;
}

export class ApiClient {
  readonly baseUrl: string;
  private readonly storage: TokenStorage;
  private refreshInFlight: Promise<boolean> | null = null;

  constructor(config: ApiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.storage = config.storage ?? defaultStorage();
  }

  /* ------------------------------------------------------------- tokens */

  get accessToken(): string | null {
    return this.storage.get(ACCESS_KEY);
  }

  get refreshToken(): string | null {
    return this.storage.get(REFRESH_KEY);
  }

  setTokens(tokens: AuthTokens): void {
    this.storage.set(ACCESS_KEY, tokens.accessToken);
    if (tokens.refreshToken) this.storage.set(REFRESH_KEY, tokens.refreshToken);
  }

  /**
   * Switch where tokens live.
   * `true`  -> localStorage (survives browser restart) = "Keep me signed in"
   * `false` -> sessionStorage (cleared when the tab closes)
   */
  setPersistent(persistent: boolean): void {
    const from = persistent ? 'session' : 'local';
    const to = persistent ? 'local' : 'session';
    const source = from === 'local' ? localStorage : sessionStorage;
    const target = to === 'local' ? localStorage : sessionStorage;
    for (const key of [ACCESS_KEY, REFRESH_KEY]) {
      const value = source.getItem(key);
      if (value) target.setItem(key, value);
      source.removeItem(key);
    }
  }

  clearTokens(): void {
    this.storage.remove(ACCESS_KEY);
    this.storage.remove(REFRESH_KEY);
  }

  /* ---------------------------------------------------------- transport */

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async raw(path: string, options: RequestOptions = {}, token?: string | null) {
    const headers: Record<string, string> = { Accept: 'application/json' };

    if (options.form) {
      // Let the runtime set the multipart boundary.
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const auth = token === undefined ? this.accessToken : token;
    if (auth && !options.anonymous) headers.Authorization = `Bearer ${auth}`;

    let response: Response;
    try {
      response = await fetch(this.buildUrl(path, options.query), {
        method: options.method ?? 'GET',
        headers,
        body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
      });
    } catch {
      throw new ApiError('Cannot reach the server. Check your connection.', 0);
    }

    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { ok: response.ok, status: response.status, data };
  }

  private async refresh(): Promise<boolean> {
    const token = this.refreshToken;
    if (!token) return false;

    if (!this.refreshInFlight) {
      this.refreshInFlight = (async () => {
        try {
          const { ok, data } = await this.raw(
            '/api/auth/refresh',
            { method: 'POST', body: { refreshToken: token }, anonymous: true },
            null,
          );
          if (ok && data && typeof data === 'object') {
            const payload = data as AuthTokens;
            if (payload.accessToken) {
              this.setTokens(payload);
              return true;
            }
          }
          this.clearTokens();
          return false;
        } finally {
          this.refreshInFlight = null;
        }
      })();
    }
    return this.refreshInFlight;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    let result = await this.raw(path, options);

    if (result.status === 401 && this.refreshToken && !options.anonymous) {
      const refreshed = await this.refresh();
      if (refreshed) result = await this.raw(path, options);
    }

    if (!result.ok) {
      const data = (result.data ?? {}) as Record<string, unknown>;
      const message =
        typeof data.message === 'string'
          ? data.message
          : typeof data.error === 'string'
            ? data.error
            : `Request failed (${result.status})`;
      throw new ApiError(message, result.status, typeof data.code === 'string' ? data.code : undefined);
    }

    return result.data as T;
  }

  /* --------------------------------------------------------------- auth */

  /** TOTP two-factor authentication. */
  twoFactorStatus() {
    return this.request<{ twoFactorEnabled: boolean }>('/api/auth/2fa/status');
  }

  setupTwoFactor() {
    return this.request<{ secret: string; otpauth: string; qr: string; instructions: string }>(
      '/api/auth/2fa/setup',
      { method: 'POST' },
    );
  }

  enableTwoFactor(token: string) {
    return this.request<{ message: string; twoFactorEnabled: boolean }>('/api/auth/2fa/enable', {
      method: 'POST',
      body: { token },
    });
  }

  disableTwoFactor(token: string) {
    return this.request<{ message: string; twoFactorEnabled: boolean }>('/api/auth/2fa/disable', {
      method: 'POST',
      body: { token },
    });
  }

  async login(identifier: string, password: string, totp?: string) {
    const data = await this.request<{ accessToken: string; refreshToken?: string; user: unknown }>(
      '/api/auth/login',
      { method: 'POST', body: totp ? { identifier, password, totp } : { identifier, password }, anonymous: true },
    );
    this.setTokens(data);
    return { ...data, user: userFromJson(data.user) as User };
  }

  async register(input: {
    displayName: string;
    identifier: string;
    password: string;
    verificationToken?: string;
  }) {
    const data = await this.request<{ accessToken: string; refreshToken?: string; user: unknown }>(
      '/api/auth/register',
      { method: 'POST', body: input, anonymous: true },
    );
    this.setTokens(data);
    return { ...data, user: userFromJson(data.user) as User };
  }

  async me(): Promise<User> {
    const data = await this.request<{ user?: unknown }>('/api/auth/me');
    return userFromJson(data.user ?? data);
  }

  async logout(): Promise<void> {
    try {
      await this.request('/api/auth/logout', { method: 'POST' });
    } finally {
      this.clearTokens();
    }
  }

  sendCode(identifier: string) {
    return this.request<{ devCode?: string }>('/api/auth/verification/send', {
      method: 'POST',
      body: { identifier },
      anonymous: true,
    });
  }

  checkCode(identifier: string, code: string) {
    return this.request<{ verificationToken?: string }>('/api/auth/verification/check', {
      method: 'POST',
      body: { identifier, code },
      anonymous: true,
    });
  }

  forgotPassword(identifier: string) {
    return this.request('/api/auth/forgot-password', {
      method: 'POST',
      body: { identifier },
      anonymous: true,
    });
  }

  resetPassword(identifier: string, code: string, newPassword: string) {
    return this.request('/api/auth/reset-password', {
      method: 'POST',
      body: { identifier, code, newPassword },
      anonymous: true,
    });
  }

  googleUrl() {
    return this.request<{ url: string; state: string }>('/api/auth/google/url', { anonymous: true });
  }

  googlePoll(state: string) {
    return this.request<{ accessToken?: string; refreshToken?: string; user?: unknown }>(
      '/api/auth/google/poll',
      { query: { state }, anonymous: true },
    );
  }

  /* -------------------------------------------------------------- users */

  async updateProfile(
    id: string,
    fields: { displayName?: string; about?: string; avatarUrl?: string },
  ): Promise<User> {
    const data = await this.request<{ user?: unknown }>(`/api/users/${id}`, {
      method: 'PUT',
      body: fields,
    });
    return userFromJson(data.user ?? data);
  }

  async uploadAvatar(id: string, file: File): Promise<{ user: User; url?: string }> {
    const form = new FormData();
    form.append('avatar', file);
    const data = await this.request<{ user?: unknown; url?: string }>(`/api/users/${id}/avatar`, {
      method: 'POST',
      form,
    });
    return { user: userFromJson(data.user), url: data.url };
  }

  async privacy(): Promise<Privacy> {
    const data = await this.request<{ showOnlineStatus?: boolean; hiddenFrom?: unknown[] }>(
      '/api/users/me/privacy',
    );
    return {
      showOnlineStatus: data.showOnlineStatus !== false,
      hiddenFrom: (data.hiddenFrom ?? []).map(userFromJson),
    };
  }

  updatePrivacy(input: { showOnlineStatus?: boolean; hiddenFrom?: string[] }) {
    return this.request('/api/users/me/privacy', { method: 'PUT', body: input });
  }

  /* ----------------------------------------------------------- contacts */

  async contacts(): Promise<User[]> {
    const data = await this.request<unknown[]>('/api/contacts');
    return (data ?? []).map(userFromJson);
  }

  async searchPeople(query: string): Promise<User[]> {
    const data = await this.request<unknown[]>('/api/contacts/search', { query: { query } });
    return (data ?? []).map(userFromJson);
  }

  addContact(userId: string) {
    return this.request('/api/contacts', { method: 'POST', body: { userId } });
  }

  removeContact(userId: string) {
    return this.request(`/api/contacts/${userId}`, { method: 'DELETE' });
  }

  /* -------------------------------------------------------------- chats */

  async chats(): Promise<Chat[]> {
    const data = await this.request<unknown[]>('/api/chats');
    return (data ?? []).map(chatFromJson);
  }

  async groups(): Promise<Chat[]> {
    const data = await this.request<unknown[]>('/api/chats/groups');
    return (data ?? []).map(chatFromJson);
  }

  async chat(id: string): Promise<Chat> {
    return chatFromJson(await this.request(`/api/chats/${id}`));
  }

  async createDirect(participantId: string): Promise<Chat> {
    return chatFromJson(
      await this.request('/api/chats', { method: 'POST', body: { type: 'direct', participantId } }),
    );
  }

  async createGroup(groupName: string, participantIds: string[]): Promise<Chat> {
    return chatFromJson(
      await this.request('/api/chats', {
        method: 'POST',
        body: { type: 'group', groupName, participantIds },
      }),
    );
  }

  /* -------------------------------------------------------------- groups */

  renameGroup(chatId: string, groupName: string) {
    return this.request(`/api/chats/${chatId}`, { method: 'PATCH', body: { groupName } });
  }

  addParticipants(chatId: string, participantIds: string[]) {
    return this.request(`/api/chats/${chatId}/participants`, {
      method: 'POST',
      body: { participantIds },
    });
  }

  removeParticipant(chatId: string, userId: string) {
    return this.request(`/api/chats/${chatId}/participants/${userId}`, { method: 'DELETE' });
  }

  setGroupAdmin(chatId: string, userId: string, isAdmin = true) {
    return this.request(`/api/chats/${chatId}/admins`, {
      method: 'POST',
      body: { userId, isAdmin },
    });
  }

  /* ----------------------------------------------------------- messages */

  async messages(chatId: string): Promise<Message[]> {
    const data = await this.request<{ messages?: unknown[] } | unknown[]>('/api/messages', {
      query: { chatId },
    });
    const list = Array.isArray(data) ? data : (data.messages ?? []);
    return list.map(messageFromJson);
  }

  async sendMessage(input: {
    chatId: string;
    type?: MessageType;
    content?: string;
    mediaUrl?: string;
    clientId?: string;
  }): Promise<Message> {
    return messageFromJson(await this.request('/api/messages', { method: 'POST', body: input }));
  }

  /** Delete a message for me, or for everyone if I am the sender. */
  deleteMessage(messageId: string, scope: 'me' | 'everyone' = 'me') {
    return this.request(`/api/messages/${messageId}?scope=${scope}`, { method: 'DELETE' });
  }

  /** Toggle an emoji reaction (one per user; same emoji removes it). */
  reactToMessage(messageId: string, emoji: string) {
    return this.request<{ messageId: string; chatId: string; reactions: { userId: string; emoji: string }[] }>(
      `/api/messages/${messageId}/reactions`,
      { method: 'POST', body: { emoji } },
    );
  }

  /** Clear the whole chat for me only. */
  clearChat(chatId: string) {
    return this.request(`/api/chats/${chatId}/messages`, { method: 'DELETE' });
  }

  markChatRead(chatId: string) {
    return this.request(`/api/messages/chat/${chatId}/read`, { method: 'POST' });
  }

  async uploadMedia(file: File): Promise<{ url: string; mimetype: string; size: number; originalname: string }> {
    const form = new FormData();
    form.append('file', file);
    const data = await this.request<{ file: { url: string; mimetype: string; size: number; originalname: string } }>(
      '/api/messages/media',
      { method: 'POST', form },
    );
    return data.file;
  }

  /* ------------------------------------------------------------- status */

  async statuses(): Promise<StatusItem[]> {
    const data = await this.request<unknown[]>('/api/status');
    return (data ?? []).map(statusFromJson);
  }

  createStatus(input: { text?: string; mediaUrl?: string }) {
    return this.request('/api/status', { method: 'POST', body: input });
  }

  deleteStatus(id: string) {
    return this.request(`/api/status/${id}`, { method: 'DELETE' });
  }

  viewStatus(id: string) {
    return this.request(`/api/status/${id}/view`, { method: 'POST' });
  }

  /* ------------------------------------------------------------ support */

  /** Public: ask the help assistant (server-side AI, KB fallback). */
  askSupportAssistant(input: { guestId: string; messages: { role: 'guest' | 'assistant'; text: string }[] }) {
    return this.request<{ answer: string; source: string; aiEnabled?: boolean; provider?: string }>(
      '/api/support/assistant',
      { method: 'POST', body: input, anonymous: true },
    );
  }

  /** Public: create a support ticket from the help widget. */
  createSupportTicket(input: {
    guestId: string;
    contact: string;
    summary: string;
    transcript: { role: 'guest' | 'assistant'; text: string }[];
    page?: string;
    userAgent?: string;
    appVersion?: string;
  }) {
    return this.request<{ ticketId: string; status: string; message: string; guestToken?: string; guestTokenExpiresAt?: string }>(
      '/api/support/tickets',
      { method: 'POST', body: input, anonymous: true },
    );
  }

  /** Public: delete a ticket (ID + the contact used when reporting). */
  deleteSupportTicket(ticketId: string, contact: string) {
    return this.request<{ message: string; ticketId: string }>(
      `/api/support/tickets/${encodeURIComponent(ticketId)}`,
      { method: 'DELETE', query: { contact }, anonymous: true },
    );
  }

  /** Private (Support account): the ticket attached to a chat. */
  getTicketByChat(chatId: string) {
    return this.request<{ ticket: { ticketId: string; status: string; contact: string } | null }>(
      `/api/support/tickets/by-chat/${chatId}`,
    );
  }

  /** Private (Support account): close a ticket. */
  closeSupportTicket(ticketId: string) {
    return this.request<{ message: string; ticketId: string; status: string }>(
      `/api/support/tickets/${encodeURIComponent(ticketId)}/close`,
      { method: 'POST' },
    );
  }

  /** Public: look up a ticket by ID + the contact used when reporting. */
  getSupportTicket(ticketId: string, contact: string) {
    return this.request<{
      ticketId: string;
      status: string;
      createdAt: string;
      summary: string;
      replies: { text: string; at: string }[];
    }>(`/api/support/tickets/${encodeURIComponent(ticketId)}`, {
      query: { contact },
      anonymous: true,
    });
  }

  support() {
    return this.request<{ enabled: boolean; displayName: string }>('/api/support');
  }

  async openSupportChat(): Promise<Chat> {
    return chatFromJson(await this.request('/api/support/chat', { method: 'POST' }));
  }

  config() {
    return this.request<{
      verificationRequired?: boolean;
      google?: { enabled: boolean; redirectUri?: string | null };
      support?: { enabled: boolean; displayName: string };
    }>('/api/config', { anonymous: true });
  }
}
