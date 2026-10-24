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
    return this.request<{ message: string; twoFactorEnabled: boolean; recoveryCodes?: string[] }>('/api/auth/2fa/enable', {
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

  /**
   * Change the password of the signed-in account.
   *
   * The server keeps this session signed in by returning a new access/refresh
   * pair (bumped session generation) and signs out every other device. The
   * pair is stored automatically, so callers do not have to handle tokens.
   */
  async changePassword(currentPassword: string, newPassword: string, confirmPassword?: string) {
    const data = await this.request<{
      message: string;
      accessToken: string;
      refreshToken?: string;
      tokenVersion?: number;
      notified?: { email: boolean; channel: string | null };
    }>('/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword, confirmPassword },
    });
    if (data.accessToken) this.setTokens(data);
    return data;
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
    return this.request<{
      message?: string;
      exists?: boolean;
      channel?: string;
      target?: string;
      expiresInSeconds?: number;
      retryAfterSeconds?: number;
    }>('/api/auth/forgot-password', {
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

  /* --------------------------------------------------------- account settings */

  /** Step 1 of changing the sign-in email/phone: request a verification code. */
  requestIdentifierChange(identifier: string) {
    return this.request<{
      message: string;
      channel: 'email' | 'phone';
      target: string;
      expiresInSeconds?: number;
      delivered?: boolean;
      devCode?: string;
    }>('/api/auth/account/identifier/request', { method: 'POST', body: { identifier } });
  }

  /** Step 2: verify the code and save the new email/phone (other devices out). */
  async confirmIdentifierChange(input: { identifier: string; code: string; currentPassword?: string }) {
    const data = await this.request<{
      message: string;
      accessToken: string;
      refreshToken?: string;
      user: unknown;
      notified?: { email: boolean; channel: string | null };
    }>('/api/auth/account/identifier/confirm', { method: 'POST', body: input });
    if (data.accessToken) this.setTokens(data);
    return { ...data, user: userFromJson(data.user) as User };
  }

  /** Sign out every other device, keeping this one signed in. */
  async logoutOtherSessions(currentPassword?: string) {
    const data = await this.request<{ message: string; accessToken: string; refreshToken?: string }>(
      '/api/auth/account/logout-others',
      { method: 'POST', body: { currentPassword } },
    );
    if (data.accessToken) this.setTokens(data);
    return data;
  }

  /** Permanently delete the signed-in account. */
  deleteAccount(confirmation: string, password?: string) {
    return this.request<{ message: string }>('/api/auth/account', {
      method: 'DELETE',
      body: { confirmation, password },
    });
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
    const data = await this.request<{
      showOnlineStatus?: boolean;
      hiddenFrom?: unknown[];
      showPhone?: boolean;
      showEmail?: boolean;
      showAbout?: boolean;
      showProfilePhoto?: boolean;
      readReceipts?: boolean;
      whoCanAddToGroups?: 'everyone' | 'contacts';
    }>('/api/users/me/privacy');
    return {
      showOnlineStatus: data.showOnlineStatus !== false,
      hiddenFrom: (data.hiddenFrom ?? []).map(userFromJson),
      showPhone: data.showPhone !== false,
      showEmail: data.showEmail !== false,
      showAbout: data.showAbout !== false,
      showProfilePhoto: data.showProfilePhoto !== false,
      readReceipts: data.readReceipts !== false,
      whoCanAddToGroups: data.whoCanAddToGroups === 'contacts' ? 'contacts' : 'everyone',
    };
  }

  updatePrivacy(input: {
    showOnlineStatus?: boolean;
    hiddenFrom?: string[];
    showPhone?: boolean;
    showEmail?: boolean;
    showAbout?: boolean;
    showProfilePhoto?: boolean;
    readReceipts?: boolean;
    whoCanAddToGroups?: 'everyone' | 'contacts';
  }) {
    return this.request('/api/users/me/privacy', { method: 'PUT', body: input });
  }

  /* ------------------------------------------------------- profile panel */

  /** Privacy-aware profile for the profile panel. */
  getProfile(userId: string) {
    return this.request<{
      profile: {
        id: string;
        displayName: string;
        avatarUrl: string;
        photoHidden?: boolean;
        about: string;
        aboutHidden?: boolean;
        isOnline: boolean;
        lastSeen: string | null;
        presenceHidden?: boolean;
        phone: string | null;
        email: string | null;
        phoneHidden?: boolean;
        emailHidden?: boolean;
      };
      isSelf: boolean;
      isContact: boolean;
      iBlocked: boolean;
      blockedMe: boolean;
      canMessage: boolean;
      mutedChatId: string | null;
      commonGroups: { id: string; name: string; avatarUrl: string; memberCount: number }[];
      sharedMedia: { messageId: string; type: string; url: string; at: string; chatId: string }[];
      sharedLinks: { messageId: string; url: string; at: string; chatId: string }[];
    }>(`/api/users/${userId}/profile`);
  }

  blockUser(userId: string) {
    return this.request<{ message: string; blocked: boolean; blockedUserId: string }>(
      `/api/users/${userId}/block`,
      { method: 'POST' },
    );
  }

  unblockUser(userId: string) {
    return this.request<{ message: string; blocked: boolean }>(`/api/users/${userId}/block`, {
      method: 'DELETE',
    });
  }

  blockedUsers() {
    return this.request<{ _id?: string; id?: string; displayName: string; avatarUrl?: string; about?: string }[]>(
      '/api/users/me/blocked',
    );
  }

  reportUser(userId: string, reason: string, details?: string, chatId?: string) {
    return this.request<{ message: string; reportId: string; reason: string }>(
      `/api/users/${userId}/report`,
      { method: 'POST', body: { reason, details, chatId } },
    );
  }

  muteChat(chatId: string, untilMs?: number) {
    return this.request<{ message: string; chatId: string; muted: boolean; until: string | null }>(
      `/api/users/me/muted/${chatId}`,
      { method: 'POST', body: untilMs ? { untilMs } : {} },
    );
  }

  unmuteChat(chatId: string) {
    return this.request<{ message: string; chatId: string; muted: boolean }>(
      `/api/users/me/muted/${chatId}`,
      { method: 'DELETE' },
    );
  }

  mutedChats() {
    return this.request<{ chatId: string; mutedAt: string; until: string | null }[]>('/api/users/me/muted');
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

  /** Group roster with admin flags and presence. */
  getGroupMembers(chatId: string) {
    return this.request<{
      chatId: string;
      memberCount: number;
      members: {
        _id: string;
        displayName: string;
        avatarUrl?: string;
        about?: string;
        isAdmin: boolean;
        isYou: boolean;
        isOnline?: boolean;
        lastSeen?: string | null;
        joinedAt?: string | null;
      }[];
      group?: {
        id: string;
        name: string;
        description: string;
        avatarUrl: string;
        createdBy: { id: string; displayName: string } | null;
        createdAt: string | null;
        settings: { whoCanEditInfo: 'all' | 'admins'; whoCanSendMessages: 'all' | 'admins'; whoCanAddMembers: 'all' | 'admins' };
        inviteEnabled: boolean;
        inviteToken: string | null;
        pinnedMessageId: string | null;
      };
    }>(`/api/chats/${chatId}/participants`);
  }

  /** Leave a group (self-removal). */
  leaveGroup(chatId: string) {
    return this.request<{ message: string; removed: boolean; promoted?: string | null }>(
      `/api/chats/${chatId}/leave`,
      { method: 'DELETE' },
    );
  }

  async createGroup(groupName: string, participantIds: string[], description?: string): Promise<Chat> {
    return chatFromJson(
      await this.request('/api/chats', {
        method: 'POST',
        body: { type: 'group', groupName, participantIds, groupDescription: description },
      }),
    );
  }

  /* -------------------------------------------------------------- groups */

  renameGroup(chatId: string, groupName: string) {
    return this.request(`/api/chats/${chatId}`, { method: 'PATCH', body: { groupName } });
  }

  /** Update any editable group field (name, description, photo, permissions). */
  updateGroup(
    chatId: string,
    fields: {
      groupName?: string;
      groupDescription?: string;
      groupAvatar?: string;
      groupSettings?: Partial<{ whoCanEditInfo: 'all' | 'admins'; whoCanSendMessages: 'all' | 'admins'; whoCanAddMembers: 'all' | 'admins' }>;
    },
  ) {
    return this.request(`/api/chats/${chatId}`, { method: 'PATCH', body: fields });
  }

  /* -------------------------------------------------------- group extras */

  /** Admin-managed invite link. */
  getInvite(chatId: string) {
    return this.request<{ chatId: string; inviteEnabled: boolean; token: string | null; path: string | null }>(
      `/api/chats/${chatId}/invite`,
    );
  }

  createInvite(chatId: string) {
    return this.request<{ message: string; chatId: string; inviteEnabled: boolean; token: string; path: string }>(
      `/api/chats/${chatId}/invite`,
      { method: 'POST' },
    );
  }

  revokeInvite(chatId: string) {
    return this.request<{ message: string; chatId: string; inviteEnabled: boolean }>(
      `/api/chats/${chatId}/invite`,
      { method: 'DELETE' },
    );
  }

  previewInvite(token: string) {
    return this.request<{
      chatId: string;
      name: string;
      description: string;
      avatarUrl: string;
      memberCount: number;
      alreadyMember: boolean;
      full: boolean;
    }>(`/api/chats/invite/${encodeURIComponent(token)}`);
  }

  async joinViaInvite(token: string) {
    const data = await this.request<{ message: string; chat: unknown; alreadyMember: boolean }>(
      `/api/chats/invite/${encodeURIComponent(token)}/join`,
      { method: 'POST' },
    );
    return { ...data, chat: chatFromJson(data.chat) };
  }

  pinMessage(chatId: string, messageId: string) {
    return this.request<{ chatId: string; pinnedMessageId: string }>(`/api/chats/${chatId}/pin`, {
      method: 'POST',
      body: { messageId },
    });
  }

  unpinMessage(chatId: string) {
    return this.request<{ chatId: string; pinnedMessageId: null }>(`/api/chats/${chatId}/pin`, {
      method: 'DELETE',
    });
  }

  chatMedia(chatId: string) {
    return this.request<{
      chatId: string;
      media: { messageId: string; type: string; url: string; name: string; at: string; sender: { id: string; displayName: string } | null }[];
      links: { messageId: string; url: string; at: string }[];
    }>(`/api/chats/${chatId}/media`);
  }

  /** Who has seen one of my messages. */
  messageReaders(messageId: string) {
    return this.request<{ messageId: string; readers: { id: string; displayName: string; avatarUrl: string }[]; count: number }>(
      `/api/messages/${messageId}/readers`,
    );
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

  /**
   * Upload with progress + cancellation.
   *
   * fetch() cannot report upload progress, so this uses XMLHttpRequest. Used by
   * the status composer (photos, videos, voice notes) where a 50 MB video needs
   * a real progress bar and a cancel button.
   */
  uploadFileWithProgress<T>(
    path: string,
    file: File,
    options: {
      field?: string;
      fields?: Record<string, string | number>;
      onProgress?: (percent: number, loaded: number, total: number) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const { field = 'file', fields = {}, onProgress, signal } = options;

    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', this.buildUrl(path));
      xhr.setRequestHeader('Accept', 'application/json');
      const token = this.accessToken;
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      const fail = (message: string, status: number, code?: string) =>
        reject(new ApiError(message, status, code));

      const onAbort = () => xhr.abort();
      if (signal) {
        if (signal.aborted) {
          fail('Upload cancelled.', 0, 'UPLOAD_ABORTED');
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable || !onProgress) return;
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(Math.min(99, percent), event.loaded, event.total);
      };

      xhr.onerror = () => fail('Cannot reach the server. Check your connection.', 0);
      xhr.onabort = () => fail('Upload cancelled.', 0, 'UPLOAD_ABORTED');
      xhr.ontimeout = () => fail('The upload timed out. Try again.', 0, 'UPLOAD_TIMEOUT');

      xhr.onload = () => {
        let data: unknown = null;
        try {
          data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch {
          data = xhr.responseText;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(100, 0, 0);
          resolve(data as T);
          return;
        }
        const payload = (data ?? {}) as Record<string, unknown>;
        fail(
          typeof payload.message === 'string' ? payload.message : `Upload failed (${xhr.status})`,
          xhr.status,
          typeof payload.code === 'string' ? payload.code : undefined,
        );
      };

      const form = new FormData();
      // Extra fields go FIRST so the server has them while it handles the file.
      for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
      form.append(field, file);

      try {
        xhr.send(form);
      } catch {
        fail('Could not start the upload.', 0);
      }
    });
  }

  /* ------------------------------------------------------------- status */

  /** Server-side media rules for statuses (image 10 MB, video 50 MB/60 s, audio 20 MB). */
  statusLimits() {
    return this.request<{
      limits: Record<
        'image' | 'video' | 'audio',
        { maxBytes: number; maxDurationSeconds?: number; mimetypes: string[] }
      >;
    }>('/api/status/limits');
  }

  /** Upload a photo/video/voice note for a status, with progress + cancel. */
  uploadStatusMedia(
    file: File,
    options: { durationSeconds?: number; onProgress?: (percent: number) => void; signal?: AbortSignal } = {},
  ) {
    return this.uploadFileWithProgress<{
      file: {
        url: string;
        mimetype: string;
        size: number;
        mediaType: 'image' | 'video' | 'audio';
        provider?: string;
        publicId?: string | null;
        originalname?: string;
      };
    }>('/api/status/media', file, {
      onProgress: (percent) => options.onProgress?.(percent),
      signal: options.signal,
      fields: options.durationSeconds != null ? { durationSeconds: options.durationSeconds } : {},
    });
  }

  createStatus(input: {
    text?: string;
    mediaUrl?: string;
    mediaType?: 'image' | 'video' | 'audio';
    mimetype?: string;
    mediaSize?: number;
    mediaPublicId?: string | null;
    mediaProvider?: string;
    thumbnailUrl?: string;
    durationSeconds?: number;
  }) {
    return this.request('/api/status', { method: 'POST', body: input });
  }

  /* ------------------------------------------------------------- status */

  async statuses(): Promise<StatusItem[]> {
    const data = await this.request<unknown[]>('/api/status');
    return (data ?? []).map(statusFromJson);
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
