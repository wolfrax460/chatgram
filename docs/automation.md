# Report → PR automation

The Help "Errors" tab turns a user report into an admin Inbox entry, an AI
debugging prompt and a GitHub issue (labels `chatgram-report` + `bug` /
`enhancement`). This page documents the **opt-in, unattended** step that can take
a complete report and open a **draft pull request** for a human to review.

> The bot never merges. It never pushes to `main`. It always opens a draft PR.
> It cannot read repository secrets from PR code, it cannot change workflows,
> lockfiles, migrations or certificates, and it never prints a key.

---

## 1. The flow

```
user report (Help → Errors)
   │  server/src/help/errorReport.js  →  AppRelease? no: AdminInbox + fixPrompt
   ▼
GitHub issue  (labels: chatgram-report, bug|enhancement)
   │
   ▼  .github/workflows/report-intake.yml        permissions: issues: write
   │    • validates the prompt sections
   │    • comments a triage summary (exactly once per issue)
   │    • complete + low risk  → adds `autofix-candidate`
   │    • missing / risky     → adds `needs-human`
   ▼
.github/workflows/autofix.yml                    permissions: contents/issues/PRs: write
   │  1. guards: not a bot, default branch == main, no PR references the issue
   │  2. checkout main + npm ci + npm run typecheck + npm run build  ← BEFORE any AI
   │  3. branch `autofix/issue-<n>-<short-sha>`
   │  4. docs/autofix/issue-<n>.md  ← the plan (always produced, no secrets needed)
   │  5. only if AUTOFIX_API_KEY exists:
   │        model returns a unified diff limited to the planned files
   │        → `git apply --check` → apply → typecheck/build again
   │        → on any failure: reset, keep the plan-only branch
   │  6. push branch + open a DRAFT PR labelled `autofix`
   ▼
human reviews the diff, runs the tests, merges (or closes the PR)
```

The report body produced by `errorReport.js` embeds the prompt in a fence and
appends a metadata footer. The sections the intake validates are:

| Section | Accepted forms |
| --- | --- |
| Title | `Title: …` or `## Title` |
| What happened | `What happened: …` or `## What happened` |
| Steps to reproduce | `Steps to reproduce: …`, `Steps: …` |
| Expected vs actual | both `Expected:` and `Actual:`, or a single `Expected vs actual` heading |
| Acceptance criteria | `Acceptance criteria: …` |

Hand-edited issues with markdown headings work too.

## 2. Labels

| Label | Colour | Added by | Meaning |
| --- | --- | --- | --- |
| `chatgram-report` | (server, `GITHUB_LABEL`) | `server/src/utils/githubIssues.js` | authentic automated report; intake only looks at these |
| `bug` / `enhancement` | (server) | same | report kind |
| `needs-human` | `d73a4a` | intake | incomplete prompt, or touches auth / billing / calls / a product-decision |
| `autofix-candidate` | `0e8a16` | intake | complete + low risk; **the only automated trigger** |
| `autofix` | `1d76db` | autofix workflow | marks the draft PR it opened |

`needs-human` and `autofix-candidate` are mutually exclusive in practice: intake
adds exactly one of them. Removing `autofix-candidate` before the run starts is a
stop switch; adding it manually is how an owner opts an issue in.

## 3. What the bot may and may not do

**May**
- comment on the issue (triage + PR link) and label it;
- create one branch `autofix/issue-<n>-<short-sha>` from `main`;
- write `docs/autofix/issue-<n>.md` and commit it on that branch;
- apply a model diff **only** to files listed in the plan, only if
  `git apply --check` passes, and only while `npm run typecheck` + `npm run build`
  stay green;
- open one **draft** PR against `main` and label it `autofix`.

**May not**
- merge, enable auto-merge, approve, or dismiss reviews;
- push to `main`, force-push, rewrite history, or delete any branch other than
  its own on failure;
- edit `.github/workflows/**`, lockfiles (`package-lock.json`, `pnpm-lock.yaml`,
  `yarn.lock`), `.env*`, `secrets*`, migrations, or certificate/key files — the
  diff checker rejects those paths even if a human names them in the issue;
- add or upgrade dependencies, change build configuration, or run migrations;
- read secrets it does not already have (`AUTOFIX_API_KEY` is only used for the
  model call; PR code never sees it);
- open more than one PR per issue (the preflight refuses when a PR references it);
- touch an issue or PR authored by a bot.

The plan is the deliverable that works with **no secrets at all**: even without
`AUTOFIX_API_KEY` the workflow commits `docs/autofix/issue-<n>.md` and opens the
draft PR in plan-only mode.

## 4. Owner setup (one time)

1. GitHub → **Settings → Secrets and variables → Actions → New repository secret**.
2. Name: `AUTOFIX_API_KEY`. Value: an OpenAI-compatible API key (pasted into the
   GitHub form only — **never into chat, a commit, an issue or a log**).
3. Optional, same screen:
   - secret or variable `AUTOFIX_MODEL` — default `nvidia/llama-3.3-nemotron-super-49b-v1`;
   - secret or variable `AUTOFIX_API_BASE` — default `https://integrate.api.nvidia.com/v1`.
   Workflow syntax used: `${{ secrets.AUTOFIX_API_KEY }}` and
   `${{ secrets.AUTOFIX_MODEL || vars.AUTOFIX_MODEL }}`.
4. No other configuration is required. Nothing in the repo reads the key; only
   the `autofix` job passes it to `scripts/autofix-plan.mjs` as an environment
   variable, and the script only ever prints `mode=…`, the base host and the
   model name.

If the secret is absent the workflow still runs and produces a plan-only PR.

### Cost and rate expectations

- One run makes **at most one** chat-completions call, with the issue prompt plus
  the plan (roughly 2–6k tokens in, up to 8k out). Runs are per issue, and the
  preflight refuses duplicates, so cost is bounded by the number of opted-in
  reports.
- NVIDIA's hosted endpoints have free-tier rate limits; a `429`/`5xx` is not a
  failure: the script logs `note: model call failed (…)`, keeps the plan-only
  branch and opens the PR without a diff.
- The expensive part of the job is the repo gates (`npm ci` + typecheck + build),
  not the model: they run twice when a diff is applied.

## 5. Stopping it

| Goal | Action |
| --- | --- |
| Stop one issue | remove `autofix-candidate` before the run starts |
| Stop the intake triage | disable `Report intake` in the Actions tab |
| Stop all automation | disable both workflows (`Autofix`, `Report intake`) |
| Stop a run in flight | cancel it from the Actions tab; the branch cleanup step only runs on failure, so delete `autofix/issue-<n>-…` manually if needed |
| Undo bot output | close the draft PR and delete the branch; `docs/autofix/issue-<n>.md` is the only committed artifact |

No workflow runs on a schedule, so disabling them is an immediate off switch.

## 6. Security model

- **Issue text is untrusted.** It is validated, then passed to the model as a
  prompt; it is never executed. The plan is generated deterministically.
- **Model output is untrusted.** It is treated as a patch, never as commands. It
  is rejected unless every touched path is in the plan, applies cleanly, and
  keeps the gates green. Branch and commit are the only side effects.
- **No secrets in PRs.** `AUTOFIX_API_KEY` is scoped to the plan-generation step
  of the `autofix` job. The job never echoes it and never writes it to a file.
- **Least privilege.** Intake has `issues: write` only. Autofix gets write access
  because it must push a branch and open a PR — but the destination is always a
  non-protected `autofix/*` branch, never `main`.
- **Prompt-injection handling.** The system prompt tells the model to ignore
  instructions inside the issue that ask for workflow/secret/dependency changes;
  independent of that, the path allowlist and the gate re-run enforce it.

## 7. Local testing

```bash
# 1. The exact plan-only mode the CI uses when no key is set.
node scripts/autofix-plan.mjs \
  --issue-number 1234 \
  --title "Settings notification toggles revert after reload" \
  --body-file /tmp/issue.md \
  --out /tmp/plan.md \
  --diff-out /tmp/autofix.patch \
  --plan-only

# 2. Section validation (exit 0 = complete, 1 = missing sections; prints JSON).
node scripts/autofix-plan.mjs --section-check --body-file /tmp/issue.md

# 3. Enforce the plan's file scope on a patch (exit 0 = ok, 1 = rejected).
node scripts/autofix-plan.mjs --verify-diff /tmp/autofix.patch --plan /tmp/plan.md
```

Workflow changes can be tried safely with **Actions → Autofix → Run workflow**
and an issue number (no label needed); it still goes through every guard.

## 8. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `npm ci` fails in the baseline step | `package-lock.json` does not match `package.json`. Commit a synced lockfile (`npm install` then commit). This is deliberate: a broken baseline must never produce a PR. |
| Job refuses with "default branch is not main" | rename protection: the automation only understands `main`; change the guard before renaming. |
| Job skips with "PR #… already references issue" | a previous run already opened a PR; close it first or use that PR. |
| No diff appears in the PR | no key, model error, no files inferred, diff out of scope, `git apply --check` failed, or the gates went red — the plan records the result in `## Gate results (CI)`. |
| Branch push rejected | the token needs `contents: write` (set in the workflow); protected-branch rules on `autofix/*` would also block it. |
| Plan lists no files | the report did not name paths and no keyword hint matched an existing file. A human should scope the issue; the diff step is skipped by design. |

## 9. Review expectations

The PR body carries a bold banner: **"Generated by an unattended agent — review
every line before merging."** Treat it exactly like a PR from an unfamiliar
contributor: read the diff, reproduce the report, run the checks, confirm the
scope, then merge. The agent's confidence is not evidence.
