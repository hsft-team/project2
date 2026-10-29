Param(
    [ValidateRange(1, 65535)][int]$Port = 4173
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$taskName = "Attendance-Mobile-Web"
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    if ($task.Actions.Arguments -notlike "*-Port $Port") {
        throw "Task port differs. Run install-autostart.ps1 -Port $Port again as Administrator."
    }
    Stop-ScheduledTask -TaskName $taskName
    Start-Sleep -Seconds 2
}

# Stop only this project's serve process, never other Node applications.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like "*$projectRoot*" -and $_.CommandLine -match '[\\/]serve[\\/]build[\\/]main.js' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $Port is in use. Stop the existing manual server (Ctrl+C), then retry."
}

if ($task) {
    Start-ScheduledTask -TaskName $taskName
} else {
    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    $runner = Join-Path $PSScriptRoot "run-prod-server.ps1"
    Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`" -NodePath `"$nodePath`" -Port $Port" -WorkingDirectory $projectRoot -WindowStyle Hidden
    Write-Warning "Automatic boot recovery is not installed. Run install-autostart.ps1 as Administrator."
}

for ($attempt = 0; $attempt -lt 15; $attempt++) {
    Start-Sleep -Seconds 1
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            Write-Host "Mobile web ready: http://localhost:$Port"
            return
        }
    } catch { }
}
throw "Mobile web did not respond. Check mobile-web.err.log and Task Scheduler."
