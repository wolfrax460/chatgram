/**
 * Thin API client for the Chatgram backend.
 *
 * The React app is a separate origin from the API in development, and the same
 * origin in production only for the Flutter build — so every call is absolute
 * and CORS is handled server-side via CLIENT_URL.
 */

export const API_BASE = (
  import.meta.env.VITE_API_URL || 'https://chatgram.duckdns.org'
).replace(/\/+$/, '');

const TOKEN_KEY = 'chatgram.accessToken';
const REFRESH_KEY = 'chatgram.refreshToken';
const USER_KEY = 'chatgram.user';

export const tokens = {
  get access() {
    return localStorage.getItem(TOKEN_KEY) || null;
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY) || null;
  },
  save(accessToken, refreshToken) {
    if (accessToken) localStorage.setItem(TOKEN_KEY, accessToken);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export const userCache = {
  get() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch {
      return null;
    }
  },
  set(user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
};

class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function raw(path, { method = 'GET', body, token } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const auth = token ?? tokens.access;
  if (auth) headers.Authorization = `Bearer ${auth}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check that the backend is running.', 0);
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

let refreshing = null;

/** Refresh the access token once, sharing the in-flight request. */
async function refreshAccessToken() {
  if (!tokens.refresh) return false;
  if (!refreshing) {
    refreshing = (async () => {
      const { ok, data } = await raw('/api/auth/refresh', {
        method: 'POST',
        body: { refreshToken: tokens.refresh },
      });
      if (ok && data?.accessToken) {
        tokens.save(data.accessToken, data.refreshToken);
        return true;
      }
      tokens.clear();
      return false;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

/** Multipart upload — FormData needs the browser to set its own boundary. */
async function multipartUpload(path, formData) {
  const headers = { Accept: 'application/json' };
  const auth = tokens.access;
  if (auth) headers.Authorization = `Bearer ${auth}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: formData });
  } catch {
    throw new ApiError('Cannot reach the server. Check that the backend is running.', 0);
  }

  if (res.status === 401 && tokens.refresh) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return multipartUpload(path, formData);
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    throw new ApiError(
      (data && (data.message || data.error)) || `Upload failed (${res.status})`,
      res.status,
      data?.code,
    );
  }
  return data;
}

export async function request(path, options = {}) {
  let result = await raw(path, options);

  if (result.status === 401 && tokens.refresh) {
    const refreshed = await refreshAccessToken();
    if (refreshed) result = await raw(path, options);
  }

  if (!result.ok) {
    const message =
      (result.data && (result.data.message || result.data.error)) ||
      `Request failed (${result.status})`;
    throw new ApiError(message, result.status, result.data?.code);
  }
  return result.data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  delete: (path) => request(path, { method: 'DELETE' }),

  // ---------------------------------------------------------------- auth
  login: (identifier, password) =>
    request('/api/auth/login', { method: 'POST', body: { identifier, password } }),
  register: (payload) => request('/api/auth/register', { method: 'POST', body: payload }),
  me: () => request('/api/auth/me'),
  sendCode: (target) =>
    request('/api/auth/verification/send', { method: 'POST', body: { target } }),
  checkCode: (target, code) =>
    request('/api/auth/verification/check', { method: 'POST', body: { target, code } }),
  config: () => request('/api/config'),

  // --------------------------------------------------------------- chats
  chats: () => request('/api/chats'),
  groups: () => request('/api/chats/groups'),
  chat: (id) => request(`/api/chats/${id}`),
  createDirect: (participantId) =>
    request('/api/chats', { method: 'POST', body: { type: 'direct', participantId } }),
  createGroup: (groupName, participantIds) =>
    request('/api/chats', { method: 'POST', body: { type: 'group', groupName, participantIds } }),
  messages: (chatId) => request(`/api/messages?chatId=${encodeURIComponent(chatId)}`),
  sendMessage: (payload) => request('/api/messages', { method: 'POST', body: payload }),
  /** Upload a file; resolves to { file: { url, mimetype, size, originalname } } */
  uploadMedia: (file) => {
    const form = new FormData();
    form.append('file', file);
    return multipartUpload('/api/messages/media', form);
  },
  markRead: (chatId) => request(`/api/messages/chat/${chatId}/read`, { method: 'POST' }),

  // ------------------------------------------------------------ contacts
  contacts: () => request('/api/contacts'),
  searchPeople: (query) =>
    request(`/api/contacts/search?query=${encodeURIComponent(query)}`),
  addContact: (userId) => request('/api/contacts', { method: 'POST', body: { userId } }),
  removeContact: (userId) => request(`/api/contacts/${userId}`, { method: 'DELETE' }),

  // -------------------------------------------------------------- profile
  updateProfile: (id, fields) =>
    request('/api/users/' + id, { method: 'PUT', body: fields }),
  uploadAvatar: (id, file) => {
    const form = new FormData();
    form.append('avatar', file);
    return multipartUpload('/api/users/' + id + '/avatar', form);
  },

  // --------------------------------------------------------------- status
  statuses: () => request('/api/status'),
  createStatus: (payload) => request('/api/status', { method: 'POST', body: payload }),
  deleteStatus: (id) => request('/api/status/' + id, { method: 'DELETE' }),
  viewStatus: (id) => request('/api/status/' + id + '/view', { method: 'POST' }),

  // --------------------------------------------------------------- misc
  support: () => request('/api/support'),
  openSupportChat: () => request('/api/support/chat', { method: 'POST' }),
  profile: (id) => request(`/api/users/${id}`),
  privacy: () => request('/api/users/me/privacy'),
};

export { ApiError };
