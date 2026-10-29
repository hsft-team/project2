Param(
    [string]$NodePath = "",
    [ValidateRange(1, 65535)][int]$Port = 4173
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

try {
    if (-not $NodePath) { $NodePath = (Get-Command node.exe -ErrorAction Stop).Source }
    $serveEntry = Join-Path $projectRoot "node_modules\serve\build\main.js"
    if (-not (Test-Path $serveEntry)) { throw "Run npm.cmd install first." }
    if (-not (Test-Path "$projectRoot\dist\index.html")) { throw "Production dist/index.html is missing. Deploy first." }

    & $NodePath $serveEntry -s "$projectRoot\dist" -l "tcp://0.0.0.0:$Port" --no-port-switching `
        1>> "$projectRoot\mobile-web.out.log" 2>> "$projectRoot\mobile-web.err.log"
    # Any unexpected exit must trigger Task Scheduler's recovery policy.
    exit 1
} catch {
    Add-Content -Path "$projectRoot\mobile-web.err.log" -Value "$(Get-Date -Format o) $_"
    exit 1
}
