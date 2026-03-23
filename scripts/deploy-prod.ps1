Param(
    [string]$Branch = "main",
    [switch]$SkipPull,
    [string]$ApiBaseUrl = "https://api.hsft.io.kr/api",
    [int]$Port = 4173
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$distPath = Join-Path $projectRoot "dist"
$outLog = Join-Path $projectRoot "mobile-web.out.log"
$errLog = Join-Path $projectRoot "mobile-web.err.log"
$serveCmd = Join-Path $projectRoot "node_modules\.bin\serve.cmd"

Write-Host "==> Mobile web production deploy started" -ForegroundColor Cyan
Write-Host "Project root: $projectRoot"
Write-Host "API base URL: $ApiBaseUrl"
Write-Host "Port: $Port"

Set-Location $projectRoot

if (-not $SkipPull) {
    Write-Host "==> Pulling latest code from origin/$Branch" -ForegroundColor Yellow
    git fetch origin $Branch
    git checkout $Branch
    git pull origin $Branch
}

Write-Host "==> Installing npm dependencies" -ForegroundColor Yellow
npm install

$env:EXPO_PUBLIC_API_BASE_URL = $ApiBaseUrl

Write-Host "==> Building production web bundle" -ForegroundColor Yellow
npm run build:web:prod

if (-not (Test-Path (Join-Path $distPath "index.html"))) {
    throw "Web build was not created. Expected path: $distPath\index.html"
}

Write-Host "==> Stopping existing mobile web process" -ForegroundColor Yellow
Get-CimInstance Win32_Process |
    Where-Object {
        ($_.Name -eq "node.exe" -or $_.Name -eq "cmd.exe") -and
        $_.CommandLine -like "*serve*" -and
        $_.CommandLine -like "*attendance-app*" -and
        $_.CommandLine -like "*mobile*"
    } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force
    }

Start-Sleep -Seconds 2

if (-not (Test-Path $serveCmd)) {
    throw "serve.cmd was not found. Expected path: $serveCmd"
}

if (Test-Path $outLog) { Remove-Item $outLog -Force }
if (Test-Path $errLog) { Remove-Item $errLog -Force }

Write-Host "==> Starting mobile web server" -ForegroundColor Yellow
Start-Process -FilePath $serveCmd `
    -ArgumentList @(
        "-s",
        "dist",
        "-l",
        $Port.ToString()
    ) `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog

Start-Sleep -Seconds 5

$portCheck = netstat -ano | findstr ":$Port"
if ([string]::IsNullOrWhiteSpace($portCheck)) {
    Write-Host "==> Mobile web did not start. Check logs:" -ForegroundColor Red
    Write-Host $outLog
    Write-Host $errLog
    exit 1
}

Write-Host "==> Mobile web production deploy finished" -ForegroundColor Green
Write-Host "URL: http://localhost:$Port"
Write-Host "Output log: $outLog"
Write-Host "Error log: $errLog"
