Param(
    [string]$Branch = "main",
    [switch]$SkipPull,
    [string]$ApiBaseUrl = "https://api.hsft.io.kr/api",
    [ValidateRange(1, 65535)][int]$Port = 4173
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

if (-not $SkipPull) {
    git fetch origin $Branch
    if ($LASTEXITCODE -ne 0) { throw "Git fetch failed." }
    git checkout $Branch
    if ($LASTEXITCODE -ne 0) { throw "Git checkout failed." }
    git pull --ff-only origin $Branch
    if ($LASTEXITCODE -ne 0) { throw "Git pull failed." }
}

npm.cmd install
if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }
$env:EXPO_PUBLIC_API_BASE_URL = $ApiBaseUrl
npm.cmd run build:web:prod
if ($LASTEXITCODE -ne 0) { throw "Web build failed." }
if (-not (Test-Path "$projectRoot\dist\index.html")) { throw "Production dist/index.html is missing." }

& "$PSScriptRoot\start-prod-server.ps1" -Port $Port
Write-Host "Mobile web deployment completed."
