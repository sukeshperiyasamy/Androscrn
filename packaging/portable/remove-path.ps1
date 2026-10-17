<#
.SYNOPSIS
    Removes the AndroScrn portable folder from the current User's PATH.
.DESCRIPTION
    This script is user-scoped and cleans up the PATH without touching other user or machine variables.
#>
param(
    [string]$TargetDir = $PSScriptRoot
)

$ErrorActionPreference = "Stop"

$resolvedDir = [System.IO.Path]::GetFullPath($TargetDir).TrimEnd('\')

Write-Host "Removing AndroScrn portable folder from User PATH..." -ForegroundColor Cyan
Write-Host "Target: $resolvedDir" -ForegroundColor White

$userPath = [Environment]::GetEnvironmentVariable("Path", [EnvironmentVariableTarget]::User)
$entries = ($userPath -split ';') | Where-Object { $_ -ne '' } | ForEach-Object { $_.Trim().TrimEnd('\') }

if (-not ($entries -contains $resolvedDir)) {
    Write-Host "`n[OK] Directory was not found in your User PATH." -ForegroundColor Yellow
    Write-Host "No changes needed."
    exit 0
}

$remaining = $entries | Where-Object { $_ -ne $resolvedDir }
$newPath = $remaining -join ';'
[Environment]::SetEnvironmentVariable("Path", $newPath, [EnvironmentVariableTarget]::User)

Write-Host "`n[SUCCESS] Successfully removed from User PATH." -ForegroundColor Green
Write-Host "Please close and reopen any open CMD or PowerShell terminals." -ForegroundColor White
