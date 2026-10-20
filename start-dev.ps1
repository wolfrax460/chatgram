<#
.SYNOPSIS
    Starts everything Chatgram needs for local development.

.DESCRIPTION
    Run this every time you turn your computer on. It:

      1. makes sure MongoDB is running (starting it if needed, no admin required),
      2. installs backend dependencies the first time,
      3. loads demo data only when the database is empty,
      4. starts the API, which also serves the web app.

    Leave the window open while you use Chatgram. Ctrl+C stops the server.

.PARAMETER Seed
    Load the demo users/chats (alice@chatgram.dev, bob@, carol@). Off by default
    so a fresh install is not silently populated with demo accounts.

.PARAMETER Reseed
    Wipe the demo users and reload them. Your own accounts are left alone.

.PARAMETER Open
    Open the app in your browser once the server is up.

.PARAMETER Web
    Also launch a Flutter dev session (hot reload) in Chrome.

.EXAMPLE
    .\start-dev.ps1

.EXAMPLE
    .\start-dev.ps1 -Open
#>
[CmdletBinding()]
param(
    [switch]$Seed,
    [switch]$Reseed,
    [switch]$SkipSeed,
    [switch]$Open,
    [switch]$Web
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$serverDir = Join-Path $root 'server'
$clientDir = Join-Path $root 'client'
$mongoExe = 'C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe'
$mongoCfg = 'C:\Program Files\MongoDB\Server\8.3\bin\mongod.cfg'

function Test-MongoUp {
    try {
        return (Test-NetConnection -ComputerName 127.0.0.1 -Port 27017 -WarningAction SilentlyContinue).TcpTestSucceeded
    } catch {
        return $false
    }
}

function Start-Mongo {
    if (Test-MongoUp) {
        Write-Host '[1/4] MongoDB is already listening on 27017.' -ForegroundColor Green
        return
    }

    Write-Host '[1/4] MongoDB is not running - starting it...' -ForegroundColor Yellow

    # 1. Preferred: the Windows service. Needs an elevated shell.
    try {
        Start-Service MongoDB -ErrorAction Stop
        Start-Sleep -Seconds 3
        if (Test-MongoUp) {
            Write-Host '      Started the MongoDB service.' -ForegroundColor Green
            return
        }
    } catch {
        Write-Host '      Service not startable without admin - launching mongod directly.' -ForegroundColor DarkYellow
    }

    # 2. Fallback: run mongod as a normal process. No admin needed and it
    #    keeps running after this script closes.
    if (-not (Test-Path $mongoExe)) {
        throw "mongod.exe not found at $mongoExe. Install MongoDB, or point MONGODB_URI in server/.env at another server."
    }

    # Capture mongod's output so a failure is diagnosable instead of a window
    # that flashes and disappears.
    $mongoLog = Join-Path $root 'mongo-startup.log'
    Write-Host "      Launching mongod (log: $mongoLog)"

    $started = Start-Process -FilePath $mongoExe `
        -ArgumentList '--config', "`"$mongoCfg`"" `
        -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $mongoLog `
        -RedirectStandardError "$mongoLog.err" `
        -ErrorAction SilentlyContinue

    if (-not $started) {
        # Some hosts refuse redirection; retry without it.
        Start-Process -FilePath $mongoExe -ArgumentList '--config', "`"$mongoCfg`"" -WindowStyle Minimized
    }

    for ($i = 0; $i -lt 24; $i++) {
        Start-Sleep -Milliseconds 750
        if (Test-MongoUp) {
            Write-Host '      mongod is up.' -ForegroundColor Green
            return
        }
    }

    throw 'mongod did not start listening on 27017. Check C:\data\log\mongod.log'
}

Push-Location $root
try {
    Start-Mongo

    if (-not (Test-Path (Join-Path $serverDir 'node_modules'))) {
        Write-Host '[2/4] Installing backend dependencies (npm install)...' -ForegroundColor Yellow
        Push-Location $serverDir
        npm install
        Pop-Location
    } else {
        Write-Host '[2/4] Backend dependencies present.' -ForegroundColor Green
    }

    if ($Reseed) {
        Write-Host '[3/4] Reloading demo data (npm run reseed)...' -ForegroundColor Yellow
        Push-Location $serverDir
        npm run reseed
        Pop-Location
    } elseif ($Seed) {
        Write-Host '[3/4] Loading demo data (npm run seed)...' -ForegroundColor Yellow
        Push-Location $serverDir
        npm run seed
        Pop-Location
    } else {
        # Deliberately does nothing: your accounts are yours, and a fresh
        # install should stay empty until people register.
        Write-Host '[3/4] Leaving the database as it is.' -ForegroundColor DarkGray
        Write-Host '      (add -Seed to load the demo users, or -Reseed to reset them)' -ForegroundColor DarkGray
    }

    Write-Host '[4/4] Starting the Chatgram API...' -ForegroundColor Yellow
    Write-Host ''

    $webBuild = Join-Path $clientDir 'build\web\index.html'
    if (Test-Path $webBuild) {
        Write-Host '  In your browser : http://localhost:5001' -ForegroundColor Cyan
        Write-Host '  Share with a friend: the "Share this" address printed below' -ForegroundColor Cyan
        Write-Host '                       (both devices must be on the same Wi-Fi)' -ForegroundColor Cyan
    } else {
        Write-Host '  API only - no web build yet. Create one with:' -ForegroundColor Yellow
        Write-Host '    cd client; flutter build web --release' -ForegroundColor Gray
    }
    Write-Host ''
    Write-Host '  Health check  : http://localhost:5001/api/health' -ForegroundColor DarkGray
    Write-Host ''
    Write-Host '  To build/hot-reload the app, open a SECOND terminal:' -ForegroundColor Cyan
    Write-Host '    cd client' -ForegroundColor Gray
    Write-Host '    flutter run -d chrome        # browser' -ForegroundColor Gray
    Write-Host '    flutter run -d windows       # desktop' -ForegroundColor Gray
    Write-Host '    flutter run -d <device-id>   # android (flutter devices)' -ForegroundColor Gray
    Write-Host ''
    Write-Host '  Or just use the built apps in dist\ :' -ForegroundColor Cyan
    Write-Host '    dist\chatgram-windows\chatgram.exe' -ForegroundColor Gray
    Write-Host '    dist\chatgram.apk   (install on your phone)' -ForegroundColor Gray
    Write-Host ''
    Write-Host '  Leave this window open. Press Ctrl+C to stop.' -ForegroundColor DarkGray
    Write-Host ''

    if ($Open -and (Test-Path $webBuild)) {
        Start-Process 'http://localhost:5001'
    }

    if ($Web) {
        Start-Process powershell -ArgumentList '-NoExit', '-Command',
            "Set-Location '$clientDir'; flutter run -d chrome"
    }

    # Port already taken? Almost certainly a server from a previous run.
    $inUse = (Test-NetConnection -ComputerName 127.0.0.1 -Port 5001 -WarningAction SilentlyContinue).TcpTestSucceeded
    if ($inUse) {
        Write-Host '  A server is ALREADY running on port 5001.' -ForegroundColor Yellow
        Write-Host '  Chatgram is ready to use right now - nothing more to do.' -ForegroundColor Green
        Write-Host ''
        Write-Host '  (If that is a stale window you cannot find, close it or run:'
        Write-Host '     Get-NetTCPConnection -LocalPort 5001 -State Listen |' -ForegroundColor DarkGray
        Write-Host '       ForEach-Object { Stop-Process -Id $_.OwningProcess -Force } )' -ForegroundColor DarkGray
        Write-Host ''
        return
    }

    Push-Location $serverDir
    npm start
    Pop-Location
}
finally {
    Pop-Location
}
