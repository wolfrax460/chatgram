<#
  Start the LOCAL STAGING stack API (never production).

  - MongoDB: the local MongoDB service on 127.0.0.1:27017, database
    `chatgram_staging` (separate from any real data).
  - All secrets are local test values generated below. Real .env values are
    overridden, so this can never touch Atlas, Cloudinary, Telegram or SMTP.
  - Uploads go to server/uploads (local disk), which the integration tests also
    inspect.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts/start-staging.ps1
    powershell -ExecutionPolicy Bypass -File scripts/start-staging.ps1 -Port 5001
#>
param(
  [int]$Port = 5000,
  [string]$Database = 'chatgram_staging'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $repo 'server')

$env:NODE_ENV = 'development'
$env:PORT = "$Port"
$env:MONGODB_URI = "mongodb://127.0.0.1:27017/$Database"
$env:JWT_SECRET = 'local-staging-jwt-secret-0123456789abcdef'
$env:JWT_REFRESH_SECRET = 'local-staging-refresh-secret-0123456789abcdef'
$env:CLIENT_URL = 'http://localhost:5174'
$env:EMAIL_PROVIDER = 'console'
$env:EMAIL_ENABLED = 'false'
$env:SMS_PROVIDER = 'console'
$env:SMTP_USER = ''
$env:SMTP_PASS = ''
$env:TELEGRAM_BOT_TOKEN = ''
$env:TELEGRAM_CHAT_ID = ''
$env:TELEGRAM_WEBHOOK_SECRET = ''
$env:WHATSAPP_TOKEN = ''
$env:WHATSAPP_PHONE_ID = ''
$env:CLOUDINARY_CLOUD_NAME = ''
$env:CLOUDINARY_API_KEY = ''
$env:CLOUDINARY_API_SECRET = ''
$env:GOOGLE_CLIENT_ID = ''
$env:GOOGLE_CLIENT_SECRET = ''
$env:TURNSTILE_SECRET = ''
$env:REQUIRE_VERIFICATION = 'false'
$env:DEV_SHOW_CODES = 'true'
$env:SUPPORT_AI_ENABLED = 'false'
$env:SUPPORT_AGENT_ENABLED = 'false'
$env:AUTH_REVEAL_ACCOUNT_EXISTS = 'true'
# The Playwright suite creates a fresh account per test. This escape hatch is
# ignored in production (see middleware/authLimiter.js).
$env:AUTH_RATE_LIMIT_DISABLED = 'true'
$env:UPLOAD_DIR = (Join-Path (Get-Location) 'uploads')
$env:BASE_URL = "http://127.0.0.1:$Port"

Write-Host "Local staging API: http://127.0.0.1:$Port  (db: $Database)" -ForegroundColor Cyan
Write-Host 'Staging only. Real .env providers are overridden and disabled.' -ForegroundColor DarkGray
node src/server.js
