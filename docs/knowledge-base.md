# Chatgram knowledge base (from the admin Inbox)

Purpose: every report that reaches the admin Inbox is triaged here — what it was, what caused it,
what shipped, and what is still backlog. New reports arrive as `error_report` rows with an AI
debugging prompt, create one GitHub issue and ping Telegram (`/inbox`, `/prompt <id>`, `/issue <id>`).
Automation is documented in `docs/automation.md`; this file is the human-readable record of resolutions.

## Inbox snapshot processed on 2026-10-29 (38 rows total)

| Type | Count | Outcome |
|---|---|---|
| `error_report` | 1 | Resolved — root cause was the AI model id (see below) |
| `ai_provider_failure` | 1 | **Resolved** — NVIDIA provider returned HTTP 404 because `SUPPORT_AI_MODEL` was `openai/gpt-oss-20b` |
| `call_quality` (media stalled) | 5 | Resolved — one-way media / screen-share rendering fixes shipped |
| `feature_request` | 14 | 10 shipped, 2 partially shipped, 2 backlog |
| `unknown_question` / `chatgram_unknown` | 7 | Answered (see Q&A below) |
| `support_request` | 4 | Acknowledged (contributor interest) |

## Root causes found and fixed this cycle

1. **AI provider 404 (`ai_provider_failure`, NVIDIA).** `SUPPORT_AI_MODEL` was set to
   `openai/gpt-oss-20b` while the provider was `nvidia`, so every Help request hit a non-existent
   model and failed. The live catalogue was listed and the model corrected to
   **`nvidia/nemotron-3-super-120b-a12b`** (`NVIDIA_MODEL` too); API restarted, health 200.
   Lesson: provider and model id must always change together; a mismatch surfaces as a 404, which
   `failureInbox` records content-free in the admin Inbox.
2. **Calls with no audio and no video.** Two distinct faults, both fixed:
   - the answerer pre-created its transceivers before `setRemoteDescription`, so Chrome answered
     `recvonly` and the caller received nothing (`in 0 B / out 156 kB`, `0 remote tracks`). The answer
     path now applies the offer first and attaches tracks to the offer's transceivers; proven
     bidirectionally in a two-`RTCPeerConnection` harness.
   - audio-only calls had **no remote audio sink** (every sink came from a remote `<video>`); a
     hidden `<audio>` is now mounted exactly when the video element is absent.
   The in-call banner now reports the real numbers (`CONNECTED · srflx→relay · in/out bytes · remote
   tracks`) and distinguishes "they are not sending media to you" from "nothing is arriving"; Retry
   performs a full renegotiation.
3. **Screen sharing invisible when the camera was off.** `RemoteTile.showVideo` required
   `cameraOn !== false`, so a sharer with the camera off had their screen track dropped by the UI.
   Shares are now rendered regardless of camera flags; the sharer sees their own screen on the main
   stage and the remote sharer owns the stage on the receiving side.
4. **Messages disappearing and a stuck unread badge.** The 1-day access token expired while the
   socket stayed connected but unauthenticated, so `message:send` was rejected and the optimistic
   bubble (clock icon) vanished on refetch. The realtime layer now re-authenticates after a REST
   refresh, falls back to REST send, and patches the `['chats']` cache after mark-read.
5. **Verification codes "expiring" instantly.** The TTL was fine; every *resend* rotated the stored
   code and kept a single previous generation, so a slow email delivered a dead code. All live codes
   are now kept (up to 5), the TTL is configurable (`VERIFICATION_CODE_TTL_MINUTES`, production 20
   min), and codes are normalised (`trim` + `padStart(6,'0')`) so a leading zero survives a numeric
   submission.

## Feature requests: shipped / partial / backlog

**Shipped (verified live):** screen sharing with a "You are sharing your screen" bar · camera-off
privacy (stop sending video, avatar on the other side, per-peer incoming-video toggle) · private AI
answers in groups with an asker/Everyone setting · WhatsApp-style layout and grouped Settings ·
in-app user guides (landing guides) · group call UI with call cards, Join and clear
failed/declined/ended wording · message delivery ticks · `@chatgramai` aliases (`@chatgram ai`,
`@chatgram`) · wallpaper, voice notes, reply cards, notification settings, remote control with
consent, screen-share quality, protected account deletion.

**Partial:** disappearing messages (per-chat setting exists and is enforced server-side; **no global
default row** in Settings) · "what's new" (links to `/docs/`, no changelog API).

**Backlog (not built — do not claim otherwise):** smart reply suggestions (needs an opt-in provider
call on the last 5 messages) · auto-reply / away message (needs a schedule + audience model and a
once-per-24h-per-sender guard).

## Q&A captured from the Inbox (answers now in the product)

- **"Is the mobile app updated?"** Android is at **1.1.7** (versionCode 8) and self-updates in-app;
  Windows is at **1.1.5** with the packaged updater; both check the release feed and install on quit
  or on "Restart to install".
- **"How many users does Chatgram have?"** Not exposed by any public API; count from the admin
  dashboard only.
- **"When was it first published?"** See `docs/progress.md` (first public landing + 1.0.0 APK) and
  the release history in the admin dashboard.
- **"What's new in the latest version?"** `docs/progress.md` is the running changelog; the landing
  `/docs/` page and the release feed carry the same notes.
- **"How do I enable @chatgramai in all my chats?"** Add the Chatgram AI account to a group (this
  automatically enables group AI mentions); in a 1:1 the AI chat row is always available. Global
  mentions without adding the account are not supported.
- **Contributor interest:** acknowledged; no contributor programme exists yet.

## How to keep this current

1. New report → Inbox + GitHub issue + Telegram ping (automatic).
2. Triage: label `needs-human` for product/legal/auth calls; `autofix-candidate` lets the draft-PR bot
   propose a fix (never merges).
3. When something ships, add its root cause + fix to this file and mark the Inbox row answered, so the
   next report of the same class is diagnosable in minutes.
