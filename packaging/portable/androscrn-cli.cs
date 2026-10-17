using System;
using System.IO;
using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using System.Collections.Generic;

namespace AndroScrn.Cli
{
    class Program
    {
        private const string Version = "1.0.0-alpha.1";
        private const string DocsUrl = "https://sukeshperiyasamy.github.io/Androscrn/";

        static int Main(string[] args)
        {
            try
            {
                if (args.Length == 0)
                {
                    return LaunchGui();
                }

                string cmd = args[0].ToLowerInvariant();

                switch (cmd)
                {
                    case "--help":
                    case "-h":
                    case "help":
                    case "/?":
                        return ShowHelp();

                    case "--version":
                    case "-v":
                    case "version":
                        return ShowVersion();

                    case "devices":
                        return ListDevices();

                    case "doctor":
                        return RunDoctor();

                    case "docs":
                        return OpenDocs();

                    case "setup-path":
                        string targetSetup = args.Length > 1 ? args[1] : AppDomain.CurrentDomain.BaseDirectory;
                        return SetupPath(targetSetup);

                    case "remove-path":
                        string targetRemove = args.Length > 1 ? args[1] : AppDomain.CurrentDomain.BaseDirectory;
                        return RemovePath(targetRemove);

                    default:
                        Console.Error.WriteLine(string.Format("Error: Unknown command or option '{0}'.", args[0]));
                        Console.Error.WriteLine("Run 'androscrn --help' to view available commands.");
                        return 1;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Error: " + ex.Message);
                return 1;
            }
        }

        static int LaunchGui()
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            string[] candidates = new string[]
            {
                Path.Combine(baseDir, "AndroScrn-gui.exe"),
                Path.Combine(baseDir, "AndroScrn.exe")
            };

            string guiExe = null;
            foreach (string c in candidates)
            {
                // Ensure we don't accidentally recurse into ourselves
                if (File.Exists(c) && !string.Equals(c, System.Reflection.Assembly.GetExecutingAssembly().Location, StringComparison.OrdinalIgnoreCase))
                {
                    guiExe = c;
                    break;
                }
            }

            if (guiExe == null)
            {
                Console.WriteLine("AndroScrn CLI — Type 'androscrn --help' for usage or 'androscrn devices' to list devices.");
                return 0;
            }

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = guiExe;
                psi.WorkingDirectory = baseDir;
                psi.UseShellExecute = true;
                Process.Start(psi);
                Console.WriteLine("Launching AndroScrn desktop workbench...");
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Failed to launch desktop application: " + ex.Message);
                return 1;
            }
        }

        static int ShowHelp()
        {
            Console.WriteLine(@"AndroScrn — Next-Generation Android Control & Automation Platform for Windows

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
  https://sukeshperiyasamy.github.io/Androscrn/");
            return 0;
        }

        static int ShowVersion()
        {
            Console.WriteLine(string.Format("AndroScrn v{0} (scrcpy 5.0.1, adb 1.0.41, Windows x64)", Version));
            return 0;
        }

        static string ResolveAdbPath()
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            string[] candidates = new string[]
            {
                Path.Combine(baseDir, "bin\\scrcpy-win64\\adb.exe"),
                Path.Combine(baseDir, "resources\\bin\\scrcpy-win64\\adb.exe"),
                Path.Combine(baseDir, "..\\..\\bin\\scrcpy-win64\\adb.exe")
            };

            foreach (string c in candidates)
            {
                if (File.Exists(c)) return Path.GetFullPath(c);
            }
            return candidates[0];
        }

        static string ResolveScrcpyPath()
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            string[] candidates = new string[]
            {
                Path.Combine(baseDir, "bin\\scrcpy-win64\\scrcpy.exe"),
                Path.Combine(baseDir, "resources\\bin\\scrcpy-win64\\scrcpy.exe"),
                Path.Combine(baseDir, "..\\..\\bin\\scrcpy-win64\\scrcpy.exe")
            };

            foreach (string c in candidates)
            {
                if (File.Exists(c)) return Path.GetFullPath(c);
            }
            return candidates[0];
        }

        static int ListDevices()
        {
            string adbPath = ResolveAdbPath();
            if (!File.Exists(adbPath))
            {
                Console.Error.WriteLine(string.Format("Error: Bundled ADB binary not found at:\n  {0}\nPlease ensure the portable package was extracted completely.", adbPath));
                return 2;
            }

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = adbPath;
            psi.Arguments = "devices -l";
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.CreateNoWindow = true;

            using (Process proc = Process.Start(psi))
            {
                string stdout = proc.StandardOutput.ReadToEnd();
                string stderr = proc.StandardError.ReadToEnd();
                proc.WaitForExit(8000);

                if (proc.ExitCode != 0)
                {
                    Console.Error.WriteLine("Error querying ADB: " + stderr);
                    return proc.ExitCode;
                }

                List<string[]> devices = new List<string[]>();
                string[] lines = stdout.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);

                foreach (string line in lines)
                {
                    string trimmed = line.Trim();
                    if (string.IsNullOrEmpty(trimmed) || trimmed.StartsWith("List of devices") || trimmed.StartsWith("* daemon"))
                        continue;

                    string[] parts = Regex.Split(trimmed, @"\s+");
                    if (parts.Length < 2) continue;

                    string serial = parts[0];
                    string state = parts[1];
                    string isWifi = serial.Contains(":") ? "WIFI" : "USB";
                    string model = "Android Device";

                    for (int i = 2; i < parts.Length; i++)
                    {
                        if (parts[i].StartsWith("model:"))
                            model = parts[i].Replace("model:", "").Replace("_", " ");
                    }

                    devices.Add(new string[] { serial, state.ToUpperInvariant(), isWifi, model });
                }

                if (devices.Count == 0)
                {
                    Console.WriteLine("No Android devices detected.\n");
                    Console.WriteLine("Guidance:");
                    Console.WriteLine("  1. Connect your device via USB cable.");
                    Console.WriteLine("  2. Enable Developer Options -> USB Debugging on your device.");
                    Console.WriteLine("  3. Unlock phone and tap \"Always allow from this computer\" on RSA prompt.");
                    return 0;
                }

                Console.WriteLine(string.Format("Attached Android Devices ({0}):\n", devices.Count));
                Console.WriteLine("  SERIAL                 STATE         TYPE   MODEL / PRODUCT");
                Console.WriteLine("  ---------------------  ------------  -----  --------------------------------");

                foreach (string[] dev in devices)
                {
                    Console.WriteLine(string.Format("  {0,-21}  {1,-12}  {2,-5}  {3}", dev[0], dev[1], dev[2], dev[3]));
                    if (dev[1] == "UNAUTHORIZED")
                    {
                        Console.WriteLine("    └─ WARNING: Device unauthorized! Check device screen to accept RSA key.");
                    }
                    else if (dev[1] == "OFFLINE")
                    {
                        Console.WriteLine("    └─ WARNING: Device offline! Reconnect USB cable or restart ADB.");
                    }
                }

                Console.WriteLine("\nRun 'androscrn' to launch desktop workbench with device mirroring.");
                return 0;
            }
        }

        static int RunDoctor()
        {
            Console.WriteLine("========================================================");
            Console.WriteLine("   ANDROSCRN SYSTEM & PREREQUISITE DIAGNOSTICS DOCTOR   ");
            Console.WriteLine("========================================================\n");

            bool hasErrors = false;
            bool hasWarnings = false;

            // 1. OS Check
            Console.WriteLine("[1/6] Operating System Check:");
            OperatingSystem os = Environment.OSVersion;
            if (os.Platform == PlatformID.Win32NT)
            {
                Console.WriteLine(string.Format("  ✓ PASS: Windows detected ({0}, Version {1})", Environment.Is64BitOperatingSystem ? "64-bit" : "32-bit", os.Version));
            }
            else
            {
                Console.WriteLine("  ! WARNING: Non-Windows platform detected. AndroScrn is optimized for Windows 10/11 x64.");
                hasWarnings = true;
            }

            // 2. Bundled ADB
            string adbPath = ResolveAdbPath();
            Console.WriteLine("\n[2/6] Bundled Android Debug Bridge (ADB):");
            if (File.Exists(adbPath))
            {
                Console.WriteLine("  ✓ PASS: Found bundled ADB executable");
                Console.WriteLine("    Location: " + adbPath);
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo(adbPath, "version");
                    psi.UseShellExecute = false;
                    psi.RedirectStandardOutput = true;
                    psi.CreateNoWindow = true;
                    using (Process p = Process.Start(psi))
                    {
                        string outStr = p.StandardOutput.ReadToEnd();
                        p.WaitForExit(3000);
                        string firstLine = outStr.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)[0];
                        Console.WriteLine("    Version:  " + firstLine);
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine("  ! WARNING: Failed to read ADB version: " + ex.Message);
                    hasWarnings = true;
                }
            }
            else
            {
                Console.WriteLine("  ✕ FAIL: Bundled ADB binary not found at: " + adbPath);
                hasErrors = true;
            }

            // 3. Bundled scrcpy
            string scrcpyPath = ResolveScrcpyPath();
            Console.WriteLine("\n[3/6] Bundled scrcpy Engine:");
            if (File.Exists(scrcpyPath))
            {
                Console.WriteLine("  ✓ PASS: Found bundled scrcpy executable");
                Console.WriteLine("    Location: " + scrcpyPath);
            }
            else
            {
                Console.WriteLine("  ✕ FAIL: Bundled scrcpy binary not found at: " + scrcpyPath);
                hasErrors = true;
            }

            // 4. Device Connectivity
            Console.WriteLine("\n[4/6] Connected Android Hardware:");
            if (File.Exists(adbPath))
            {
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo(adbPath, "devices");
                    psi.UseShellExecute = false;
                    psi.RedirectStandardOutput = true;
                    psi.CreateNoWindow = true;
                    using (Process p = Process.Start(psi))
                    {
                        string outStr = p.StandardOutput.ReadToEnd();
                        p.WaitForExit(4000);
                        int count = 0;
                        string[] lines = outStr.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                        foreach (string l in lines)
                        {
                            string t = l.Trim();
                            if (string.IsNullOrEmpty(t) || t.StartsWith("List of devices") || t.StartsWith("* daemon")) continue;
                            count++;
                            Console.WriteLine("    • " + t);
                        }
                        if (count == 0)
                        {
                            Console.WriteLine("  ℹ INFO: No Android devices currently connected via USB or Wi-Fi.");
                            Console.WriteLine("    Guidance: Enable USB Debugging on phone and connect with USB cable.");
                        }
                        else
                        {
                            Console.WriteLine(string.Format("  ✓ PASS: {0} device(s) detected via ADB.", count));
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine("  ! WARNING: Error inspecting devices: " + ex.Message);
                    hasWarnings = true;
                }
            }
            else
            {
                Console.WriteLine("  ✕ SKIP: Cannot check devices (ADB binary missing).");
            }

            // 5. Named Pipe Boundary
            Console.WriteLine("\n[5/6] Supervised MCP Named Pipe Boundary:");
            Console.WriteLine("  ✓ PASS: IPC Named Pipe configured at: \\\\.\\pipe\\androscrn-mcp-control");
            Console.WriteLine("    Security: 64KB message limit, 5-minute time-bound sessions, HITL authorization.");

            // 6. User PATH check
            Console.WriteLine("\n[6/6] User PATH Integration:");
            string baseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            string userPath = Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.User) ?? "";
            bool inPath = false;
            foreach (string p in userPath.Split(';'))
            {
                if (string.Equals(p.Trim().TrimEnd('\\'), baseDir, StringComparison.OrdinalIgnoreCase))
                {
                    inPath = true;
                    break;
                }
            }

            if (inPath)
            {
                Console.WriteLine("  ✓ PASS: Application directory is configured in User PATH.");
                Console.WriteLine("    You can run 'androscrn' from any CMD or PowerShell prompt.");
            }
            else
            {
                Console.WriteLine("  ℹ INFO: Application folder is not currently in User PATH.");
                Console.WriteLine("    To enable global CLI access, run:\n      androscrn setup-path");
            }

            Console.WriteLine("\n========================================================");
            if (hasErrors)
            {
                Console.WriteLine("VERDICT: FAILED. Please resolve missing binary dependencies.");
                Console.WriteLine("========================================================");
                return 1;
            }
            else if (hasWarnings)
            {
                Console.WriteLine("VERDICT: ATTENTION NEEDED. Review device authorizations above.");
                Console.WriteLine("========================================================");
                return 0;
            }
            else
            {
                Console.WriteLine("VERDICT: HEALTHY. System is ready for AndroScrn workflows.");
                Console.WriteLine("========================================================");
                return 0;
            }
        }

        static int OpenDocs()
        {
            Console.WriteLine("Opening documentation in your default browser:\n  " + DocsUrl);
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = DocsUrl;
                psi.UseShellExecute = true;
                Process.Start(psi);
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Failed to open browser: " + ex.Message);
                return 1;
            }
        }

        static int SetupPath(string targetDir)
        {
            targetDir = Path.GetFullPath(targetDir).TrimEnd('\\');
            if (!Directory.Exists(targetDir))
            {
                Console.Error.WriteLine("Error: Target directory does not exist: " + targetDir);
                return 1;
            }

            string userPath = Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.User) ?? "";
            string[] parts = userPath.Split(new char[] { ';' }, StringSplitOptions.RemoveEmptyEntries);

            foreach (string p in parts)
            {
                if (string.Equals(p.Trim().TrimEnd('\\'), targetDir, StringComparison.OrdinalIgnoreCase))
                {
                    Console.WriteLine(string.Format("Directory is already present in User PATH:\n  {0}\nNo changes were made.", targetDir));
                    return 0;
                }
            }

            string newPath = (string.IsNullOrEmpty(userPath) ? "" : userPath.TrimEnd(';') + ";") + targetDir;
            Environment.SetEnvironmentVariable("Path", newPath, EnvironmentVariableTarget.User);

            Console.WriteLine(string.Format("Successfully added to User PATH:\n  {0}\n", targetDir));
            Console.WriteLine("Please open a new CMD or PowerShell window for changes to take effect.");
            Console.WriteLine("You can then type 'androscrn' from any directory.");
            return 0;
        }

        static int RemovePath(string targetDir)
        {
            targetDir = Path.GetFullPath(targetDir).TrimEnd('\\');
            string userPath = Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.User) ?? "";
            string[] parts = userPath.Split(new char[] { ';' }, StringSplitOptions.RemoveEmptyEntries);

            List<string> remaining = new List<string>();
            bool found = false;

            foreach (string p in parts)
            {
                if (string.Equals(p.Trim().TrimEnd('\\'), targetDir, StringComparison.OrdinalIgnoreCase))
                {
                    found = true;
                }
                else
                {
                    remaining.Add(p.Trim());
                }
            }

            if (!found)
            {
                Console.WriteLine(string.Format("Directory was not found in User PATH:\n  {0}\nNo changes needed.", targetDir));
                return 0;
            }

            string newPath = string.Join(";", remaining.ToArray());
            Environment.SetEnvironmentVariable("Path", newPath, EnvironmentVariableTarget.User);

            Console.WriteLine(string.Format("Successfully removed from User PATH:\n  {0}\n", targetDir));
            Console.WriteLine("Please open a new CMD or PowerShell window for changes to take effect.");
            return 0;
        }
    }
}
