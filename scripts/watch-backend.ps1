Param(
    [Parameter(Mandatory = $true)][string]$BackendRoot,
    [Parameter(Mandatory = $true)][string]$DockerPath,
    [Parameter(Mandatory = $true)][string]$DesktopPath
)

$ErrorActionPreference = "Stop"
Set-Location $BackendRoot
$log = Join-Path $BackendRoot "backend-autostart.log"
try {
    if (-not (Test-Path "$BackendRoot\.env.prod")) { throw "Missing .env.prod" }
    if (-not (Test-Path "$BackendRoot\docker-compose.prod.yml")) { throw "Missing compose file" }
    while ($true) {
        # Desktop needs the same interactive user session as its Docker context.
        if (-not (Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue)) {
            Start-Process -FilePath $DesktopPath
        }
        # Windows PowerShell can turn native stderr into a terminating error.
        # A not-yet-ready daemon is expected while Desktop starts.
        $ErrorActionPreference = "Continue"
        & $DockerPath info --format '{{.ServerVersion}}' *> $null
        $dockerReady = $LASTEXITCODE -eq 0
        $ErrorActionPreference = "Stop"
        if ($dockerReady) {
            # Recover existing images only; never build or pull on boot.
            $ErrorActionPreference = "Continue"
            & $DockerPath compose -f docker-compose.prod.yml --env-file .env.prod up -d --no-build --pull never postgres app nginx *> $null
            $composeExit = $LASTEXITCODE
            $ErrorActionPreference = "Stop"
            if ($composeExit -ne 0) {
                Add-Content $log "$(Get-Date -Format o) Container recovery failed; check compose configuration and existing images."
            }
        }
        Start-Sleep -Seconds 30
    }
} catch {
    Add-Content $log "$(Get-Date -Format o) Backend watchdog failed; check paths and Docker Desktop."
    exit 1
}
