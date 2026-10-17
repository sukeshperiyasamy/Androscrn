# Getting Started

This page covers prerequisites, installing AndroScrn, and connecting your first phone. For everyday workflows see
[usage.md](usage.md); if something does not work see [troubleshooting.md](troubleshooting.md).

## 1. Prerequisites

| Item | Requirement |
| :--- | :--- |
| Computer | Windows 10 or 11, 64-bit (x64). ARM64 is untested ([platform-support.md](platform-support.md)). |
| Phone | Android 5.0+ for mirroring; Android 12+ for the scrcpy camera; Android 11+ for Wireless debugging. |
| Cable | A USB cable that carries data (charge-only cables will not work). |
| Phone settings | Developer options enabled and **USB debugging** turned on. |
| Source builds only | Node.js 20 or newer and npm. The portable build does not need Node.js, Python, Java or Android Studio. |

ADB and scrcpy are bundled under `bin/scrcpy-win64/`. See [compatibility.md](compatibility.md) for tested devices and
vendor-specific restrictions.

## 2. Installation

### Option A: portable build (no installer)

1. Get `AndroScrn-portable-win-x64.zip` from the repository's
   [Releases](https://github.com/sukeshperiyasamy/Androscrn/releases) page if a release has been published, or build it
   yourself (Option B).
2. Extract it to any folder, including folders with spaces.
3. Run `AndroScrn-gui.exe` (desktop app) or `androscrn.exe` (command-line launcher, opens the app when run without
   arguments).

The portable build is not code-signed. If Windows SmartScreen shows "Windows protected your PC", choose **More info**
and then **Run anyway** only if you obtained the file from a source you trust.

### Option B: build from source

```bash
git clone https://github.com/sukeshperiyasamy/Androscrn.git
cd Androscrn
npm install
npm --prefix apps/desktop install
npm run build            # compile modules and the desktop UI
npm run build:portable   # optional; creates dist-release/AndroScrn-portable-win-x64.zip
```

To work on the UI, `npm run dev:desktop` starts the Vite dev server in `apps/desktop`. `launch.bat` in the repository
root starts the app from a source checkout.

## 3. First connection

1. On the phone: **Settings -> About phone**, tap **Build number** seven times to enable Developer options.
2. Open **Developer options** and turn on **USB debugging**.
3. Connect the phone to the PC.
4. Accept **Allow USB debugging?** on the phone (tick "Always allow from this computer" if you trust the PC).
5. Start AndroScrn. The device bar shows your phone with a **Ready** badge.

If the badge says `Unauthorized` or `Offline`, open the connection-help panel under the header for step-by-step guidance.
`androscrn doctor` checks the toolchain, devices, IPC bridge and PATH in one command.

For Wi-Fi, see "Wireless debugging" in [usage.md](usage.md).

## 4. Command-line launcher

| Command | What it does |
| :--- | :--- |
| `androscrn` | Opens the desktop app and returns the console. |
| `androscrn --help`, `-h` | Shows the command reference. |
| `androscrn --version`, `-v` | Prints the AndroScrn, scrcpy and ADB versions. |
| `androscrn devices` | Lists attached devices and their authorization state. |
| `androscrn doctor` | Runs the system diagnostic checks. |
| `androscrn docs` | Opens the documentation website in your default browser. |
| `androscrn setup-path` | Adds the AndroScrn folder to your **User** PATH (no administrator rights). |
| `androscrn remove-path` | Removes it again. |

### Optional: run `androscrn` from any folder

```powershell
.\androscrn.exe setup-path
```

This edits only your User PATH, skips duplicates and keeps all other entries. Windows can take several seconds to apply
a persistent environment change. Open a new terminal afterwards. Undo it with `.\androscrn.exe remove-path`.
Running `.\androscrn.exe` directly always works without touching PATH.
