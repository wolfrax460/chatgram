<#
  Build and deploy the landing page, the web app (/web/) and the static
  terms/privacy page (/docs/) to Vercel in one go.

  WHY THIS SCRIPT EXISTS
  ----------------------
  A plain `vercel --prod` from client/landing makes Vercel run its own build
  (`vite build`) from the uploaded source. That build wipes `dist/` (Vite uses
  emptyOutDir), which silently deletes the `dist/web` folder we had copied the
  app into — so the landing updated but `/web/` returned 404.

  The reliable way is the Build Output API: assemble `.vercel/output/static`
  ourselves and deploy with `--prebuilt`, so Vercel uploads exactly what we
  built and never re-runs a build.

  Usage (from anywhere):
      powershell -ExecutionPolicy Bypass -File scripts/deploy-web.ps1
#>
param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$landing = Join-Path $repo 'client\landing'
$dist = Join-Path $landing 'dist'
$output = Join-Path $landing '.vercel\output'

$config = @'
{
  "version": 3,
  "routes": [
    { "src": "/api/(.*)", "dest": "https://chatgram.duckdns.org/api/$1" },
    { "src": "/downloads/(.*)", "dest": "https://chatgram.duckdns.org/downloads/$1" },
    { "handle": "filesystem" },
    { "src": "/web(/.*)?", "dest": "/web/index.html" },
    { "src": "/docs(/.*)?", "dest": "/docs/index.html" },
    { "src": "/(.*)", "dest": "/index.html" }
  ],
  "redirects": [
    { "source": "/app", "destination": "/web/", "permanent": false },
    { "source": "/app/(.*)", "destination": "/web/", "permanent": false }
  ],
  "headers": [
    { "source": "/static/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
    { "source": "/web/static/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
    { "source": "/assets/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=3600" }] }
  ]
}
'@

if (-not $SkipBuild) {
  Write-Host '==> building landing page' -ForegroundColor Cyan
  npm run build --prefix client/landing
  if ($LASTEXITCODE -ne 0) { throw 'landing build failed' }

  Write-Host '==> building web app' -ForegroundColor Cyan
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'web build failed' }
}

Write-Host '==> assembling dist/web' -ForegroundColor Cyan
Remove-Item -Recurse -Force (Join-Path $dist 'web') -ErrorAction SilentlyContinue
Copy-Item -Recurse (Join-Path $repo 'apps\web\dist') (Join-Path $dist 'web')

Write-Host '==> assembling .vercel/output (Build Output API)' -ForegroundColor Cyan
Remove-Item -Recurse -Force $output -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path (Join-Path $output 'static') -Force | Out-Null
Copy-Item -Recurse -Path (Join-Path $dist '*') -Destination (Join-Path $output 'static')
# Write without a BOM: Vercel rejects a config.json it cannot parse.
[System.IO.File]::WriteAllText((Join-Path $output 'config.json'), $config, (New-Object System.Text.UTF8Encoding($false)))

# Guard: never deploy without the app and the static docs page.
foreach ($required in @('..\config.json', 'index.html', 'web\index.html', 'docs\index.html')) {
  if (-not (Test-Path (Join-Path $output "static\$required"))) {
    throw "prebuilt output is missing $required - refusing to deploy"
  }
}

Write-Host '==> deploying (prebuilt)' -ForegroundColor Cyan
Set-Location $landing
npx vercel --prod --yes --prebuilt
if ($LASTEXITCODE -ne 0) { throw 'vercel deploy failed' }

Write-Host '==> verifying production' -ForegroundColor Cyan
$base = 'https://chatgram-xi.vercel.app'
$failures = 0
foreach ($path in @('/', '/web/', '/web/admin', '/docs/')) {
  try {
    $r = Invoke-WebRequest -Uri "$base$path" -UseBasicParsing -TimeoutSec 30
    Write-Host ("  {0,-14} {1}" -f $path, $r.StatusCode) -ForegroundColor Green
  } catch {
    Write-Host ("  {0,-14} FAILED {1}" -f $path, $_.Exception.Message) -ForegroundColor Red
    $failures += 1
  }
}
if ($failures -gt 0) { throw "$failures production checks failed" }

# The web app calls `/api/...` on its own origin (required for the SameSite=Strict
# admin cookie and for streaming answers): prove the proxy really forwards to the
# API instead of the SPA fallback returning the HTML shell.
Write-Host '==> verifying the /api proxy' -ForegroundColor Cyan
$health = $null
try {
  $health = Invoke-RestMethod -Uri "$base/api/status/health" -TimeoutSec 30
} catch {
  throw "API proxy GET failed: $($_.Exception.Message)"
}
if (-not $health.ok) { throw "API proxy returned an unhealthy status: $($health | ConvertTo-Json -Compress)" }
Write-Host '  GET  /api/status/health  ok' -ForegroundColor Green

# The desktop auto-updater and the landing downloads read through this route.
try {
  $latest = Invoke-WebRequest -Uri "$base/downloads/latest.yml" -UseBasicParsing -TimeoutSec 60
  if ($latest.StatusCode -ne 200) { throw "latest.yml returned $($latest.StatusCode)" }
} catch {
  throw "downloads proxy failed: $($_.Exception.Message)"
}
Write-Host '  GET  /downloads/latest.yml  ok' -ForegroundColor Green

$postStatus = 0
try {
  Invoke-WebRequest -Uri "$base/api/auth/login" -Method POST -UseBasicParsing -TimeoutSec 30 `
    -ContentType 'application/json' -Body '{"identifier":"deploy-check@chatgram.test","password":"not-a-real-password"}' | Out-Null
} catch {
  $postStatus = [int]$_.Exception.Response.StatusCode
}
if ($postStatus -ne 401) { throw "API proxy POST returned $postStatus (expected 401) - /api is not being proxied" }
Write-Host '  POST /api/auth/login     forwards (401 as expected)' -ForegroundColor Green

Write-Host 'deploy OK' -ForegroundColor Green
