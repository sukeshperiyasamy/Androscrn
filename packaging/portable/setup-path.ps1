<#
.SYNOPSIS
    Adds the AndroScrn portable folder to the current User's PATH.
.DESCRIPTION
    This script is user-scoped and does not require administrator privileges.
    It checks for duplicate entries and validates the target directory path.
#>
param(
    [string]$TargetDir = $PSScriptRoot
)

$ErrorActionPreference = "Stop"

$resolvedDir = [System.IO.Path]::GetFullPath($TargetDir).TrimEnd('\')

if (-not (Test-Path $resolvedDir -PathType Container)) {
    Write-Error "Error: Specified directory does not exist: $resolvedDir"
    exit 1
}

Write-Host "Configuring User PATH for AndroScrn portable folder..." -ForegroundColor Cyan
Write-Host "Target: $resolvedDir" -ForegroundColor White

$userPath = [Environment]::GetEnvironmentVariable("Path", [EnvironmentVariableTarget]::User)
$entries = ($userPath -split ';') | Where-Object { $_ -ne '' } | ForEach-Object { $_.Trim().TrimEnd('\') }

if ($entries -contains $resolvedDir) {
    Write-Host "`n[OK] Directory is already present in your User PATH." -ForegroundColor Yellow
    Write-Host "No changes were made."
    exit 0
}

$newPath = ($entries + $resolvedDir) -join ';'
[Environment]::SetEnvironmentVariable("Path", $newPath, [EnvironmentVariableTarget]::User)

Write-Host "`n[SUCCESS] Added to User PATH successfully!" -ForegroundColor Green
Write-Host "Please close and reopen any open CMD or PowerShell terminals." -ForegroundColor White
Write-Host "You can then launch AndroScrn from any location by typing:" -ForegroundColor White
Write-Host "  androscrn" -ForegroundColor Yellow
Write-Host "  androscrn devices" -ForegroundColor Yellow
Write-Host "  androscrn doctor" -ForegroundColor Yellow
