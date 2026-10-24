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
$config | Set-Content -Path (Join-Path $output 'config.json') -Encoding utf8

# Guard: never deploy without the app and the static docs page.
foreach ($required in @('index.html', 'web\index.html', 'docs\index.html')) {
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
Write-Host 'deploy OK' -ForegroundColor Green
