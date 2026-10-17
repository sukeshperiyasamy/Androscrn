param(
    [string]$OutputDir = "$PSScriptRoot\..\..\dist-release"
)

$ErrorActionPreference = "Stop"
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "   ANDROSCRN STANDALONE PORTABLE RELEASE PACKAGER       " -ForegroundColor Cyan
Write-Host "   (Standalone Electron Distribution + Native CLI)      " -ForegroundColor DarkCyan
Write-Host "========================================================" -ForegroundColor Cyan

$Root = Resolve-Path "$PSScriptRoot\..\.."
$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)
$TargetDir = "$OutputDir\AndroScrn-portable-win-x64"
$ZipPath = "$OutputDir\AndroScrn-portable-win-x64.zip"
$ElectronDist = "$Root\apps\desktop\node_modules\electron\dist"
$CscPath = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

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

# Rename electron.exe to AndroScrn-gui.exe (GUI application executable)
if (Test-Path "$TargetDir\electron.exe") {
    Rename-Item -Path "$TargetDir\electron.exe" -NewName "AndroScrn-gui.exe" -Force
}

# Remove default Electron application stub
if (Test-Path "$TargetDir\resources\default_app.asar") {
    Remove-Item -Force "$TargetDir\resources\default_app.asar"
}

Write-Host "2. Compiling Native CUI CLI Launcher (androscrn.exe)..." -ForegroundColor Green
if (-not (Test-Path $CscPath)) {
    throw "Microsoft .NET C# compiler not found at $CscPath"
}
& $CscPath /nologo /target:exe /optimize+ /out:"$TargetDir\androscrn.exe" "$PSScriptRoot\androscrn-cli.cs"

Write-Host "3. Deploying Application Bundle (resources/app)..." -ForegroundColor Green
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

Write-Host "3b. Bundling local OCR runtime (tesseract.js + English language data)..." -ForegroundColor Green
# tesseract.js loads worker scripts and WebAssembly at runtime, so it cannot be bundled into main.js.
node "$PSScriptRoot\copy-runtime-deps.js" "$AppDir\node_modules" tesseract.js "@tesseract.js-data/eng"
if ($LASTEXITCODE -ne 0) { throw "Failed to copy the OCR runtime dependencies." }

Write-Host "4. Bundling Official Android ADB & Scrcpy Engine Binaries..." -ForegroundColor Green
# Ensure binary folder exists at both root level and inside resources
New-Item -ItemType Directory -Path "$TargetDir\bin" -Force | Out-Null
New-Item -ItemType Directory -Path "$TargetDir\resources\bin" -Force | Out-Null
Copy-Item -Path "$Root\bin\scrcpy-win64" -Destination "$TargetDir\bin\scrcpy-win64" -Recurse -Force
Copy-Item -Path "$Root\bin\scrcpy-win64" -Destination "$TargetDir\resources\bin\scrcpy-win64" -Recurse -Force

Write-Host "5. Copying Launchers, PATH Helpers, Licenses & Documentation..." -ForegroundColor Green
Copy-Item -Path "$Root\LICENSE" -Destination "$TargetDir\LICENSE" -Force
if (Test-Path "$Root\THIRD-PARTY-NOTICES.txt") {
    Copy-Item -Path "$Root\THIRD-PARTY-NOTICES.txt" -Destination "$TargetDir\THIRD-PARTY-NOTICES.txt" -Force
}
Copy-Item -Path "$Root\README.md" -Destination "$TargetDir\README.md" -Force
Copy-Item -Path "$Root\CHANGELOG.md" -Destination "$TargetDir\CHANGELOG.md" -Force
Copy-Item -Path "$Root\docs" -Destination "$TargetDir\docs" -Recurse -Force

# Copy CLI helper scripts
Copy-Item -Path "$PSScriptRoot\androscrn.cmd" -Destination "$TargetDir\androscrn.cmd" -Force
Copy-Item -Path "$PSScriptRoot\setup-path.ps1" -Destination "$TargetDir\setup-path.ps1" -Force
Copy-Item -Path "$PSScriptRoot\remove-path.ps1" -Destination "$TargetDir\remove-path.ps1" -Force

# Create desktop launcher batch file (launches GUI without terminal)
$LauncherBatch = @"
@echo off
setlocal
cd /d "%~dp0"
start "" "%~dp0AndroScrn-gui.exe" %*
"@
Set-Content -Path "$TargetDir\AndroScrn.bat" -Value $LauncherBatch -Encoding ASCII

Write-Host "6. Creating Compressed Portable ZIP Archive..." -ForegroundColor Green
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
$guiExeSize = (Get-Item "$TargetDir\AndroScrn-gui.exe").Length / 1MB
$cliExeSize = (Get-Item "$TargetDir\androscrn.exe").Length / 1KB

Write-Host "7. Generating SHA-256 Checksums..." -ForegroundColor Green
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
$guiExeHash = Get-Sha256Checksum "$TargetDir\AndroScrn-gui.exe"
$cliExeHash = Get-Sha256Checksum "$TargetDir\androscrn.exe"

$ChecksumContent = @"
# AndroScrn Release Checksums (SHA-256)
$zipHash  AndroScrn-portable-win-x64.zip
$guiExeHash  AndroScrn-gui.exe
$cliExeHash  androscrn.exe
"@
Set-Content -Path "$OutputDir\SHA256SUMS.txt" -Value $ChecksumContent.Trim() -Encoding UTF8

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "[OK] Standalone Portable Distribution Created!" -ForegroundColor Green
Write-Host "  Folder:      $TargetDir" -ForegroundColor White
Write-Host "  Archive:     $ZipPath" -ForegroundColor White
Write-Host "  ZIP Size:    $([math]::Round($zipSize, 2)) MB" -ForegroundColor White
Write-Host "  GUI EXE:     $([math]::Round($guiExeSize, 2)) MB" -ForegroundColor White
Write-Host "  CLI EXE:     $([math]::Round($cliExeSize, 2)) KB" -ForegroundColor White
Write-Host "  ZIP SHA:     $zipHash" -ForegroundColor Yellow
Write-Host "  GUI SHA:     $guiExeHash" -ForegroundColor Yellow
Write-Host "  CLI SHA:     $cliExeHash" -ForegroundColor Yellow
Write-Host "  Checksums:   $OutputDir\SHA256SUMS.txt" -ForegroundColor White
Write-Host "========================================================" -ForegroundColor Cyan
