param(
    [string]$OutputDir = "$PSScriptRoot\..\..\dist-release"
)

$ErrorActionPreference = "Stop"
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "      ANDROSCRN PORTABLE RELEASE PACKAGER               " -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

$Root = Resolve-Path "$PSScriptRoot\..\.."
$TargetDir = "$OutputDir\AndroScrn-Portable-win64"

if (Test-Path $TargetDir) {
    Remove-Item -Recurse -Force $TargetDir
}
New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null

Write-Host "1. Copying Core Modules & Binaries..." -ForegroundColor Green
Copy-Item -Path "$Root\dist" -Destination "$TargetDir\dist" -Recurse -Force
Copy-Item -Path "$Root\bin" -Destination "$TargetDir\bin" -Recurse -Force
Copy-Item -Path "$Root\docs" -Destination "$TargetDir\docs" -Recurse -Force
Copy-Item -Path "$Root\README.md" -Destination "$TargetDir\README.md" -Force
Copy-Item -Path "$Root\LICENSE" -Destination "$TargetDir\LICENSE" -Force
Copy-Item -Path "$Root\CHANGELOG.md" -Destination "$TargetDir\CHANGELOG.md" -Force
Copy-Item -Path "$Root\launch.bat" -Destination "$TargetDir\AndroScrn.bat" -Force

Write-Host "2. Copying Desktop Build Assets..." -ForegroundColor Green
New-Item -ItemType Directory -Path "$TargetDir\apps\desktop" -Force | Out-Null
Copy-Item -Path "$Root\apps\desktop\dist" -Destination "$TargetDir\apps\desktop\dist" -Recurse -Force
Copy-Item -Path "$Root\apps\desktop\dist-electron" -Destination "$TargetDir\apps\desktop\dist-electron" -Recurse -Force
Copy-Item -Path "$Root\apps\desktop\package.json" -Destination "$TargetDir\apps\desktop\package.json" -Force

Write-Host "3. Creating High-Speed Portable ZIP Archive..." -ForegroundColor Green
$ZipPath = "$OutputDir\AndroScrn-v1.0.0-alpha.1-win64.zip"
if (Test-Path $ZipPath) {
    Remove-Item -Force $ZipPath
}

# Use native Windows bsdtar for fast zip compression
Push-Location $TargetDir
try {
    & "C:\Windows\System32\tar.exe" -a -c -f "$ZipPath" *
} finally {
    Pop-Location
}

$zipSize = (Get-Item $ZipPath).Length / 1MB

Write-Host "[OK] Portable Package Created Successfully!" -ForegroundColor Yellow
Write-Host "  Location: $ZipPath" -ForegroundColor White
Write-Host "  Archive Size: $([math]::Round($zipSize, 2)) MB" -ForegroundColor White
Write-Host "========================================================" -ForegroundColor Cyan
