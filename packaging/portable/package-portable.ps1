param(
    [string]$OutputDir = "$PSScriptRoot\..\..\dist-release"
)

$ErrorActionPreference = "Stop"
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "   ANDROSCRN STANDALONE PORTABLE RELEASE PACKAGER       " -ForegroundColor Cyan
Write-Host "   (Provisional Standalone Electron Distribution)       " -ForegroundColor DarkCyan
Write-Host "========================================================" -ForegroundColor Cyan

$Root = Resolve-Path "$PSScriptRoot\..\.."
$TargetDir = "$OutputDir\AndroScrn-portable-win-x64"
$ZipPath = "$OutputDir\AndroScrn-portable-win-x64.zip"
$ElectronDist = "$Root\apps\desktop\node_modules\electron\dist"

if (-not (Test-Path $ElectronDist)) {
    throw "Electron runtime distribution not found at $ElectronDist. Please run 'npm install' in apps/desktop first."
}

if (-not (Test-Path "$Root\apps\desktop\dist\index.html")) {
    Write-Host "Building desktop frontend and electron bundles..." -ForegroundColor Yellow
    & npm --prefix "$Root\apps\desktop" run build
}

if (Test-Path $TargetDir) {
    Write-Host "Cleaning previous portable target directory..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $TargetDir
}
New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null

Write-Host "1. Assembling Standalone Electron Runtime..." -ForegroundColor Green
# Copy all Electron base distribution files
Copy-Item -Path "$ElectronDist\*" -Destination $TargetDir -Recurse -Force

# Rename electron.exe to AndroScrn.exe
if (Test-Path "$TargetDir\electron.exe") {
    Rename-Item -Path "$TargetDir\electron.exe" -NewName "AndroScrn.exe" -Force
}

# Remove default Electron application stub
if (Test-Path "$TargetDir\resources\default_app.asar") {
    Remove-Item -Force "$TargetDir\resources\default_app.asar"
}

Write-Host "2. Deploying Application Bundle (resources/app)..." -ForegroundColor Green
$AppDir = "$TargetDir\resources\app"
New-Item -ItemType Directory -Path $AppDir -Force | Out-Null

# Copy compiled frontend and electron main/preload bundles
Copy-Item -Path "$Root\apps\desktop\dist" -Destination "$AppDir\dist" -Recurse -Force
Copy-Item -Path "$Root\apps\desktop\dist-electron" -Destination "$AppDir\dist-electron" -Recurse -Force

# Create minimal production package.json for Electron entry point
$AppPackageJson = @{
    name = "androscrn"
    version = "1.0.0-alpha.1"
    main = "dist-electron/main.js"
    description = "AndroScrn Standalone Portable Desktop"
} | ConvertTo-Json
Set-Content -Path "$AppDir\package.json" -Value $AppPackageJson -Encoding UTF8

Write-Host "3. Bundling Official Android ADB & Scrcpy Engine Binaries..." -ForegroundColor Green
# Ensure binary folder exists at both root level and inside resources
New-Item -ItemType Directory -Path "$TargetDir\bin" -Force | Out-Null
New-Item -ItemType Directory -Path "$TargetDir\resources\bin" -Force | Out-Null
Copy-Item -Path "$Root\bin\scrcpy-win64" -Destination "$TargetDir\bin\scrcpy-win64" -Recurse -Force
Copy-Item -Path "$Root\bin\scrcpy-win64" -Destination "$TargetDir\resources\bin\scrcpy-win64" -Recurse -Force

Write-Host "4. Copying Licenses, Documentation & Launcher..." -ForegroundColor Green
Copy-Item -Path "$Root\LICENSE" -Destination "$TargetDir\LICENSE" -Force
if (Test-Path "$Root\THIRD-PARTY-NOTICES.txt") {
    Copy-Item -Path "$Root\THIRD-PARTY-NOTICES.txt" -Destination "$TargetDir\THIRD-PARTY-NOTICES.txt" -Force
}
Copy-Item -Path "$Root\README.md" -Destination "$TargetDir\README.md" -Force
Copy-Item -Path "$Root\CHANGELOG.md" -Destination "$TargetDir\CHANGELOG.md" -Force
Copy-Item -Path "$Root\docs" -Destination "$TargetDir\docs" -Recurse -Force

# Create portable launcher batch file (no external Node.js/npm dependencies)
$LauncherBatch = @"
@echo off
setlocal
cd /d "%~dp0"
start "" "%~dp0AndroScrn.exe" %*
"@
Set-Content -Path "$TargetDir\AndroScrn.bat" -Value $LauncherBatch -Encoding ASCII

Write-Host "5. Creating Compressed Portable ZIP Archive..." -ForegroundColor Green
if (Test-Path $ZipPath) {
    Remove-Item -Force $ZipPath
}

Push-Location $TargetDir
try {
    & "C:\Windows\System32\tar.exe" -a -c -f "$ZipPath" *
} finally {
    Pop-Location
}

$zipSize = (Get-Item $ZipPath).Length / 1MB
$exeSize = (Get-Item "$TargetDir\AndroScrn.exe").Length / 1MB

Write-Host "6. Generating SHA-256 Checksums..." -ForegroundColor Green
function Get-Sha256Checksum([string]$filePath) {
    $stream = [System.IO.File]::OpenRead($filePath)
    try {
        $hasher = [System.Security.Cryptography.SHA256]::Create()
        $hashBytes = $hasher.ComputeHash($stream)
        return ([System.BitConverter]::ToString($hashBytes) -replace '-','').ToLower()
    } finally {
        $stream.Close()
    }
}

$zipHash = Get-Sha256Checksum $ZipPath
$exeHash = Get-Sha256Checksum "$TargetDir\AndroScrn.exe"

$ChecksumContent = @"
# AndroScrn Release Checksums (SHA-256)
$zipHash  AndroScrn-portable-win-x64.zip
$exeHash  AndroScrn.exe
"@
Set-Content -Path "$OutputDir\SHA256SUMS.txt" -Value $ChecksumContent.Trim() -Encoding UTF8

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "[OK] Standalone Portable Distribution Created!" -ForegroundColor Green
Write-Host "  Folder:    $TargetDir" -ForegroundColor White
Write-Host "  Archive:   $ZipPath" -ForegroundColor White
Write-Host "  ZIP Size:  $([math]::Round($zipSize, 2)) MB" -ForegroundColor White
Write-Host "  EXE Size:  $([math]::Round($exeSize, 2)) MB" -ForegroundColor White
Write-Host "  ZIP SHA:   $zipHash" -ForegroundColor Yellow
Write-Host "  EXE SHA:   $exeHash" -ForegroundColor Yellow
Write-Host "  Checksums: $OutputDir\SHA256SUMS.txt" -ForegroundColor White
Write-Host "========================================================" -ForegroundColor Cyan

