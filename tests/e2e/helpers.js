/**
 * Shared helpers for the Playwright suite.
 *
 * Accounts are created through the real API (verification is disabled on the
 * local staging stack), then the tokens are injected into localStorage so a test
 * starts signed in without driving the sign-in form every time. One spec
 * (auth.spec.js) exercises the real form instead.
 */
const API_URL = process.env.E2E_API_URL || 'http://127.0.0.1:5000';

const PASSWORD = 'E2ePassword1!';

async function apiRequest(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, body: json };
}

let counter = 0;

async function registerUser(label = 'user', options = {}) {
  counter += 1;
  const identifier = options.phone
    ? `+25078${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 90) + 10)}`
    : `e2e-${label}-${Date.now().toString(36)}-${counter}@chatgram.test`;
  const res = await apiRequest('POST', '/api/auth/register', {
    body: { displayName: `E2E ${label} ${counter}`, identifier, password: PASSWORD },
  });
  if (res.status !== 201) {
    throw new Error(`Could not register ${identifier}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return {
    identifier,
    password: PASSWORD,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    user: res.body.user,
  };
}

/** Seed the app's localStorage so the page opens signed in. */
async function signIn(page, account) {
  await page.addInitScript(
    ([access, refresh, user]) => {
      localStorage.setItem('chatgram.accessToken', access);
      localStorage.setItem('chatgram.refreshToken', refresh);
      localStorage.setItem('chatgram.session.user', user);
    },
    [account.accessToken, account.refreshToken || '', JSON.stringify(account.user)],
  );
  await page.goto('/');
  await page.waitForSelector('nav', { state: 'attached', timeout: 20_000 });
}

/** Navigate using the left rail's aria-label. */
async function openTab(page, label) {
  await page.getByRole('button', { name: label, exact: true }).first().click();
}

/**
 * A second, fully isolated signed-in session.
 *
 * Pages inside one Playwright context SHARE localStorage, which means tokens
 * from a second user would silently replace the first user's tokens. Multi-user
 * tests must therefore open a new context per user.
 */
async function newSession(browser, account) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, account);
  return { context, page };
}

/** Let the other account become a contact of this one (both directions). */
async function addContact(account, contactId) {
  const res = await apiRequest('POST', '/api/contacts', { token: account.accessToken, body: { userId: contactId } });
  if (res.status >= 300) throw new Error(`addContact failed: ${res.status} ${JSON.stringify(res.body)}`);
}

async function createGroup(account, name, participantIds) {
  const res = await apiRequest('POST', '/api/chats', {
    token: account.accessToken,
    body: { type: 'group', groupName: name, participantIds },
  });
  if (res.status >= 300) throw new Error(`createGroup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function sendMessage(account, chatId, content) {
  const res = await apiRequest('POST', '/api/messages', {
    token: account.accessToken,
    body: { chatId, type: 'text', content },
  });
  if (res.status >= 300) throw new Error(`sendMessage failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function createDirectChat(account, participantId) {
  const res = await apiRequest('POST', '/api/chats', {
    token: account.accessToken,
    body: { type: 'direct', participantId },
  });
  if (res.status >= 300) throw new Error(`createDirectChat failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

module.exports = {
  API_URL,
  PASSWORD,
  apiRequest,
  registerUser,
  signIn,
  newSession,
  openTab,
  addContact,
  createGroup,
  createDirectChat,
  sendMessage,
};

