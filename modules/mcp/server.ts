import fs from 'fs';
import path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DeviceManager } from '../device_manager';
import { DiagnosticsManager } from '../diagnostics';
import { SecurityValidator } from '../security';
import { PairingManager } from './pairing';
import { McpServerConfig } from './types';

export class AndroScrnMcpServer {
  public readonly server: McpServer;
  private deviceManager: DeviceManager;
  private diagnosticsManager: DiagnosticsManager;
  public readonly pairingManager: PairingManager;
  private capturesDir: string;

  constructor(
    config: McpServerConfig = {},
    deviceManager?: DeviceManager,
    diagnosticsManager?: DiagnosticsManager,
    pairingManager?: PairingManager
  ) {
    const name = config.name || 'androscrn-mcp';
    const version = config.version || '1.0.0';

    this.server = new McpServer({
      name,
      version
    });

    // Default binary path resolution
    const adbPath = config.adbPath || path.resolve(__dirname, '../../bin/scrcpy-win64/adb.exe');
    this.capturesDir = config.capturesDir || path.resolve(__dirname, '../../Captures');

    this.deviceManager = deviceManager || new DeviceManager(adbPath);
    this.diagnosticsManager = diagnosticsManager || new DiagnosticsManager(this.deviceManager);
    this.pairingManager = pairingManager || new PairingManager(config.pinTtlMs, config.sessionTtlMs, config.controlBridge);

    this.registerTools();
  }

  private registerTools(): void {
    /**
     * Tool 1: list_devices (Tier 0 - read:telemetry)
     */
    this.server.tool(
      'list_devices',
      'List all currently attached Android devices, their hardware models, states, and transport types.',
      {},
      async () => {
        try {
          const devices = await this.deviceManager.getDevices();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(devices, null, 2)
              }
            ]
          };
        } catch (err: any) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Failed to list devices: ${err?.message || err}` }]
          };
        }
      }
    );

    /**
     * Tool 2: get_device_info (Tier 0 - read:telemetry)
     */
    this.server.tool(
      'get_device_info',
      'Retrieve detailed hardware, battery, and connection status for a specified Android device.',
      {
        serial: z.string().describe('Target device serial identifier (e.g. kjizrsgekfsglvgi or 192.168.1.100:5555)')
      },
      async ({ serial }) => {
        if (!SecurityValidator.isValidSerial(serial)) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Invalid device serial format: "${serial}". Must be alphanumeric, dot, colon, or hyphen.` }]
          };
        }

        try {
          const devices = await this.deviceManager.getDevices();
          const target = devices.find(d => d.serial === serial);

          if (!target) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Device with serial "${serial}" was not found or is disconnected.` }]
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(target, null, 2)
              }
            ]
          };
        } catch (err: any) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Failed to retrieve device info: ${err?.message || err}` }]
          };
        }
      }
    );

    /**
     * Tool 3: get_logcat (Tier 1 - read:logs with redaction)
     */
    this.server.tool(
      'get_logcat',
      'Retrieve bounded recent logcat entries for a target device. Sensitive tokens and credentials are automatically redacted.',
      {
        serial: z.string().describe('Target device serial identifier'),
        lines: z.number().int().min(1).max(500).default(50).describe('Number of recent log lines to retrieve (1 to 500)'),
        filterLevel: z.enum(['V', 'D', 'I', 'W', 'E', 'F']).optional().describe('Optional minimum log priority level (V, D, I, W, E, F)')
      },
      async ({ serial, lines, filterLevel }) => {
        if (!SecurityValidator.isValidSerial(serial)) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Invalid device serial format: "${serial}".` }]
          };
        }

        try {
          const rawLogs = await this.diagnosticsManager.getRecentLogs(serial, lines);

          let filtered = rawLogs;
          if (filterLevel) {
            const levelOrder = ['V', 'D', 'I', 'W', 'E', 'F'];
            const minIndex = levelOrder.indexOf(filterLevel);
            filtered = rawLogs.filter(l => {
              const idx = levelOrder.indexOf(l.level);
              return idx >= minIndex;
            });
          }

          // Redact sensitive data from every log message
          const sanitized = filtered.map(l => ({
            ...l,
            raw: SecurityValidator.redactSensitiveText(l.raw),
            message: SecurityValidator.redactSensitiveText(l.message)
          }));

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(sanitized, null, 2)
              }
            ]
          };
        } catch (err: any) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Failed to retrieve logcat: ${err?.message || err}` }]
          };
        }
      }
    );

    /**
     * Tool 4: get_diagnostics (Tier 0 - read:telemetry)
     */
    this.server.tool(
      'get_diagnostics',
      'Generate a comprehensive, redacted diagnostic bundle of host OS, toolchain versions (ADB, scrcpy), and active device status.',
      {},
      async () => {
        try {
          const bundleText = await this.diagnosticsManager.generateDiagnosticBundle();
          const redactedReport = SecurityValidator.redactSensitiveText(bundleText);

          return {
            content: [
              {
                type: 'text',
                text: redactedReport
              }
            ]
          };
        } catch (err: any) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Failed to generate diagnostics: ${err?.message || err}` }]
          };
        }
      }
    );

    /**
     * Tool 5: capture_screenshot (Tier 2 - read:screen)
     */
    this.server.tool(
      'capture_screenshot',
      'Capture a verified raw frame buffer PNG screenshot from an Android device. Validates PNG signature.',
      {
        serial: z.string().describe('Target device serial identifier'),
        format: z.enum(['base64', 'file']).default('base64').describe("Output format: 'base64' (default, embedded PNG data) or 'file' (path only)")
      },
      async ({ serial, format }) => {
        if (!SecurityValidator.isValidSerial(serial)) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Invalid device serial format: "${serial}".` }]
          };
        }

        try {
          const res = await this.diagnosticsManager.captureDeviceScreenshot(serial, this.capturesDir);

          if (!res.success || !res.filePath) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Screenshot capture failed: ${res.error || 'Unknown error'}` }]
            };
          }

          // Read the file and verify PNG magic bytes (89 50 4E 47)
          const buffer = fs.readFileSync(res.filePath);
          const isPng = buffer.length >= 8 &&
            buffer[0] === 0x89 &&
            buffer[1] === 0x50 &&
            buffer[2] === 0x4e &&
            buffer[3] === 0x47;

          if (!isPng) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Captured image failed PNG magic signature verification.` }]
            };
          }

          if (format === 'file') {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    filePath: res.filePath,
                    sizeBytes: res.size
                  }, null, 2)
                }
              ]
            };
          }

          // format === 'base64' -> Return MCP Image Content Block
          return {
            content: [
              {
                type: 'image',
                data: buffer.toString('base64'),
                mimeType: 'image/png'
              },
              {
                type: 'text',
                text: `Screenshot captured from ${serial} (${res.size} bytes). Stored at: ${res.filePath}`
              }
            ]
          };
        } catch (err: any) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Screenshot capture exception: ${err?.message || err}` }]
          };
        }
      }
    );

    /**
     * Tool 6: request_pairing (Pairing Handshake)
     */
     this.server.tool(
       'request_pairing',
       'Request human-in-the-loop authorization to execute device-modifying actions. The pairing request is forwarded to the AndroScrn desktop application for user approval. The verification PIN is displayed strictly on the user desktop monitor.',
       {
         clientName: z.string().default('AI-Agent').describe('Name of the requesting AI client or agent'),
         requestedTier: z.number().int().min(1).max(4).default(3).describe('Requested permission tier (3: write:input, 4: write:admin)')
       },
       async ({ clientName, requestedTier }) => {
         const res = await this.pairingManager.requestPairing(clientName, requestedTier as any);
         if (res.error) {
           return {
             isError: true,
             content: [{ type: 'text', text: res.error }]
           };
         }

         return {
           content: [
             {
               type: 'text',
               text: JSON.stringify({
                 requestId: res.requestId,
                 status: 'pending_desktop_approval',
                 expiresInSeconds: res.expiresInSeconds,
                 instructions: `Pairing request registered for client '${clientName}' (Tier ${requestedTier}). Please wait for the user to approve the request in the AndroScrn desktop application, or obtain the 6-digit PIN displayed on the desktop screen and submit it using pair_session.`
               }, null, 2)
             }
           ]
         };
       }
     );

    /**
     * Tool 7: pair_session (Pairing Handshake)
     */
    this.server.tool(
      'pair_session',
      'Finalize pairing by submitting the requestId (after desktop approval) or with the verification PIN displayed on the desktop screen.',
      {
        requestId: z.string().describe('The pairing requestId returned by request_pairing'),
        pin: z.string().optional().describe('Optional 6-digit verification PIN displayed on the user desktop screen'),
        clientName: z.string().optional().describe('Optional client identifier')
      },
      async ({ requestId, pin, clientName }) => {
        const res = this.pairingManager.pairSession(requestId, pin, clientName);
        if (!res.success) {
          return {
            isError: true,
            content: [{ type: 'text', text: res.error || 'Pairing failed' }]
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                sessionToken: res.token,
                note: 'Session token authorized. Pass token with mutating tool calls.'
              }, null, 2)
            }
          ]
        };
      }
    );

    /**
     * Tool 8: get_pairing_status (Pairing Inspection)
     */
    this.server.tool(
      'get_pairing_status',
      'Check active session status and granted permission tiers.',
      {
        token: z.string().optional().describe('Session token to verify')
      },
      async ({ token }) => {
        const activeSessions = this.pairingManager.getActiveSessions();
        if (token) {
          const match = activeSessions.find(s => s.token === token);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  valid: !!match,
                  session: match || null
                }, null, 2)
              }
            ]
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                activeSessionCount: activeSessions.length,
                sessions: activeSessions.map(s => ({
                  sessionId: s.sessionId,
                  createdAt: new Date(s.createdAt).toISOString(),
                  expiresAt: new Date(s.expiresAt).toISOString(),
                  clientName: s.clientName
                }))
              }, null, 2)
            }
          ]
        };
      }
    );
  }
}
