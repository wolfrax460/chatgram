# Test accounts (local staging only)

The automated suites create their own throwaway accounts through the real API and never
touch production. Accounts use unique identifiers such as
`e2e-<label>-<timestamp>@chatgram.test` and are removed by the suites where practical.

If you want manual accounts for clicking around the local stack, create them against the
staging API (never production):

```powershell
$body = @{ displayName = 'Alice Test'; identifier = 'alice@chatgram.test'; password = 'StagingPass1!' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:5000/api/auth/register -ContentType 'application/json' -Body $body
```

Repeat with `bob@chatgram.test`, `carol@chatgram.test`, `dave@chatgram.test` to mirror the
three-user group tests. All of these live in the local `chatgram_staging` database.

Rules:
- These passwords are test-only and local-only. Never reuse them anywhere real.
- Do not create these accounts on production.
- To reset everything: drop the `chatgram_staging` database (see docs/local-staging.md).
