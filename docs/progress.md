# Migration Progress

Running log. Updated as phases complete.

Last updated: 2026-10-20

---

## Phase 0 — Audit ✅ 5/6

| Task | Status |
|---|---|
| 1. Screen + feature inventory (Section 7) | ✅ `docs/migration-audit.md` §1–2 |
| 2. API contract (REST + Socket.IO) → `docs/api-contract.md` | ✅ 41 REST endpoints, 8 client→server events, 13 server→client events |
| 3. `pubspec.yaml` → React mapping (Section 6) | ✅ `docs/migration-audit.md` §3 |
| 4. Local data / auth storage recorded | ✅ §4 |
| 5. Android applicationId, signing, Windows packaging | ✅ §5 — **three blocking findings** |
| 6. Staging backend running | ❌ **blocked** — see `blockers.md` B1 |

**Exit criteria:** "contract doc complete, feature checklist complete, staging backend running."
→ 5 of 6 done. Staging is an infrastructure decision the owner must make.

---

## Phase 1 — Backend freeze & hardening ⏸ not started

Blocked on: staging (B1) for the exit criterion, and owner decisions on Android identity (B2/B3)
for the `X-Client`/min-version work to be meaningful.

Ready to do immediately once unblocked (all additive, no breaking change):

- [ ] Accept new CORS origins: staging web, `capacitor://localhost`, `https://localhost`,
      Electron origin, `http://localhost:*` in dev
- [ ] Read + log `X-Client` / `X-Client-Version` headers
- [ ] `GET /api/app/min-version` → `{ minVersion, platforms }`
- [ ] Push token endpoints (`POST /api/push/register`, `DELETE /api/push/:token`) + `platform` field
- [ ] Confirm socket handshake CORS for wrapped-app origins

---

## Phase 2 — Web MVP ⏸ not started

Seed exists: `client/webapp/` (React 18 + Vite + Tailwind, ~70% of the feature set).

- [ ] pnpm monorepo scaffold (`apps/web`, `apps/desktop`, `apps/mobile`, `packages/*`)
- [ ] `packages/api-client` — typed REST client, refresh, error handling
- [ ] `packages/realtime` — socket wrapper, reconnect (20 tries, 1s→5s), re-auth on reconnect
- [ ] `packages/core` — models, Zod schemas, stores
- [ ] `packages/ui` — design tokens + components
- [ ] `apps/web` shell, routing, theme tokens
- [ ] Auth slice
- [ ] Socket slice
- [ ] Chat list slice
- [ ] Chat screen slice (virtualized message list)
- [ ] Profile + settings slice

---

## Phase 3 — Feature parity ⏸ not started

Section 7 checklist: **0 / 15** ticked for React. See `migration-audit.md` §2 for the table.

Priority order per plan §8: groups → presence → status → media/voice → notifications → settings/privacy.
Plus: push notifications (greenfield) and deep links.

---

## Phase 4 — Windows (Electron) ⏸ not started

## Phase 5 — Android (Capacitor) ⏸ not started — **blocked on app id + keystore**

---

## Blockers

See `blockers.md`. Three need the owner: staging environment, Android applicationId,
release keystore.
