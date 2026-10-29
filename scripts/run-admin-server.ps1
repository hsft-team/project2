Param(
    [Parameter(Mandatory = $true)][string]$AdminRoot,
    [Parameter(Mandatory = $true)][string]$JavaPath,
    [Parameter(Mandatory = $true)][string]$BackendRoot
)

$ErrorActionPreference = "Stop"
Set-Location $AdminRoot
try {
    $jar = Join-Path $AdminRoot "target\admin-web-0.0.1-SNAPSHOT.jar"
    if (-not (Test-Path $jar)) { throw "Admin jar is missing. Build admin-web first." }
    # Match the backend's shared key without putting secrets in task arguments.
    $envFile = Join-Path $BackendRoot ".env.prod"
    if (Test-Path $envFile) {
        foreach ($line in Get-Content $envFile) {
            if ($line -match '^\s*INTERNAL_API_KEY\s*=\s*(.*)$') {
                $value = $Matches[1].Trim()
                if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
                    $value = $value.Substring(1, $value.Length - 2)
                }
                if ($value) { $env:INTERNAL_API_KEY = $value }
            }
        }
    }
    & $JavaPath -jar $jar --spring.profiles.active=prod --server.port=8081 `
        1>> "$AdminRoot\admin-web.out.log" 2>> "$AdminRoot\admin-web.err.log"
    exit 1
} catch {
    Add-Content "$AdminRoot\admin-web.err.log" "$(Get-Date -Format o) Admin startup failed; check jar, Java and configuration."
    exit 1
}
