Param(
    [string]$BackendRoot = "C:\attendance-app\backend",
    [string]$AdminRoot = "C:\attendance-app\admin-web",
    [string]$DesktopPath = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
)

$ErrorActionPreference = "Stop"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run PowerShell as Administrator using the Windows account that normally runs Docker Desktop."
}
$javaPath = (Get-Command java.exe -ErrorAction Stop).Source
$dockerPath = (Get-Command docker.exe -ErrorAction Stop).Source
foreach ($path in @($DesktopPath, "$BackendRoot\.env.prod", "$BackendRoot\docker-compose.prod.yml", "$AdminRoot\target\admin-web-0.0.1-SNAPSHOT.jar")) {
    if (-not (Test-Path $path)) { throw "Required file missing: $path" }
}
if ($BackendRoot.Contains('"') -or $AdminRoot.Contains('"')) { throw "Paths cannot contain quotation marks." }

$powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$adminRunner = Join-Path $PSScriptRoot "run-admin-server.ps1"
$adminArgs = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$adminRunner`" -AdminRoot `"$AdminRoot`" -JavaPath `"$javaPath`" -BackendRoot `"$BackendRoot`""
$adminAction = New-ScheduledTaskAction -Execute $powershell -Argument $adminArgs -WorkingDirectory $AdminRoot
$adminPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

# Refuse a foreign listener rather than terminate an unrelated Java process.
$listeners = @(Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue)
foreach ($listener in $listeners) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
    if ($process.CommandLine -notlike "*$AdminRoot*admin-web-0.0.1-SNAPSHOT.jar*") {
        throw "Port 8081 belongs to another application. Resolve it before installation."
    }
}
if (Get-ScheduledTask -TaskName "Attendance-Admin-Web" -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName "Attendance-Admin-Web"
    Start-Sleep -Seconds 2
}
Get-CimInstance Win32_Process -Filter "Name = 'java.exe'" |
    Where-Object { $_.CommandLine -like "*$AdminRoot*admin-web-0.0.1-SNAPSHOT.jar*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Register-ScheduledTask -TaskName "Attendance-Admin-Web" -Action $adminAction -Trigger (New-ScheduledTaskTrigger -AtStartup) -Settings $settings -Principal $adminPrincipal -Force | Out-Null

$backendRunner = Join-Path $PSScriptRoot "watch-backend.ps1"
$backendArgs = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$backendRunner`" -BackendRoot `"$BackendRoot`" -DockerPath `"$dockerPath`" -DesktopPath `"$DesktopPath`""
$backendAction = New-ScheduledTaskAction -Execute $powershell -Argument $backendArgs -WorkingDirectory $BackendRoot
$backendPrincipal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Highest
if (Get-ScheduledTask -TaskName "Attendance-Backend-Recovery" -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName "Attendance-Backend-Recovery"
}
Register-ScheduledTask -TaskName "Attendance-Backend-Recovery" -Action $backendAction -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $identity.Name) -Settings $settings -Principal $backendPrincipal -Force | Out-Null
Start-ScheduledTask -TaskName "Attendance-Admin-Web"
Start-ScheduledTask -TaskName "Attendance-Backend-Recovery"
Write-Host "Admin installed: starts at boot as SYSTEM."
Write-Host "Backend installed: Docker Desktop and containers recover after Windows login as $($identity.Name)."
Write-Warning "Docker Desktop recovery requires Windows login. This does not enable automatic Windows login."
