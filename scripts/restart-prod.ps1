Param(
    [string]$ApiBaseUrl = "https://api.hsft.io.kr/api",
    [ValidateRange(1, 65535)][int]$Port = 4173
)

$ErrorActionPreference = "Stop"
& "$PSScriptRoot\deploy-prod.ps1" -SkipPull -ApiBaseUrl $ApiBaseUrl -Port $Port
