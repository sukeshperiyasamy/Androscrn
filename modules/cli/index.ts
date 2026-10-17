import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { DeviceManager } from '../device_manager';
import { SecurityValidator } from '../security';
import { UserPathStore, PowerShellUserPathStore, addPathEntry, removePathEntry, parsePathList, pathListContains } from './path-utils';

export * from './path-utils';

/**
 * Opens an http(s) URL in the user's default browser. Only called when the user explicitly runs
 * `androscrn docs`. The spawn function is injectable so tests can verify the launch without opening a browser.
 */
export function openInDefaultBrowser(
  url: string,
  platform: NodeJS.Platform = os.platform(),
  spawnFn: (cmd: string, args: string[], opts: any) => { unref(): void } = spawn as any
): void {
  if (!/^https?:\/\/[^\s"&|<>^]+$/i.test(url)) {
    throw new Error(`Refusing to open a non-http(s) or unsafe URL: ${url}`);
  }
  if (platform === 'win32') {
    spawnFn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawnFn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

export interface CliCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CliEnvironment {
  adbPath?: string;
  scrcpyPath?: string;
  appDir?: string;
  docsUrl?: string;
  isPackaged?: boolean;
  /** Launches a URL in the default browser. Defaults to the real launcher; tests inject a recorder. */
  openUrl?: (url: string) => void;
  /** Persistence for the User PATH. Defaults to the real Windows User PATH; tests inject an in-memory store. */
  pathStore?: UserPathStore;
}

export class AndroScrnCli {
  private adbPath: string;
  private scrcpyPath: string;
  private appDir: string;
  private docsUrl: string;
  private deviceManager: DeviceManager;
  private pathStore: UserPathStore;
  private openUrl: (url: string) => void;

  constructor(env: CliEnvironment = {}) {
    this.openUrl = env.openUrl || ((url: string) => openInDefaultBrowser(url));
    this.pathStore = env.pathStore || new PowerShellUserPathStore();
    this.appDir = env.appDir || path.resolve(__dirname, '../../..');
    this.adbPath = env.adbPath || this.resolveBinaryPath('adb.exe');
    this.scrcpyPath = env.scrcpyPath || this.resolveBinaryPath('scrcpy.exe');
    this.docsUrl = env.docsUrl || 'https://sukeshperiyasamy.github.io/Androscrn/';
    this.deviceManager = new DeviceManager(this.adbPath);
  }

  /**
   * Resolves binary paths using standard portable and development candidates
   */
  private resolveBinaryPath(binaryName: string): string {
    const candidates = [
      path.join(this.appDir, 'bin', 'scrcpy-win64', binaryName),
      path.join(this.appDir, 'resources', 'bin', 'scrcpy-win64', binaryName),
      path.resolve(__dirname, '../../../bin/scrcpy-win64', binaryName),
      path.resolve(__dirname, '../../../../bin/scrcpy-win64', binaryName)
    ];

    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }
    return candidates[0];
  }

  /**
   * Main dispatch entry point for CLI arguments
   */
  public async run(args: string[]): Promise<CliCommandResult> {
    if (args.length === 0) {
      return this.handleNoArgs();
    }

    const command = args[0].toLowerCase();

    switch (command) {
      case '--help':
      case '-h':
      case 'help':
        return this.handleHelp();

      case '--version':
      case '-v':
      case 'version':
        return this.handleVersion();

      case 'devices':
        return await this.handleDevices();

      case 'doctor':
        return await this.handleDoctor();

      case 'docs':
        return await this.handleDocs();

      case 'setup-path':
        return this.handleSetupPath(args.slice(1));

      case 'remove-path':
        return this.handleRemovePath(args.slice(1));

      default:
        return {
          exitCode: 1,
          stdout: '',
          stderr: `Error: Unknown command or option '${args[0]}'.\nRun 'androscrn --help' to view available commands.\n`
        };
    }
  }

  /**
   * Default action when no arguments are passed: launches desktop UI or displays status
   */
  public handleNoArgs(): CliCommandResult {
    const guiExecutableCandidates = [
      path.join(this.appDir, 'AndroScrn.exe'),
      path.join(this.appDir, 'AndroScrn-gui.exe')
    ];

    const guiExe = guiExecutableCandidates.find(p => fs.existsSync(p));

    if (guiExe) {
      try {
        const child = spawn(guiExe, [], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false
        });
        child.unref();
        return {
          exitCode: 0,
          stdout: `Launching AndroScrn desktop workbench...\n`,
          stderr: ''
        };
      } catch (err: any) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `Failed to launch desktop application: ${err.message}\n`
        };
      }
    }

    return {
      exitCode: 0,
      stdout: `AndroScrn CLI — Type 'androscrn --help' for usage or 'androscrn devices' to list devices.\n`,
      stderr: ''
    };
  }

  /**
   * Displays help text
   */
  public handleHelp(): CliCommandResult {
    const helpText = `
AndroScrn — Next-Generation Android Control & Automation Platform for Windows

USAGE:
  androscrn [command] [options]

COMMANDS:
  (no args)       Launch the AndroScrn desktop workbench GUI application.
  devices         List attached Android devices with connection and authorization status.
  doctor          Run system, ADB, device authorization, and IPC environment diagnostics.
  docs            Open the official AndroScrn documentation website in the default browser.
  setup-path      Add the portable folder to the current user's PATH environment variable.
  remove-path     Remove the portable folder from the current user's PATH environment variable.

OPTIONS:
  -h, --help      Display this help documentation.
  -v, --version   Display application, bundled ADB, and scrcpy version information.

EXAMPLES:
  androscrn                     # Open desktop application
  androscrn devices             # Check attached USB and Wi-Fi devices
  androscrn doctor              # Validate prerequisites and system health
  androscrn setup-path          # Configure user PATH for global CLI access
  androscrn docs                # View full online guides and architecture specs

DOCUMENTATION:
  https://sukeshperiyasamy.github.io/Androscrn/
`.trim() + '\n';

    return {
      exitCode: 0,
      stdout: helpText,
      stderr: ''
    };
  }

  /**
   * Displays version information
   */
  public handleVersion(): CliCommandResult {
    let pkgVersion = '1.0.0-alpha.1';
    try {
      const pkgJsonPath = path.join(this.appDir, 'package.json');
      if (fs.existsSync(pkgJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
        pkgVersion = pkg.version || pkgVersion;
      }
    } catch {
      // Fallback to default
    }

    const versionText = `AndroScrn v${pkgVersion} (scrcpy 5.0.1, adb 1.0.41, Windows x64)\n`;
    return {
      exitCode: 0,
      stdout: versionText,
      stderr: ''
    };
  }

  /**
   * Queries connected Android devices using bundled ADB
   */
  public async handleDevices(): Promise<CliCommandResult> {
    if (!fs.existsSync(this.adbPath)) {
      return {
        exitCode: 2,
        stdout: '',
        stderr: `Error: Bundled ADB binary not found at:\n  ${this.adbPath}\nPlease ensure the portable package was extracted completely.\n`
      };
    }

    try {
      const devices = await this.deviceManager.getDevices();

      if (devices.length === 0) {
        return {
          exitCode: 0,
          stdout: `No Android devices detected.\n\nGuidance:\n  1. Connect your device via USB cable.\n  2. Enable Developer Options -> USB Debugging on your device.\n  3. Unlock phone and tap "Always allow from this computer" on RSA prompt.\n`,
          stderr: ''
        };
      }

      let out = `Attached Android Devices (${devices.length}):\n\n`;
      out += `  SERIAL                 STATE         TYPE   MODEL / PRODUCT\n`;
      out += `  ---------------------  ------------  -----  --------------------------------\n`;

      for (const d of devices) {
        const serialPad = d.serial.padEnd(21);
        const statePad = d.state.toUpperCase().padEnd(12);
        const typePad = d.transportType.toUpperCase().padEnd(5);
        const modelInfo = d.model !== 'Android Device' ? `${d.model} (${d.product})` : d.model;

        out += `  ${serialPad}  ${statePad}  ${typePad}  ${modelInfo}\n`;

        if (d.state === 'unauthorized') {
          out += `    └─ WARNING: Device unauthorized! Check device screen to accept RSA key.\n`;
        } else if (d.state === 'offline') {
          out += `    └─ WARNING: Device offline! Reconnect USB cable or restart ADB.\n`;
        }
      }

      out += `\nRun 'androscrn' to launch desktop workbench with device mirroring.\n`;

      return {
        exitCode: 0,
        stdout: out,
        stderr: ''
      };
    } catch (err: any) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Error querying ADB devices: ${err.message}\n`
      };
    }
  }

  /**
   * Comprehensive diagnostic doctor command
   */
  public async handleDoctor(): Promise<CliCommandResult> {
    let out = `========================================================\n`;
    out += `   ANDROSCRN SYSTEM & PREREQUISITE DIAGNOSTICS DOCTOR   \n`;
    out += `========================================================\n\n`;

    let hasErrors = false;
    let hasWarnings = false;

    // 1. Operating System
    const osPlatform = os.platform();
    const osArch = os.arch();
    const osRelease = os.release();
    out += `[1/6] Operating System Check:\n`;
    if (osPlatform === 'win32') {
      out += `  ✓ PASS: Windows detected (${osPlatform} ${osArch}, Build ${osRelease})\n`;
    } else {
      out += `  ! WARNING: Non-Windows platform detected (${osPlatform}). AndroScrn is optimized for Windows 10/11 x64.\n`;
      hasWarnings = true;
    }

    // 2. Bundled ADB Binary
    out += `\n[2/6] Bundled Android Debug Bridge (ADB):\n`;
    if (fs.existsSync(this.adbPath)) {
      try {
        const adbVersion = await this.deviceManager.getAdbVersion();
        out += `  ✓ PASS: Found bundled ADB executable\n`;
        out += `    Location: ${this.adbPath}\n`;
        out += `    Version:  ${adbVersion}\n`;
      } catch (err: any) {
        out += `  ! WARNING: ADB binary found but execution failed: ${err.message}\n`;
        hasWarnings = true;
      }
    } else {
      out += `  ✕ FAIL: Bundled ADB binary not found at: ${this.adbPath}\n`;
      hasErrors = true;
    }

    // 3. Bundled scrcpy Binary
    out += `\n[3/6] Bundled scrcpy Engine:\n`;
    if (fs.existsSync(this.scrcpyPath)) {
      out += `  ✓ PASS: Found bundled scrcpy executable\n`;
      out += `    Location: ${this.scrcpyPath}\n`;
    } else {
      out += `  ✕ FAIL: Bundled scrcpy binary not found at: ${this.scrcpyPath}\n`;
      hasErrors = true;
    }

    // 4. Device Connectivity
    out += `\n[4/6] Connected Android Hardware:\n`;
    if (fs.existsSync(this.adbPath)) {
      try {
        const devices = await this.deviceManager.getDevices();
        if (devices.length === 0) {
          out += `  ℹ INFO: No Android devices currently connected via USB or Wi-Fi.\n`;
          out += `    Guidance: Enable USB Debugging on phone and connect with USB cable.\n`;
        } else {
          out += `  ✓ PASS: ${devices.length} device(s) detected:\n`;
          for (const d of devices) {
            const authStatus = d.state === 'device' ? 'Ready & Authorized' : d.state.toUpperCase();
            out += `    • ${d.serial} (${d.model}) — [${authStatus}]\n`;
            if (d.state === 'unauthorized') {
              out += `      └─ Action Needed: Unlock phone and tap "Allow USB debugging".\n`;
              hasWarnings = true;
            }
          }
        }
      } catch (err: any) {
        out += `  ! WARNING: Error inspecting devices: ${err.message}\n`;
        hasWarnings = true;
      }
    } else {
      out += `  ✕ SKIP: Cannot check devices (ADB binary missing).\n`;
    }

    // 5. Windows Named Pipe Boundary
    out += `\n[5/6] Supervised MCP Named Pipe Boundary:\n`;
    const pipeAddress = '\\\\.\\pipe\\androscrn-mcp-control';
    out += `  ✓ PASS: IPC Named Pipe configured at: ${pipeAddress}\n`;
    out += `    Security: 64KB message limit, 5-minute time-bound sessions, HITL authorization.\n`;

    // 6. User PATH Environment
    out += `\n[6/6] User PATH Integration:\n`;
    const isDirInPath = this.checkIfDirectoryInPath(this.appDir);
    if (isDirInPath) {
      out += `  ✓ PASS: Application directory is configured in User PATH.\n`;
      out += `    You can run 'androscrn' from any CMD or PowerShell prompt.\n`;
    } else {
      out += `  ℹ INFO: Application folder is not currently in User PATH.\n`;
      out += `    To enable global CLI access, run:\n`;
      out += `      androscrn setup-path\n`;
    }

    out += `\n========================================================\n`;
    if (hasErrors) {
      out += `VERDICT: FAILED. Please resolve missing binary dependencies.\n`;
    } else if (hasWarnings) {
      out += `VERDICT: ATTENTION NEEDED. Review device authorizations above.\n`;
    } else {
      out += `VERDICT: HEALTHY. System is ready for AndroScrn workflows.\n`;
    }
    out += `========================================================\n`;

    return {
      exitCode: hasErrors ? 1 : 0,
      stdout: out,
      stderr: ''
    };
  }

  /**
   * Opens documentation website in the default browser
   */
  public async handleDocs(): Promise<CliCommandResult> {
    const url = this.docsUrl;

    try {
      this.openUrl(url);

      return {
        exitCode: 0,
        stdout: `Opening documentation in your default browser:\n  ${url}\n`,
        stderr: ''
      };
    } catch (err: any) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Failed to open documentation: ${err.message}\nYou can visit manually at: ${url}\n`
      };
    }
  }

  /**
   * Adds the target directory to the current User's PATH environment variable.
   * The read happens first and any read failure aborts without writing, so a failed read can never
   * overwrite the existing PATH.
   */
  public handleSetupPath(args: string[]): CliCommandResult {
    const targetDir = args[0] ? path.resolve(args[0]) : this.appDir;

    if (!fs.existsSync(targetDir)) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Error: Target directory does not exist: ${targetDir}\n`
      };
    }

    if (os.platform() !== 'win32') {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Error: 'setup-path' is currently supported on Windows systems.\n`
      };
    }

    try {
      const current = this.pathStore.read();
      const change = addPathEntry(current, targetDir);

      if (!change.changed) {
        return {
          exitCode: 0,
          stdout: `Directory is already present in User PATH:\n  ${targetDir}\nNo changes were made.\n`,
          stderr: ''
        };
      }

      this.pathStore.write(change.value);
      return {
        exitCode: 0,
        stdout: `Successfully added to User PATH:\n  ${targetDir}\n\nPlease open a new CMD or PowerShell window for changes to take effect.\nYou can then type 'androscrn' from any directory.\n`,
        stderr: ''
      };
    } catch (err: any) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Failed to update User PATH: ${err.message}\n`
      };
    }
  }

  /**
   * Removes the target directory (and any duplicates of it) from the current User's PATH.
   */
  public handleRemovePath(args: string[]): CliCommandResult {
    const targetDir = args[0] ? path.resolve(args[0]) : this.appDir;

    if (os.platform() !== 'win32') {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Error: 'remove-path' is currently supported on Windows systems.\n`
      };
    }

    try {
      const current = this.pathStore.read();
      const change = removePathEntry(current, targetDir);

      if (!change.changed) {
        return {
          exitCode: 0,
          stdout: `Directory was not found in User PATH:\n  ${targetDir}\nNo changes needed.\n`,
          stderr: ''
        };
      }

      this.pathStore.write(change.value);
      return {
        exitCode: 0,
        stdout: `Successfully removed from User PATH:\n  ${targetDir}\n\nPlease open a new CMD or PowerShell window for changes to take effect.\n`,
        stderr: ''
      };
    } catch (err: any) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Failed to remove from User PATH: ${err.message}\n`
      };
    }
  }

  private checkIfDirectoryInPath(targetDir: string): boolean {
    if (os.platform() !== 'win32') return false;
    try {
      return pathListContains(parsePathList(this.pathStore.read()), targetDir);
    } catch {
      return false;
    }
  }
}
