# Group "@Chatgram AI" mentions — production diagnosis + fix (2026-10-26)

Scope: group `@Chatgram AI` mentions only. Read-only diagnosis on production
(`ubuntu@84.12.64.204`, `~/chatgram/server`, PM2 `chatgram-api`, MongoDB Atlas);
the fix landed in **server code only** and was **not deployed**. No Playwright,
no screenshots, no full test gate. `docs/progress.md`, `client/landing/**` and
`apps/web/**` were not edited.

## 0. Where the reported mentions actually live

The production DB has **no group literally named "Janvier Yedid"**. The only
group with `groupSettings.aiMentions = true` is **"JIPSE"**
(`6adef550aa2cd8b274e6617a`, 5 members, created 2026-10-26 06:38 UTC by
Janvier Yedid), and every mention in the reported window is in that group. The
"Janvier Yedid" title is how the web client was showing the group (the group
header previously rendered the partner name/avatar — fixed in session 50), not
the stored group name. The direct chat with Janvier Yedid contains no mentions.

Evidence used: PM2 `out`/`error` logs (`~/.pm2/logs/chatgram-api-*.log`, cover
2026-10-26 07:05–07:53 UTC) + read-only Node scripts against Atlas
(`users`, `chats`, `messages`, `admininboxes`, `aisettings`,
`platformsettings`). No secrets, keys or connection strings were printed; the
scripts were scp'd to `/home/ubuntu/*.js`, run, then deleted.

## 1. Diagnosis table (2026-10-26, local = Africa/Kigali UTC+2)

| # | Time (local / UTC) | Message (snippet) | Outcome | Exact reason |
|---|---|---|---|---|
| 1 | 09:11:58 / 07:11:58 | `@chatgramai` (Janvier) | **Answered** 09:12:01 (242 chars, Kinyarwanda) | OK, but the answer came from the **last 10 group messages** (it answered the notifications discussion), not from a question — wrong context. This was also the first ever AI mention, which is why the Chatgram AI system account was created at 07:11:58. |
| 2 | 09:12:17 / 07:12:17 | `@Chatgram AI hello` (Mugisha) | **No answer** | **20 s minimum gap**: previous answer at 07:12:01.035 → 16.36 s elapsed < 20 s. `return null`, nothing visible. |
| 3 | 09:12:21 / 07:12:21 | `so go ahead @chatgramai` (Janvier) | **Answered** 09:12:22 | 20.35 s after #1, so it passed the gap check; answer was the generic "Hello! How can I assist you today?" (again history-only context). |
| 4 | 09:13:02 / 07:13:02 | `@chatgram how are you doing buddy` (Mugisha) | **No answer** | **Mention not parsed**: the regex was `/@chatgram\s*ai\b/i` — a bare `@chatgram` (no `ai`) never matched. The message was stored as a plain group message. |
| 5 | 09:16:22 / 07:16:22 | `@chatgramai create subnetting plan…determine the subnet mask` (Janvier) | **Answered but CUT OFF** at 07:16:23 — 589 chars, ends mid-table cell `\| 4 \| 192.168.1.192/26 \| 192.168.1.193 \| 192.168.1.254 \| 192.168` | **Provider length truncation + no detection**: the group path asked for only `max_tokens: 400` (gpt-oss via `ollama-cloud` counts its reasoning tokens) and the code blindly sliced the answer at 1400 chars; `finish_reason` and unfinished markdown tables/code fences were never checked. This is exactly the "192.168" cut. |
| 6 | 09:16:50 / 07:16:50 | `@chatgramai i wanna know this clearly i dont know anything create subnetting…` (Janvier) | **No answer** | **Per-group rate limit (3 replies / 10 min)**: replies at 07:12:01, 07:12:22, 07:16:23 already filled the window. `rateLimited()` → `return null`. |
| 7 | 09:18:36 / 07:18:36 | long persona prompt **without** a mention (1292 chars, Janvier) | No answer (not a mention) | Listed for completeness; a non-mention message is not supposed to reach the AI. |
| 8 | 09:18:53 / 07:18:53 | `@chatgramai text You are an elite, omniscient AI research assistant…` (1309 chars, Janvier) | **No answer** | **Per-group rate limit**: the earliest answer (07:12:01) stays in the 10-min window until 07:22:01, so 3/3 still used → silent. It was **not** rejected for length: the group path had no input cap and the message (1309 chars) was stored normally. |
| 9 | 09:19:01 / 07:19:01 | `@chatgramai how are you doing buddy` (Mugisha) | **No answer** | Per-group rate limit (3/10 min, same as #8). |
| 10 | 09:19:12 / 07:19:12 | persona prompt repeated (1309 chars, Janvier) | **No answer** | Per-group rate limit (3/10 min). |
| 11 | 09:20:02 / 07:20:02 | `@chatgramai i wanna know this clearly…` (Janvier) | **No answer** | Per-group rate limit (until 07:22:01). |
| 12 | 09:20:12 / 07:20:12 | `@chatgramai hello` (Janvier) | **No answer** | Per-group rate limit (until 07:22:01). |

### Rules ruled out for this window

| Candidate reason | Finding |
|---|---|
| Group toggle off | **No** — `chats.groupSettings.aiMentions = true` for JIPSE; the account was even added as a participant at 07:11:58. |
| Blocked topic | **No** — `AiSettings.aiPolicy` was empty / `blockedTopics: []`; env topics unset. |
| Max input length | **No** — no group input limit existed; the 1309-char persona messages were stored and would have been attempted. |
| Provider 429 / quota / timeout / slow | **Not in this window** — no provider error in the PM2 logs for 07:13–07:20; the provider answered at 07:16:23; the earlier 06:39 `chatgram_unknown` Inbox record shows `provider: ollama-cloud` and a normal answer. Provider health counters are **in-memory only** (not persisted), so a transient error cannot be proven either way — but nothing in the logs or records points to one. |
| Swallowed error | **Yes, structurally** — every non-answer path does `return null` (rate limit, blocked topic, provider failure, empty answer), so no user-visible signal and no log/Inbox record. PM2 showed no "Group AI mention failed" lines because the provider calls that failed never happened (the limiter returned first). |
| Group AI metrics/records missing | **Yes** — there was **no Admin Inbox record and no metric row** for any group mention. The only Inbox row that morning (06:39, `chatgram_unknown`) came from the 1:1 Chatgram AI thread. |

### Log/record coverage caveats (what existed vs. what was missing)

- PM2 logs covered the window (07:05–07:53 UTC present), but the **only** group-AI
  line was `Chatgram AI account created: …` at 07:11:58. The mention path logs
  nothing on success and nothing on silent rejections.
- Messages and their exact `sentAt` timestamps exist in `messages`, which is how
  the 20 s / 10 min reconstructions above were made.
- Provider request/response latency and `finish_reason` are **not stored** for
  group mentions (no AiMessage records on the group path), so the truncation at
  589 chars is inferred from the stored text + the old `max_tokens: 400` /
  `slice(0,1400)` code, not from a provider log.
- In-memory rate-limit state (`recent` Map) is lost on restart, so pre-window
  history cannot be reconstructed beyond the stored answers.

### Config found in production (safe fields only)

- `AiSettings.features.chatgramAI = { primary: "ollama-cloud", fallbacks: ["ollama-cloud"] }` —
  the fallback pointed at the **same** provider (no real secondary provider).
- Provider `ollama-cloud`: `provider: "custom"`, model `gpt-oss:120b`,
  base URL host `ollama.com`, `timeoutMs: 20000`, key present.
- `SUPPORT_AI_ENABLED=true`; `GROQ_API_KEY` present in env but **not** configured
  as a provider/fallback in the routing.
- Platform AI feature enabled (`aiEnabled: true`).
- Group JIPSE: 5 members, `aiMentions: true`, AI account is a participant.

## 2. What changed (server only, not deployed)

Files changed/added:

| File | Change |
|---|---|
| `server/src/ai/groupMentions.js` | Rewritten: alias parsing, FIFO per-group queue with typing indicator, per-user/per-group/queue/notice limits, polite notices, 1200-token output, truncation detection, 2–3 message split, "Want more detail?" hint, asker prefix, context = asking message (+ quote) only, Admin Inbox record on total provider failure, GroupAiEvent metrics. |
| `server/src/ai/policy.js` | Added admin-editable group limits: `groupUserHourlyLimit` (10), `groupChatHourlyLimit` (60), `groupQueueLimit` (5), `groupMaxInputChars` (2000), `groupMaxOutputTokens` (1200), `groupNoticeCooldownMs` (60000), `groupMinGapMs` (20000) — all stored in the existing `AiSettings.aiPolicy` and validated by the existing `PUT /api/admin/ai/policy`. |
| `server/src/ai/service.js` | `streamForFeature`: providers de-duplicated by key, breaker/health keyed by provider **key**, success now resets breaker/health, last real provider error propagated, `buffer` option (no half answer + duplicated fallback), final chunk carries `finishReason`. |
| `server/src/ai/providers.js` | `setFeatures`/`resolveFeatureChain`: a provider can no longer fall back to itself (the production duplicate), dedupe + 5-fallback cap. |
| `server/src/models/GroupAiEvent.js` | New tiny metrics model (`answered/queued/rejected/failed` + reason, 30-day TTL, no message text). |
| `server/src/controllers/adminAiInsightsController.js` | `GET /api/admin/ai/usage` now returns `groupMentions.last24h` (answered / queued / rejected-by-reason / failed) + live queue snapshot (**server API only**; see web wiring below). |
| `server/src/routes/adminAiRoutes.js` | `ai_policy_update` audit now includes the group limit fields. |
| `server/test/integration/groupAiMentions.test.js` | Extended to 39 checks (see §4). |
| `server/test/unit/groupMentions.test.js` | New: 40 pure unit assertions. |

Behaviour now:

- **Aliases**: `@chatgramai`, `@chatgram`, `@chatgram ai`, `@Chatgram AI`,
  `@ChatgramAI`, case-insensitive, with/without space, trailing punctuation;
  emails are not mentions. **Web composer handle to suggest/insert:
  `@Chatgram AI`** (canonical). Accepted aliases: `@chatgramai`, `@chatgram`,
  `@chatgram ai`.
- **Never silent**: every mention gets exactly one visible response in the group
  thread from the Chatgram AI account — the answer, or a polite notice
  ("I can answer again in a few seconds", "…too long, please shorten it (limit
  2000 characters)", "I can't answer that topic", "I'm having trouble reaching
  my AI provider, please try again in a minute", busy/limit variants). Notices
  are **rate limited to 1 per user per minute** (extra notices are suppressed and
  counted).
- **Queue**: mentions in a group are answered one at a time in arrival order,
  with `typing:start`/`typing:stop` for the AI account between call and answer;
  queue length 5, extra mentions get a busy notice. Per-user ~10 replies/hour in
  groups, per-group ~60/hour (admin-editable).
- **Truncation**: `finish_reason: length` + unfinished markdown table/code-fence
  detection; broken trailing fragment dropped; 1200-token limit for groups; long
  answers split into 2–3 messages at paragraph/table-row boundaries with
  `(1/n)` … labels; truncated/overflow answers end with
  "Want more detail? Reply to this message."
- **Context**: only the mention-stripped asking message is sent, plus the quoted
  message when the web reply quote (`> Name: …` prefix) is present; no group
  history. Answers are prefixed with the asker's first name (`@Janvier, …`).
- **Persona/role-play**: system rules always take priority; a long "you are an
  elite assistant" prompt is treated as a style preference — answered briefly,
  never obeyed verbatim, never repeated. Group max input 2000 chars and only
  longer messages get the too-long notice.
- **Beginner-friendly**: system prompt now asks for step-by-step basics + one
  small worked example + compact table + "offer to continue" when the member
  says they know nothing.
- **Provider resilience**: 429/quota/timeout from the primary moves to the next
  configured provider; only when every provider fails does the user see the
  "trouble reaching my AI provider" notice, and an Admin Inbox record of type
  **`group_ai_failure`** is created (+ provider-degraded alert path). Group
  metrics are exposed on the admin usage API.

### Web wiring still needed (web is out of this task's write scope)

1. **Group composer**: when a member types `@`, suggest/insert `@Chatgram AI`
   (canonical). Accepted server aliases: `@chatgramai`, `@chatgram`,
   `@chatgram ai` (case-insensitive, trailing punctuation tolerated).
2. **Admin Chatgram AI usage page** (`apps/web/src/pages/admin/…`): render the new
   `groupMentions` block returned by `GET /api/admin/ai/usage?days=N` —
   `last24h.answered / queued / rejected / failed`, `last24h.rejectedByReason`,
   `queue` (live) and `sinceBoot`.
3. **Admin Inbox page**: add a label for the new Inbox type `group_ai_failure`
   (the row otherwise falls back to the raw type string).
4. Optional: the "Want more detail? Reply to this message" hint relies on the
   existing composer reply quote (`> Name: preview` prefix), which already reaches
   the server — no new web API is needed.

## 3. Production evidence for the fix (read-only, pre-deploy)

- Old regex `@chatgram\s*ai\b` explains the silent `@chatgram` mention.
- Old `MIN_GAP_MS = 20s` explains the Mugisha `@Chatgram AI hello` silence.
- Old `MAX_PER_WINDOW = 3 / 10 min` explains all six later silences.
- Old `maxTokens: 400` + `cleanAnswer().slice(0, 1400)` explains the 589-char
  mid-table truncation at "192.168".
- Old `conversationFor()` sent the last 10 group messages to the provider — the
  07:12:01 answer about the notifications discussion proves it.
- No `AdminInbox`/metric row existed for any group mention; the group failure
  path only did `console.warn` and `return null`.

## 4. Tests run (not the full gate)

Local staging API on `http://127.0.0.1:5001` (separate DB
`chatgram_staging_ai`, started with `scripts/start-staging.ps1 -Port 5001
-Database chatgram_staging_ai`; never production writes). Mock providers: local
OpenAI-compatible HTTP server on `127.0.0.1:5099` (paths `/v1` normal,
`/fail/v1` always 429) configured through the real admin API.

| Command | Result |
|---|---|
| `node server/test/integration/groupAiMentions.test.js` (E2E_API_URL=http://127.0.0.1:5001) | **39 passed, 0 failed** |
| `node server/test/unit/groupMentions.test.js` | **40 passed, 0 failed** |
| `node server/test/ai/streaming.test.js` (isolated DB, regression on the service rewrite) | **8 passed, 0 failed** |
| `node server/test/ai/policy.test.js` (isolated DB, regression on the policy shape) | **8 passed, 0 failed** |

Integration coverage (each mention's reply is read back from the group thread via
the messages API): toggle off = no reply; 4 aliases each answered exactly once
and in order; 3 rapid mentions queued and answered in arrival order; per-user
limit → polite notice (not silence); too-long → notice naming the 100-char limit
and never reaching the provider; 1640-char persona prompt answered, not refused;
long table answer split into 2–3 messages with no table row cut across a
boundary; length-truncated table gets the "Want more detail?" hint; 429 primary
falls back to the secondary provider for a real answer; all providers fail →
polite notice + `group_ai_failure` Admin Inbox row; notices rate limited (second
one suppressed within a minute); only the asking message (+ system prompt) is
sent to the provider; AI account not searchable as a person; admin
`/api/admin/ai/usage` exposes `groupMentions`; toggle off stops replies.

## 5. Eight-line report

1. **Diagnosed silent messages**: 1 × 20 s minimum gap (07:12:17), 1 × mention not
   parsed as `@chatgram` without `ai` (07:13:02), 6 × per-group 3-replies/10-min
   cap (07:16:50 → 07:20:12), 1 × answer truncated mid-table at 589 chars
   (07:16:22) — every one of them caused by a silent `return null` / blind slice
   in `server/src/ai/groupMentions.js`.
2. **Ruled out**: group toggle was ON, blocked-topic list empty, no input cap, no
   provider 429/timeout in the window (provider answered at 07:16:23), no
   group-AI error in PM2 logs and no Admin Inbox record — the provider was not
   the visible cause that day.
3. **Secondary root causes**: only the last 10 group messages were sent as
   context (answers about unrelated chatter), the "fallback" provider was the
   same `ollama-cloud` key, breaker/health were keyed by adapter so one bad
   custom provider could cool down all of them, and no group metrics/Inbox
   record existed.
4. **Fix — mentions**: aliases (`@chatgramai`, `@chatgram`, `@chatgram ai`,
   `@Chatgram AI`, case-insensitive, punctuation tolerated); 2000-char
   admin-editable input cap; names in the answer; only the asking message (+ web
   reply quote) leaves the server.
5. **Fix — never silent**: exactly one visible response per mention (answer or
   polite notice); notices limited to 1/user/minute; FIFO per-group queue of 5
   with typing indicator; per-user 10/h and per-group 60/h admin-editable;
   persona/role-play under system rules; beginner step-by-step/table
   instructions.
6. **Fix — truncation/provider**: 1200-token group output, `finish_reason` +
   unfinished-table/code-fence detection, 2–3 message split at
   paragraph/table-row boundaries, "Want more detail? Reply to this message"
   hint; provider chain de-duplicated by key with real fallbacks and per-key
   breaker, total failure → polite notice + `group_ai_failure` Admin Inbox +
   degraded alert + `/api/admin/ai/usage` group metrics.
7. **What is NOT verified**: nothing was deployed (no production verification, no
   PM2 restart, no staging of the new admin UI); the web composer suggestion,
   the usage-page block and the Inbox label still need their UI wiring (exact
   handle/aliases and API shape above); queue/notice counters are in-process
   memory (fine for the single PM2 process, lost on restart); no quoted-message
   DB relation exists (web embeds the quote as `> Name: …` text); provider
   request logs/`finish_reason` are still not persisted per group mention.
8. **Tests**: integration 39/39, unit 40/40, AI streaming regression 8/8, AI
   policy regression 8/8 on local staging only; DB left clean (policy snapshot
   restored, test users/chats/messages/events/providers removed).

## 6. Honest gaps / follow-ups

- **Not deployed** (per instructions). Production still runs the old code:
  silent rate limits, 400-token group cap, `@chatgram` unparsed, 20 s gap.
  Deploy via `docs/deploy.md` (backend only + DB backup) after review; existing
  production routing must still be edited (primary/fallback both `ollama-cloud`)
  — the service now de-duplicates it defensively, but a real secondary provider
  key would be needed for a true fallback.
- **In-memory queue**: single-process PM2 is fine; a multi-instance API would
  need the queue moved to Redis/Mongo. A restart drops queued mentions
  (previously they were dropped silently too; now they are at least visible when
  enqueued).
- **Notice suppression**: the 1/user/minute notice cap means a second rejection
  within the same minute has no visible response (explicit product trade-off
  required by the task; counted under `rejected.*_notice_suppressed`).
- **Metrics retention**: `GroupAiEvent` rows are kept 30 days (TTL) and contain
  ids/reason codes only, never message text.
- **Quoted replies**: the server understands the existing `> Name: preview`
  composer quote; a real reply-to relation would be a web + model change.
- **Provider errors per group mention** are still only in the process log
  (`Group AI mention failed: <code>`); the Admin Inbox aggregates them into one
  `group_ai_failure` row with a counter, which the dashboard does not label yet.
