/**
 * Fix-prompt generator for the Chatgram AI reports in the Admin Inbox.
 *
 * A report is written by a user (often in a hurry), so the stored text is not
 * something a coding assistant can act on directly. This module turns it into a
 * compact, specific prompt:
 *
 *   Goal / Context / Observed vs expected / numbered Steps to reproduce /
 *   Likely files (grounded in docs/progress.md + docs/decisions.md) /
 *   checkable Acceptance criteria / Constraints / "Needs clarification".
 *
 * It first asks a SECOND admin-side AI call (through the existing provider
 * routing in ./service.js — `feature: 'chatgramAI'`) for strict JSON. The JSON is
 * validated field by field and merged over a deterministic, report-specific
 * template, so a missing provider, a timeout, invalid JSON or an empty answer can
 * never break report creation: the caller always gets `{ text, source, questions }`.
 *
 * Rules kept by this module:
 *  - the reporter's exact words appear ONCE (Observed); every other section
 *    refers to them as "the reporter's words above";
 *  - a vague report gets "Needs clarification" questions instead of invented
 *    details;
 *  - the template fallback is derived from the report (feature area + keywords)
 *    and never uses the old generic filler ("Open Chatgram and reproduce...").
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const PROMPT_LIMIT = 6000;
const DOC_LINE_LIMIT = 260;
const DOC_EVIDENCE_LIMIT = 2;

const FALLBACK_CONSTRAINTS = [
  'Token budget: keep the change small; read only the files listed above, no broad refactors and no new dependencies.',
  'No new Playwright suites. Extend the existing test file/script for the changed area (unit or integration) instead.',
  'Never print, commit or paste secrets, tokens, chat ids or .env values.',
  'Do not change Google sign-in configuration unless this report is specifically about it.',
  'Deploy per docs/deploy.md: verified DB + source backup, backend first, health gate, smoke test with temporary accounts, rollback row recorded.',
];

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@chatgram.local';

/* ---------------------------------------------------------------- feature areas */

// Each area is a keyword table plus the modules/file paths the docs point at for
// that part of Chatgram. The list is filtered to files that really exist, so a
// deployed subset of the repo can never invent a path.
const AREA_DEFS = [
  {
    id: 'ai-reports',
    name: 'Chatgram AI reports, mentions and the admin Inbox',
    surface: 'the Chatgram AI chat, a group @Chatgram AI mention or the admin Inbox',
    terms: ['chatgram ai', 'chatgramai', 'mention', 'report', 'reports', 'inbox', 'admin', 'telegram', 'fix prompt', 'assistant', 'ai chat', 'escalate', 'unknown question', 'rpt-'],
    files: [
      'server/src/ai/reports.js',
      'server/src/ai/fixPrompt.js',
      'server/src/ai/groupMentions.js',
      'server/src/ai/chatgram.js',
      'server/src/support/reportTelegram.js',
      'apps/web/src/pages/admin/InboxPage.tsx',
      'apps/web/src/components/AiThread.tsx',
    ],
    steps: [
      'Sign in on staging with a test account and open a group with @Chatgram AI mentions turned on (or the 1:1 Chatgram AI chat).',
      'Send the exact kind of message the reporter used (their words are quoted above) and wait for the AI answer.',
      'Check the admin Inbox for the record (type, reference, source, asker, summary, fix prompt) and the Telegram alert.',
      'Note what was missing or wrong compared with the expected behaviour.',
    ],
    clarify: 'Was the problem in a group mention or in the 1:1 Chatgram AI chat, and did the AI reply at all?',
  },
  {
    id: 'calls',
    name: 'Calls and screen sharing',
    surface: 'the Calls tab, a 1:1 chat call or a group call',
    terms: ['call', 'calls', 'video call', 'voice call', 'ring', 'ringtone', 'screen shar', 'webrtc', 'ice', 'turn', 'participant', 'mute', 'camera', 'speaker', 'call ended', 'decline', 'join call', 'missed call'],
    files: [
      'apps/web/src/components/CallOverlay.tsx',
      'apps/web/src/lib/calls.ts',
      'server/src/controllers/callController.js',
      'server/src/routes/callRoutes.js',
      'server/src/sockets/socketHandler.js',
      'scripts/verify-calls.js',
    ],
    steps: [
      'Sign in on two browsers with two test accounts that share a group (or start a 1:1 call from the Calls tab).',
      'Start or join the call and repeat the action described in the reporter’s words above.',
      'Watch the call overlay on both screens and the server log while the problem happens.',
      'Note the exact call state shown (ringing, joining, connected, ended, failed) and any error text.',
    ],
    clarify: 'Was it a 1:1 or a group call, how many people had joined, and did the call ever show "connected"?',
  },
  {
    id: 'messages',
    name: 'Messages, composer and media',
    surface: 'a chat composer, message bubble or media upload',
    terms: ['message', 'messages', 'send', 'composer', 'reply', 'upload', 'photo', 'video', 'voice note', 'audio', 'file', 'attachment', 'tick', 'read receipt', 'edit message', 'delete message', 'forward'],
    files: [
      'server/src/controllers/messageController.js',
      'server/src/routes/messageRoutes.js',
      'server/src/models/Message.js',
      'apps/web/src/components/Composer.tsx',
      'apps/web/src/components/MessageBubble.tsx',
      'apps/web/src/lib/useVoiceRecorder.ts',
    ],
    steps: [
      'Sign in on staging with two test accounts and open a chat between them.',
      'Perform the action the reporter described (the reporter’s words above) in the composer or on the message.',
      'Check what the sender sees and what the recipient receives, including the message status ticks.',
      'Note any error text and whether the message is still stored after a refresh.',
    ],
    clarify: 'Which chat type was it (1:1 or group), and what kind of message was involved (text, photo, video, voice note, file)?',
  },
  {
    id: 'groups',
    name: 'Groups, members and group permissions',
    surface: 'a group chat, its member list or group info panel',
    terms: ['group', 'groups', 'member', 'members', 'invite', 'leave group', 'group avatar', 'group info', 'group settings', 'promote'],
    files: [
      'server/src/models/Chat.js',
      'server/src/routes/chatRoutes.js',
      'server/src/controllers/chatController.js',
      'apps/web/src/lib/groupInfo.tsx',
      'apps/web/src/pages/Groups.tsx',
    ],
    steps: [
      'Sign in on staging as a group admin and as a normal member (two browsers).',
      'Open the group and repeat the action described in the reporter’s words above.',
      'Check what each member and admin sees, and whether the change survives a reload.',
      'Note any error message and the member count before/after.',
    ],
    clarify: 'Was the reporter a group admin or a normal member, and how many members were in the group?',
  },
  {
    id: 'status',
    name: 'Status (photo, video and voice statuses)',
    surface: 'the Status tab, the status composer or the status viewer',
    terms: ['status', 'statuses', 'story', 'stories', 'photo status', 'voice status', 'expires', 'viewer'],
    files: [
      'server/src/controllers/statusController.js',
      'server/src/routes/statusRoutes.js',
      'server/src/models/Status.js',
      'apps/web/src/pages/Status.tsx',
      'apps/web/src/components/status/StatusComposer.tsx',
    ],
    steps: [
      'Sign in on staging with two test accounts who have each other as contacts.',
      'Post a status of the same kind the reporter used (the reporter’s words above) from the Status tab.',
      'Open the Status tab on the second account and play the status through to the end.',
      'Note what is cropped, stuck, missing or expired unexpectedly.',
    ],
    clarify: 'Was the status a photo, video or voice status, and was it posted from a phone app or the web app?',
  },
  {
    id: 'auth',
    name: 'Sign-in, account and two-factor settings',
    surface: 'the sign-in/register screens or Settings → Account',
    terms: ['login', 'log in', 'sign in', 'signin', 'sign up', 'register', 'password', 'verification', 'code', 'google', '2fa', 'two-factor', 'account', 'session', 'token', 'logout'],
    files: [
      'server/src/controllers/authController.js',
      'server/src/controllers/twoFactorController.js',
      'server/src/routes/authRoutes.js',
      'apps/web/src/pages/Auth.tsx',
      'apps/web/src/components/ChangePassword.tsx',
    ],
    steps: [
      'Sign out, then repeat the sign-in/account action described in the reporter’s words above on staging.',
      'Enter the values the reporter used (a test account only) and submit the form.',
      'Follow the redirect/error that appears and reload the page once.',
      'Note the exact on-screen message and whether the session is still valid afterwards.',
    ],
    clarify: 'Which sign-in method was used (email + password, Google or two-factor code), and did the error appear before or after entering the code?',
  },
  {
    id: 'chat-list',
    name: 'Chat list, search, pins and notifications',
    surface: 'the Chats list, search results or a notification',
    terms: ['chat list', 'chatlist', 'search', 'unread', 'notification', 'notifications', 'mute', 'pin', 'pinned', 'badge', 'archive', 'compose button'],
    files: [
      'apps/web/src/components/ChatList.tsx',
      'apps/web/src/components/ChatHeader.tsx',
      'apps/web/src/lib/notify.ts',
      'server/src/controllers/chatController.js',
    ],
    steps: [
      'Sign in on staging with a test account that has several chats, unread messages and a pinned chat.',
      'Repeat the action described in the reporter’s words above (search, pin, mute, open a notification).',
      'Refresh the page and reopen the app to see whether the state sticks.',
      'Note which row/message/badge was wrong and the expected state.',
    ],
    clarify: 'Which chat or notification was involved, and did the wrong state survive a page reload?',
  },
  {
    id: 'support-admin',
    name: 'Support, help centre and the admin dashboard',
    surface: 'the Support chat, the help widget or the admin dashboard',
    terms: ['support', 'ticket', 'help', 'admin dashboard', 'dashboard', 'settings', 'privacy policy', 'moderation', 'review'],
    files: [
      'server/src/controllers/supportAdminController.js',
      'server/src/support/supportAgentReply.js',
      'server/src/support/reportTelegram.js',
      'apps/web/src/pages/admin/SettingsPage.tsx',
      'apps/web/src/pages/admin/SupportPage.tsx',
      'apps/web/src/components/SupportWidget.tsx',
    ],
    steps: [
      'Sign in on staging with a test account and open the support/help surface or the admin dashboard section in the reporter’s words above.',
      'Repeat the action that went wrong (open the ticket, save the setting, send the reply).',
      'Check both the screen result and the stored data (refresh the page / reopen the dashboard).',
      'Note any error text and whether the action stayed unsaved.',
    ],
    clarify: 'Was the reporter using the normal app, the support widget or the admin dashboard, and did the action have any visible error message?',
  },
  {
    id: 'landing-installers',
    name: 'Landing page, downloads and installers',
    surface: 'the landing page, the downloads section or the desktop/Android app',
    terms: ['landing', 'website', 'download', 'downloads', 'installer', 'windows app', 'android', 'apk', 'electron', 'seo', 'sitemap', 'install'],
    files: [
      'client/landing/index.html',
      'scripts/deploy-web.ps1',
      'scripts/build-windows-installer.ps1',
      'apps/mobile/android/app/build.gradle',
    ],
    steps: [
      'Open the landing page / download the installer exactly as the reporter did (their words are quoted above).',
      'Repeat the install or download step on a clean profile or machine.',
      'Compare the page/installer version, size and checksum with the release feed.',
      'Note the exact message the browser or installer shows.',
    ],
    clarify: 'Which platform and browser were used, and was this the first install or an update over an older version?',
  },
  {
    id: 'maintenance',
    name: 'Maintenance mode, health and deployment',
    surface: 'the maintenance page, the health endpoint or a deploy step',
    terms: ['maintenance', 'read-only', 'health', 'deploy', 'outage', '503', 'version', 'update'],
    files: [
      'apps/web/src/components/MaintenancePage.tsx',
      'apps/web/src/lib/maintenance.ts',
      'server/src/controllers/appController.js',
      'server/src/server.js',
      'docs/deploy.md',
    ],
    steps: [
      'Open the app while the reported mode/state is active (see the reporter’s words above).',
      'Check the API health endpoint and the browser console while the page is shown.',
      'Reproduce the reported action and watch whether writes are blocked with a visible message.',
      'Note the HTTP status/code, the on-screen text and what the audit log records.',
    ],
    clarify: 'Which mode was active (maintenance, read-only or development preview) and which action was blocked or wrongly allowed?',
  },
];

const DEFAULT_AREA = {
  id: 'general-chat',
  name: 'Chatgram chat app (general UI behaviour)',
  surface: 'the main Chatgram window and the relevant chat/settings screen',
  terms: [],
  files: [
    'apps/web/src/App.tsx',
    'apps/web/src/components/ChatList.tsx',
    'server/src/controllers/messageController.js',
  ],
  steps: [
    'Sign in on staging with a test account and open the screen the reporter used (their words are quoted above).',
    'Repeat the exact action described there, step by step.',
    'Watch the screen, the browser console and the API log while it happens.',
    'Note what appeared instead of the expected result and any error text.',
  ],
  clarify: 'Which screen was open, what was tapped or typed, and what happened instead of the expected result?',
};

/* --------------------------------------------------------------------- helpers */

// Path fragments that tie a repo path to a feature area. Used to keep the
// docs-extracted "Likely files" list relevant instead of picking any path that
// happens to share a word with the report.
const AREA_PATH_HINTS = {
  'ai-reports': ['report', 'inbox', 'telegram', 'chatgram', 'mention', 'ai/'],
  calls: ['call', 'webrtc', 'socket'],
  messages: ['message', 'composer', 'media', 'upload', 'voice'],
  groups: ['group', 'chat'],
  status: ['status'],
  auth: ['auth', 'login', 'user', 'password', '2fa', 'twofactor'],
  'chat-list': ['chatlist', 'chat', 'notif', 'search'],
  'support-admin': ['support', 'admin', 'help', 'report'],
  'landing-installers': ['landing', 'deploy', 'download', 'install', 'electron', 'mobile', 'android'],
  maintenance: ['maintenance', 'health', 'server', 'deploy'],
  'general-chat': ['chat', 'message'],
};

function clean(value, max = 1200) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function asStringArray(value, maxItems = 8, maxEach = 240) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const rows = [];
  for (const item of value) {
    const text = clean(typeof item === 'string' ? item : item && typeof item === 'object' ? Object.values(item).join(' ') : '', maxEach)
      .replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '');
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(text);
    if (rows.length >= maxItems) break;
  }
  return rows;
}

function lower(value) {
  return String(value == null ? '' : value).toLowerCase();
}

/** Whole-word (or whole-phrase) match, tolerant of a plural "s". */
function hasTerm(haystack, term) {
  const value = String(term || '').trim();
  if (!value) return false;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:s|es)?(?:$|[^a-z0-9])`, 'i').test(String(haystack || ''));
}

function keywordsOf(report) {
  const text = [report.title, report.summary, report.userText, report.transcript].filter(Boolean).join(' ');
  const words = lower(text).match(/[a-z0-9@-]{3,}/g) || [];
  const stop = new Set([
    'the', 'and', 'for', 'are', 'was', 'were', 'this', 'that', 'with', 'from', 'have', 'has', 'not', 'but', 'you', 'your',
    'our', 'its', 'can', 'could', 'should', 'would', 'when', 'what', 'why', 'how', 'who', 'where', 'after', 'before',
    'then', 'than', 'them', 'they', 'there', 'here', 'please', 'just', 'like', 'also', 'only', 'does', 'did', 'done',
    'into', 'about', 'over', 'under', 'again', 'still', 'very', 'some', 'any', 'all', 'one', 'two', 'now', 'get', 'got',
    'chatgram', 'app', 'chat', 'problem', 'issue', 'fix', 'broken', 'error', 'thing', 'something',
  ]);
  return [...new Set(words.filter((word) => !stop.has(word)))];
}

/** Pick the most likely feature area from keyword hits; ties go to the earlier area. */
function inferFeatureArea(report = {}) {
  // `source` is deliberately excluded: "AI chat" appears on every 1:1 AI report
  // and would otherwise force the AI-reports area for unrelated bugs.
  const haystack = lower([report.title, report.summary, report.userText, report.transcript].filter(Boolean).join(' '));
  if (!haystack) return DEFAULT_AREA;
  let best = DEFAULT_AREA;
  let bestScore = 0;
  for (const area of AREA_DEFS) {
    let score = 0;
    for (const term of area.terms) {
      if (!hasTerm(haystack, term)) continue;
      // Multi-word phrases are stronger evidence than a single generic word.
      score += term.includes(' ') ? 3 : 1;
    }
    if (score > bestScore) {
      best = area;
      bestScore = score;
    }
  }
  return best;
}

function existingFiles(files = []) {
  const out = [];
  for (const file of files) {
    const rel = String(file || '').replace(/^\.?\//, '');
    if (!/^(?:apps|server|client|scripts|tests)\//.test(rel)) continue;
    try {
      if (fs.existsSync(path.join(REPO_ROOT, rel))) out.push(rel);
    } catch {
      /* the repo subset may not contain this file */
    }
  }
  return [...new Set(out)];
}

/* -------------------------------------------------------------- docs grounding */

const docsCache = { loaded: false, progress: null, decisions: null };

function loadDocs() {
  if (docsCache.loaded) return docsCache;
  docsCache.loaded = true;
  for (const file of ['progress', 'decisions']) {
    try {
      docsCache[file] = fs.readFileSync(path.join(REPO_ROOT, 'docs', `${file}.md`), 'utf8');
    } catch {
      docsCache[file] = null;
    }
  }
  return docsCache;
}

/** Test hook: force the docs to be read again (used when a file appears later). */
function resetDocsCache() {
  docsCache.loaded = false;
  docsCache.progress = null;
  docsCache.decisions = null;
}

const PATH_RE = /(?:apps\/web\/src|apps\/mobile|client\/landing|server\/src|server\/test|tests|scripts)\/[\w./-]+\.(?:tsx?|jsx?|mjs|json|html|css|md|ps1|yml)/g;

function lineScore(line, keywords, areaTerms, areaHints) {
  const haystack = lower(line);
  let hits = 0;
  for (const keyword of keywords) if (keyword && hasTerm(haystack, keyword)) hits += 1;
  for (const term of areaTerms) if (term && hasTerm(haystack, term)) hits += 1;
  for (const hint of areaHints) if (hint && hasTerm(haystack, hint)) hits += 1;
  if (/session \d+|^#{1,3} /i.test(line)) hits += 0.5;
  // Favour short, specific doc lines over the huge merged status paragraphs:
  // a line that matches a lot in a few hundred characters is better evidence.
  const density = hits / Math.max(1, line.length / 220);
  return hits + Math.min(4, density);
}

const AREA_PATH_PRIMARY = {
  'ai-reports': 'report',
  calls: 'call',
  messages: 'message',
  groups: 'group',
  status: 'status',
  auth: 'auth',
  'chat-list': 'chat',
  'support-admin': 'support',
  'landing-installers': 'landing',
  maintenance: 'maintenance',
  'general-chat': 'chat',
};

function pathScore(file, hints, area) {
  const haystack = lower(file);
  let score = 0;
  for (const hint of hints) if (hint && haystack.includes(hint)) score += 2;
  const primary = AREA_PATH_PRIMARY[area.id] || '';
  if (primary && haystack.includes(primary)) score += 6;
  try {
    if (fs.existsSync(path.join(REPO_ROOT, file))) score += 1;
  } catch {
    /* ignore */
  }
  return score;
}

function sanitizeEvidence(line) {
  return clean(
    line
      .replace(/^#{1,6}\s*/, '')
      .replace(/^[-*•]\s*/, '')
      .replace(/\s*[-–—]\s*$/, ''),
    DOC_LINE_LIMIT,
  );
}

/**
 * Pull the doc lines that mention this report and the repo paths they name.
 * This is what makes "Likely files" come from docs/progress.md + docs/decisions.md
 * instead of being guessed. Missing docs (production deploys only server/src)
 * simply produce no evidence and the area table is used instead.
 */
function extractDocsEvidence(report = {}) {
  const docs = loadDocs();
  const keywords = keywordsOf(report);
  const area = inferFeatureArea(report);
  const areaTerms = area.terms.concat([area.id.split('-')[0]]).filter(Boolean);
  const areaHints = AREA_PATH_HINTS[area.id] || [];
  const evidence = [];
  const pathScores = new Map();
  for (const [name, content] of [['progress', docs.progress], ['decisions', docs.decisions]]) {
    if (!content) continue;
    const lines = content.split(/\r?\n/);
    const scored = [];
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.length < 24 || line.length > 1500) continue;
      // Table rows and pure changelog separators carry no usable guidance.
      if (/^\|/.test(line) || /^---+$/.test(line)) continue;
      const score = lineScore(line, keywords, areaTerms, areaHints);
      // A bare heading scores exactly 1 (heading bonus only): not evidence.
      if (score <= 1.01) continue;
      const foundPaths = line.match(PATH_RE) || [];
      for (const rawPath of foundPaths) {
        const file = rawPath.replace(/[).,;:]+$/, '');
        const candidate = pathScore(file, areaHints, area) + Math.min(6, score);
        if ((pathScores.get(file) || 0) < candidate) pathScores.set(file, candidate);
      }
      // Evidence should be a heading about this feature area or a line that
      // names a repo path in it — never a merged changelog paragraph or an
      // unrelated heading that merely shares one report word.
      const isHeading = /^#{1,6}\s/.test(line);
      const areaMatch =
        areaTerms.some((term) => term && hasTerm(line, term)) || areaHints.some((hint) => hint && hasTerm(line, hint));
      const namesRelevantPath = foundPaths.some((rawPath) => {
        const file = rawPath.replace(/[).,;:]+$/, '');
        return pathScore(file, areaHints, area) >= 4;
      });
      if (!namesRelevantPath && !(isHeading && areaMatch)) continue;
      scored.push({ line, score });
    }
    scored.sort((left, right) => right.score - left.score);
    for (const { line } of scored.slice(0, DOC_EVIDENCE_LIMIT)) {
      const text = sanitizeEvidence(line);
      const key = text.toLowerCase();
      if (!text || evidence.some((entry) => entry.text.toLowerCase() === key)) continue;
      evidence.push({ doc: `docs/${name}.md`, text });
    }
  }
  const paths = [...pathScores.entries()]
    .filter(([file, score]) => score >= 4 && areaHints.some((hint) => hint && lower(file).includes(hint)))
    .sort((left, right) => right[1] - left[1])
    .map(([file]) => file)
    .slice(0, 8);
  return {
    evidence: evidence.slice(0, 4),
    paths,
    available: Boolean(docs.progress || docs.decisions),
  };
}

/* ------------------------------------------------------------------- vagueness */

const VAGUE_RE = /^(?:it'?s?\s+)?(?:not\s+working|doesn'?t\s+work|broken|bug|error|problem|issue|fails?|failed|fix (?:it|this)|help)$/i;
const CONCRETE_RE = /(?:when i|after i|while i|when we|screen|button|tap|click|type|send|open|call|upload|message|login|sign|search|group|status|photo|video|message|error|crash|blank|freez|slow|notification|admin|report|telegram|inbox|settings|composer|profile|status|download|install|code|password|ring|join|leave|scroll|refresh|reload)/i;

/** True when the report has no concrete behaviour and no usable steps. */
function isVagueReport(report = {}) {
  const text = clean(report.userText || report.summary || report.title, 2000);
  if (!text) return true;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 5) return true;
  if (VAGUE_RE.test(text) && !CONCRETE_RE.test(text)) return true;
  const concreteHits = (text.match(CONCRETE_RE) || []).length;
  if (words.length < 9 && concreteHits === 0) return true;
  return false;
}

/* ------------------------------------------------------- no repeated user words */

function wordsPattern(fragment) {
  const words = String(fragment || '').split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return new RegExp(words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'gi');
}

/** True when the candidate carries the reporter's wording verbatim (not just a word). */
function containsUserWords(candidate, userText) {
  const target = clean(userText, 2000);
  if (!target || target.length < 12) return false;
  const pattern = wordsPattern(target);
  if (!pattern) return false;
  pattern.lastIndex = 0;
  return pattern.test(String(candidate || ''));
}

/**
 * The reporter's exact words may appear once (Observed). Everywhere else, replace
 * a verbatim copy with a reference to the quote above.
 */
function scrubUserRepetition(candidate, userText) {
  let output = String(candidate || '');
  const target = clean(userText, 2000);
  if (!target || target.length < 12) return output;
  const fragments = target.split(/(?<=[.!?])\s+/).filter((fragment) => fragment.trim().length >= 14);
  fragments.push(target);
  for (const fragment of fragments) {
    if (!containsUserWords(output, fragment)) continue;
    const pattern = wordsPattern(clean(fragment, 400));
    if (!pattern) continue;
    output = output.replace(pattern, 'the reporter’s words above');
  }
  return output;
}

/* ------------------------------------------------------------------- templates */

function referenceLine(report) {
  const parts = [];
  if (report.ref) parts.push(String(report.ref));
  if (report.type) parts.push(String(report.type).replace(/_/g, ' '));
  return parts.join(' · ') || 'Chatgram AI report';
}

function classifyType(type) {
  if (type === 'feature_request') return 'feature';
  if (type === 'complaint') return 'complaint';
  return 'bug';
}

function templateGoal(report, area) {
  if (isVagueReport(report)) {
    const label = report.type === 'feature_request' ? 'feature request' : report.type === 'complaint' ? 'complaint' : 'report';
    return `Clarify and investigate the vague ${label} (${area.name}); ask the clarification questions below before changing code.`;
  }
  const title = scrubUserRepetition(clean(report.title, 160), report.userText);
  if (report.type === 'feature_request') {
    return `Add the capability described by ${title && title.toLowerCase() !== clean(report.summary, 160).toLowerCase() ? `“${title}”` : 'the report'} in ${area.name}, without regressions.`;
  }
  if (report.type === 'complaint') {
    return `Resolve the complaint “${title || area.name}” in ${area.name} so the reported flow works as expected.`;
  }
  return `Fix the reported problem “${title || 'Chatgram behaviour'}” in ${area.name}.`;
}

function templateExpected(report, area) {
  const kind = classifyType(report.type);
  if (kind === 'feature') {
    return `The requested capability is present in ${area.name} (${area.surface}) and can be used end to end exactly as described, while the existing behaviour keeps working.`;
  }
  if (kind === 'complaint') {
    return `The flow in ${area.name} (${area.surface}) completes without the problem described; the reporter gets the result they expected and any visible error is gone.`;
  }
  return `The flow in ${area.name} (${area.surface}) completes as it did before the regression: no error, no stuck state, and the expected result appears within a couple of seconds.`;
}

function templateSteps(report, area) {
  const steps = area.steps.slice(0, 4);
  if (report.type === 'feature_request') {
    steps.push('Confirm the capability the reporter is asking for does not exist yet, then add it and repeat the flow.');
  } else {
    steps.push('Record the actual result and a screenshot or exact error text before changing code, then repeat the flow after the fix.');
  }
  return steps;
}

function templateAcceptance(report, area) {
  const rows = [];
  if (report.type === 'feature_request') {
    rows.push(`The requested capability in ${area.name} exists and works end to end (verified on staging with temporary test accounts that are deleted afterwards).`);
    rows.push(`The existing behaviour of ${area.name} still works after the change (no regression in the related test file/script).`);
  } else {
    rows.push(`Following the numbered steps above no longer shows the problem in ${area.name}.`);
    rows.push(`The expected behaviour above is confirmed on staging with temporary test accounts that are deleted afterwards.`);
  }
  rows.push(`The existing test for this area is extended with a check for this exact case and passes.`);
  rows.push('Any web change passes `npm run typecheck` and the production build; any server change passes `node --check`.');
  return rows;
}

function templateClarification(report, area) {
  if (!isVagueReport(report)) return [];
  const rows = [
    'Which screen or feature were you in when this happened?',
    'What exactly did you tap, type or send just before it happened?',
    'What did you expect to see, and what appeared instead (quote any error text)?',
    area.clarify,
  ];
  return [...new Set(rows.map((row) => clean(row, 240)))];
}

/* --------------------------------------------------------------- prompt render */

function section(title, rows) {
  const body = (Array.isArray(rows) ? rows : [rows]).filter((row) => row != null && String(row).trim() !== '');
  if (!body.length) return '';
  return `${title}\n${body.join('\n')}`;
}

function numbered(rows) {
  return rows.map((row, index) => `${index + 1}. ${clean(row, 300)}`).join('\n');
}

function bullets(rows) {
  return rows.map((row) => `- ${clean(row, 300)}`).join('\n');
}

function renderPrompt(report, plan) {
  const quote = clean(report.userText, 1800);
  const observedRows = [];
  if (quote) {
    observedRows.push(`> ${quote}`);
    if (plan.observedExtra) {
      observedRows.push('', `In concrete terms: ${plan.observedExtra}`);
    }
  } else {
    observedRows.push(plan.observedExtra ? `In concrete terms: ${plan.observedExtra}` : 'The report was captured without the reporter’s exact words.');
  }

  const contextRows = [
    `- Part of Chatgram: ${plan.featureArea}`,
    `- Report: ${referenceLine(report)}${report.source ? ` · from ${clean(report.source, 120)}` : ''}${report.askerName ? ` · asked by ${clean(report.askerName, 80)}` : ''}`,
  ];
  if (plan.vague) contextRows.push('- The report is vague: missing details are listed under "Needs clarification" — ask before inventing behaviour.');

  const fileRows = plan.likelyFiles.map((file) => `- ${file}`);
  if (plan.docsEvidence.length) {
    fileRows.push('');
    for (const entry of plan.docsEvidence) fileRows.push(`From ${entry.doc}: “${entry.text}”`);
  } else if (plan.docsAvailable) {
    fileRows.push('', 'docs/progress.md and docs/decisions.md cover this area but did not name exact files for this report; verify the paths above in the repo before editing.');
  } else {
    fileRows.push('', 'Docs/progress.md and docs/decisions.md were not available where this server runs; the paths above come from the area table — verify them in the repo before editing.');
  }

  const acceptanceRows = plan.acceptanceCriteria.map((row) => `- [ ] ${clean(row, 280)}`);

  const clarification = plan.questions.length
    ? section('Needs clarification (ask the reporter before inventing details):', numbered(plan.questions))
    : '';

  const blocks = [
    `Goal: ${clean(plan.goal, 260)}`,
    '',
    section('Context:', contextRows),
    '',
    section('Observed behaviour (the reporter’s exact words — quoted once, not repeated below):', observedRows),
    '',
    section('Expected behaviour:', clean(plan.expected, 700)),
    '',
    section('Steps to reproduce:', numbered(plan.steps)),
    '',
    section('Likely files or modules (taken from docs/progress.md and docs/decisions.md; verify before editing):', fileRows),
    '',
    section('Acceptance criteria:', acceptanceRows),
    '',
    clarification ? `${clarification}\n` : '',
    section('Constraints:', bullets(plan.constraints)),
  ];
  return limitText(blocks.filter((block) => block !== '').join('\n'), PROMPT_LIMIT);
}

/** Cut only at a line boundary, never in the middle of a word/sentence. */
function limitText(text, limit) {
  const value = String(text || '');
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const boundary = cut.lastIndexOf('\n');
  return (boundary > limit * 0.5 ? cut.slice(0, boundary) : cut).trimEnd();
}

function defaultPlan(report) {
  const area = inferFeatureArea(report);
  const docs = extractDocsEvidence(report);
  // The curated area table is itself the docs' module map; docs-extracted paths
  // are appended after it when they really exist in this checkout.
  const areaFiles = existingFiles(area.files);
  const docsFiles = docs.paths.filter((file) => /\.(?:tsx?|jsx?|mjs)$/.test(file) && !areaFiles.includes(file));
  const merged = [...new Set([...areaFiles, ...docsFiles])].slice(0, 8);
  return {
    area,
    vague: isVagueReport(report),
    featureArea: area.name,
    goal: templateGoal(report, area),
    expected: templateExpected(report, area),
    steps: templateSteps(report, area),
    likelyFiles: merged,
    docsEvidence: docs.evidence,
    docsAvailable: docs.available,
    acceptanceCriteria: templateAcceptance(report, area),
    questions: templateClarification(report, area),
    constraints: FALLBACK_CONSTRAINTS.slice(),
    observedExtra: '',
  };
}

/** Deterministic, report-specific prompt. Never throws. */
function buildTemplatePrompt(report = {}) {
  try {
    return renderPrompt(report, defaultPlan(report || {}));
  } catch (error) {
    return [
      `Goal: Investigate the Chatgram report ${clean(report && report.ref, 40) || '(reference pending)'}.`,
      '',
      `Observed behaviour (the reporter’s exact words — quoted once, not repeated below):\n> ${clean(report && (report.userText || report.summary || report.title), 1800) || '(no text captured)'}`,
      '',
      'Steps to reproduce:\n1. Reproduce the reported flow on staging with a temporary test account.\n2. Record the actual behaviour and error text before changing code.',
      '',
      'Constraints:\n- Keep the change small; never print secrets; deploy per docs/deploy.md with a backup, health gate and rollback row.',
    ].join('\n');
  }
}

/* ------------------------------------------------------------------ AI second call */

const FIX_PROMPT_SYSTEM = `You write fix prompts for a coding assistant that works on Chatgram, a messaging app (React/Vite web client in apps/web, Electron desktop shell, Capacitor Android, Express + Mongoose API in server/src, docs in docs/progress.md and docs/decisions.md).
The assistant has repo access but a LIMITED token budget, so the prompt must be specific and compact. Never invent details the reporter did not give.

Return ONLY valid JSON (no markdown, no code fences) with exactly these keys:
{"goal":"one line describing the change","featureArea":"short area name","observed":"a short paraphrase of what happened (do NOT copy the reporter's words)","expected":"concrete expected behaviour","steps":["feature-specific numbered reproduction steps"],"likelyFiles":["repo-relative paths chosen from docsEvidence/paths"],"acceptanceCriteria":["checkable statements"],"needsClarification":["questions for the reporter"],"confidence":0.0}

Rules:
- The reporter's exact words are shown in observedUserWords. Use them ONLY as context; do NOT copy that wording into goal/observed/expected/steps/acceptanceCriteria (refer to "the reporter's words above" instead).
- If important information is missing (no concrete behaviour, no steps, no screen), put the missing questions in needsClarification and lower confidence instead of guessing.
- likelyFiles must be chosen from the docsEvidence/paths provided; use an empty array if nothing fits.
- steps must mention the real Chatgram screen/control and end with how to verify the fix.
- acceptanceCriteria must be checkable by a person or a test (no vague "works correctly").
- Keep the JSON under 1200 tokens.`;

function extractJsonBlock(raw) {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Validate the provider JSON field by field. Returns null when unusable. */
function validateAiPlan(raw, report, basePlan) {
  const parsed = extractJsonBlock(raw);
  if (!parsed) return null;
  const goal = clean(parsed.goal, 260);
  const featureArea = clean(parsed.featureArea, 120);
  const observed = clean(parsed.observed, 500);
  const expected = clean(parsed.expected, 700);
  const steps = asStringArray(parsed.steps, 8, 300);
  const likelyFiles = asStringArray(parsed.likelyFiles, 10, 220).filter((file) => /^(?:apps|server|client|scripts|tests)\//.test(file));
  const acceptanceCriteria = asStringArray(parsed.acceptanceCriteria, 8, 280);
  const questions = asStringArray(parsed.needsClarification, 6, 240);
  const confidence = Number(parsed.confidence);
  const hasCore = Boolean(goal || expected || steps.length);
  if (!hasCore) return null;
  return {
    featureArea: featureArea || basePlan.featureArea,
    goal: goal || basePlan.goal,
    expected: expected || basePlan.expected,
    steps: steps.length ? steps : basePlan.steps,
    likelyFiles: likelyFiles.length ? likelyFiles : basePlan.likelyFiles,
    acceptanceCriteria: acceptanceCriteria.length ? acceptanceCriteria : basePlan.acceptanceCriteria,
    questions: questions.length ? questions : basePlan.vague ? basePlan.questions : [],
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : null,
  };
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fix prompt generation timed out')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function askAdminAi(report, basePlan, chatOverride) {
  const chat =
    typeof chatOverride === 'function'
      ? chatOverride
      : (options) => require('./service').service.chat(options);
  const transcript = clean(report.transcript, 2400);
  const payload = {
    type: report.type,
    title: clean(report.title, 200),
    summary: clean(report.summary, 800),
    observedUserWords: clean(report.userText, 1200),
    source: clean(report.source, 120),
    askerName: clean(report.askerName, 80),
    transcript: transcript || undefined,
    featureAreaGuess: basePlan.featureArea,
    docsEvidence: basePlan.docsEvidence.map((entry) => `${entry.doc}: ${entry.text}`).slice(0, 3),
    paths: basePlan.likelyFiles,
  };
  const timeoutMs = Math.min(45000, Math.max(250, Number(process.env.AI_FIX_PROMPT_TIMEOUT_MS) || 20000));
  const result = await withTimeout(
    Promise.resolve(
      chat({
        feature: 'chatgramAI',
        // Admin-side internal call: it is not a user-facing assistant feature, so
        // it uses the configured feature route even when the legacy single-provider
        // toggle is off (staging routes chatgramAI to a local mock provider).
        ignoreLegacyToggle: true,
        system: FIX_PROMPT_SYSTEM,
        messages: [{ role: 'user', text: JSON.stringify(payload) }],
        temperature: 0.2,
        maxTokens: 900,
      }),
    ),
    timeoutMs,
  );
  return String((result && result.text) || '');
}

/** Merge AI rows with the deterministic rows, dropping near-duplicates. */
function mergeRows(primary, fallback, max = 6) {
  const out = [];
  for (const row of [...(primary || []), ...(fallback || [])]) {
    const text = clean(row, 280);
    if (!text) continue;
    const key = text.toLowerCase();
    const duplicate = out.some((existing) => {
      const previous = existing.toLowerCase();
      return previous === key || previous.includes(key) || key.includes(previous);
    });
    if (!duplicate) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/** Merge the validated AI answer into the deterministic plan (template covers gaps). */
function mergeAiPlan(basePlan, ai) {
  return {
    ...basePlan,
    featureArea: clean(ai.featureArea, 120) || basePlan.featureArea,
    goal: clean(ai.goal, 260) || basePlan.goal,
    expected: clean(ai.expected, 700) || basePlan.expected,
    steps: (ai.steps || []).length ? ai.steps : basePlan.steps,
    likelyFiles: ai.likelyFiles.length ? ai.likelyFiles : basePlan.likelyFiles,
    acceptanceCriteria: mergeRows(ai.acceptanceCriteria, basePlan.acceptanceCriteria),
    questions: (ai.questions || []).length ? ai.questions : basePlan.questions,
    observedExtra: clean(ai.observed, 500),
  };
}

/* ---------------------------------------------------------------------- public */

/**
 * Generate a fix prompt for a problem report. Never throws; always resolves to
 * `{ text, source: 'ai'|'template', questions, featureArea }`.
 *
 * @param {object} report  the AdminInbox report (plain object or mongoose doc)
 * @param {{chat?: Function, forceTemplate?: boolean}} [options]
 */
async function generateFixPrompt(report, options = {}) {
  let basePlan;
  try {
    const plain = typeof report?.toObject === 'function' ? report.toObject() : report || {};
    basePlan = defaultPlan(plain);
    let aiPlan = null;
    if (!options.forceTemplate) {
      try {
        const raw = await askAdminAi(plain, basePlan, options.chat);
        aiPlan = validateAiPlan(raw, plain, basePlan);
      } catch (error) {
        aiPlan = null;
      }
    }
    let plan = basePlan;
    let source = 'template';
    if (aiPlan) {
      plan = mergeAiPlan(basePlan, aiPlan);
      // Scrub the reporter's exact words out of every generated field except the
      // single quote in Observed.
      plan.goal = scrubUserRepetition(plan.goal, plain.userText) || basePlan.goal;
      plan.expected = scrubUserRepetition(plan.expected, plain.userText) || basePlan.expected;
      plan.steps = plan.steps.map((step) => scrubUserRepetition(step, plain.userText));
      plan.acceptanceCriteria = plan.acceptanceCriteria.map((row) => scrubUserRepetition(row, plain.userText));
      plan.questions = plan.questions.map((row) => scrubUserRepetition(row, plain.userText));
      plan.observedExtra = clean(scrubUserRepetition(plan.observedExtra, plain.userText), 500);
      if (/^the reporter’s words above\.?$/i.test(plan.observedExtra)) plan.observedExtra = '';
      source = 'ai';
    }
    // If the provider claimed confidence but left the report without any
    // clarification while it is vague, keep the deterministic questions.
    if (plan.vague && !plan.questions.length) plan.questions = basePlan.questions;
    if (!plan.steps.length) plan.steps = basePlan.steps;
    if (!plan.acceptanceCriteria.length) plan.acceptanceCriteria = basePlan.acceptanceCriteria;
    const text = renderPrompt(plain, plan);
    return {
      text,
      source,
      questions: plan.questions.slice(0, 6),
      featureArea: plan.featureArea,
    };
  } catch (error) {
    // The template itself is tiny and safe; still guard the caller.
    let text;
    try {
      text = renderPrompt(report || {}, defaultPlan(report || {}));
    } catch {
      text = buildTemplatePrompt(report || {});
    }
    return { text, source: 'template', questions: [], featureArea: DEFAULT_AREA.name };
  }
}

module.exports = {
  PROMPT_LIMIT,
  FALLBACK_CONSTRAINTS,
  SUPPORT_EMAIL,
  AREA_DEFS,
  inferFeatureArea,
  isVagueReport,
  lineScore,
  scrubUserRepetition,
  containsUserWords,
  extractDocsEvidence,
  resetDocsCache,
  buildTemplatePrompt,
  generateFixPrompt,
  defaultPlan,
  renderPrompt,
};
