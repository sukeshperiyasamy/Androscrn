import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DeviceManager } from '../device_manager';
import { DiagnosticsManager } from '../diagnostics';
import { SecurityValidator } from '../security';
import { PairingManager } from './pairing';
import { McpServerConfig, IControlBridge } from './types';

export class AndroScrnMcpServer {
  public readonly server: McpServer;
  private deviceManager: DeviceManager;
  private diagnosticsManager: DiagnosticsManager;
  public readonly pairingManager: PairingManager;
  private capturesDir: string;
  private controlBridge?: IControlBridge;

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
    this.controlBridge = config.controlBridge;

    this.deviceManager = deviceManager || new DeviceManager(adbPath);
    this.diagnosticsManager = diagnosticsManager || new DiagnosticsManager(this.deviceManager);
    this.pairingManager = pairingManager || new PairingManager(config.pinTtlMs, config.sessionTtlMs, config.controlBridge);

    this.registerTools();
  }

  public onActionAudit?: (audit: {
    action: 'tap' | 'swipe' | 'keyevent' | 'input_text';
    serial: string;
    clientName: string;
    status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'REJECTED';
    details?: string;
    durationMs?: number;
    error?: string;
  }) => void;

  private notifyActionAudit(audit: {
    action: 'tap' | 'swipe' | 'keyevent' | 'input_text';
    serial: string;
    clientName: string;
    status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'REJECTED';
    details?: string;
    durationMs?: number;
    error?: string;
  }): void {
    if (this.onActionAudit) {
      try {
        this.onActionAudit(audit);
      } catch {
        // ignore
      }
    }
    if (this.controlBridge && this.controlBridge.isConnected()) {
      try {
        this.controlBridge.sendActionAudit({
          type: 'ACTION_AUDIT',
          actionId: crypto.randomUUID(),
          action: audit.action,
          serial: audit.serial,
          clientName: audit.clientName,
          status: audit.status,
          details: audit.details,
          durationMs: audit.durationMs,
          error: audit.error,
          timestamp: Date.now()
        });
      } catch {
        // Non-blocking audit notification
      }
    }
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

    /**
     * Tool 9: tap (Tier 3 - write:input)
     */
    this.server.tool(
      'tap',
      'Simulate a touchscreen tap gesture at specific (x, y) display coordinates on an authorized Android device. Requires Tier 3 paired session token.',
      {
        token: z.string().describe('Active paired session token with Tier 3 permission'),
        serial: z.string().describe('Target Android device serial identifier'),
        x: z.number().int().min(0).describe('Target horizontal screen coordinate in pixels (X >= 0)'),
        y: z.number().int().min(0).describe('Target vertical screen coordinate in pixels (Y >= 0)')
      },
      async ({ token, serial, x, y }) => {
        const startTime = Date.now();
        const session = this.pairingManager.getSession(token);
        const clientName = session?.clientName || 'Unauthenticated';

        // 1. Authorization Gatekeeper
        if (!this.pairingManager.isTierAllowed(token, 3)) {
          this.notifyActionAudit({
            action: 'tap',
            serial,
            clientName,
            status: 'REJECTED',
            details: `(${x}, ${y})`,
            error: 'Unauthorized: Tier 3 permission required'
          });
          return {
            isError: true,
            content: [{ type: 'text', text: 'Unauthorized: Operation requires an active paired session with Tier 3 (write:input) permission. Please call request_pairing first.' }]
          };
        }

        // 2. Serial Validation
        if (!SecurityValidator.isValidSerial(serial)) {
          this.notifyActionAudit({
            action: 'tap',
            serial,
            clientName,
            status: 'REJECTED',
            details: `(${x}, ${y})`,
            error: 'Invalid serial identifier format'
          });
          return {
            isError: true,
            content: [{ type: 'text', text: `Invalid device serial identifier format: "${serial}".` }]
          };
        }

        // 3. Device Attached & State Verification
        const devices = await this.deviceManager.getDevices();
        const target = devices.find(d => d.serial === serial);
        if (!target) {
          this.notifyActionAudit({
            action: 'tap',
            serial,
            clientName,
            status: 'FAILED',
            details: `(${x}, ${y})`,
            error: 'Target device not found or disconnected'
          });
          return {
            isError: true,
            content: [{ type: 'text', text: `Target device "${serial}" is not attached or was disconnected.` }]
          };
        }
        if (target.state !== 'device') {
          this.notifyActionAudit({
            action: 'tap',
            serial,
            clientName,
            status: 'FAILED',
            details: `(${x}, ${y})`,
            error: `Device is in state "${target.state}"`
          });
          return {
            isError: true,
            content: [{ type: 'text', text: `Device "${serial}" is in "${target.state}" state. Device must be authorized and ready ("device") to accept input.` }]
          };
        }

        // 4. Screen Bounds Validation
        const screenSize = await this.deviceManager.getScreenSize(serial);
        if (screenSize) {
          if (!SecurityValidator.isValidCoordinate(x, screenSize.width) || !SecurityValidator.isValidCoordinate(y, screenSize.height)) {
            const err = `Out-of-bounds coordinates: (${x}, ${y}) exceeds device screen dimensions (${screenSize.width}x${screenSize.height}).`;
            this.notifyActionAudit({
              action: 'tap',
              serial,
              clientName,
              status: 'REJECTED',
              details: `(${x}, ${y})`,
              error: err
            });
            return {
              isError: true,
              content: [{ type: 'text', text: err }]
            };
          }
        }

        // 5. Pre-dispatch authorization re-check (TOCTOU race defense)
        if (!this.pairingManager.isTierAllowed(token, 3)) {
          this.notifyActionAudit({
            action: 'tap',
            serial,
            clientName,
            status: 'REJECTED',
            details: `(${x}, ${y})`,
            error: 'Unauthorized: Session was revoked or expired prior to execution dispatch'
          });
          return {
            isError: true,
            content: [{ type: 'text', text: 'Unauthorized: Session was revoked or expired prior to execution dispatch.' }]
          };
        }

        // 6. Execute ADB tap
        try {
          const res = await this.deviceManager.executeAdb(['-s', serial, 'shell', 'input', 'tap', x.toString(), y.toString()], 5000);
          const durationMs = Date.now() - startTime;

          if (res.code !== 0 || (res.stderr && res.stderr.length > 0)) {
            const isMiuiSec = res.stderr.includes('INJECT_EVENTS') || res.stderr.includes('SecurityException');
            const errMsg = isMiuiSec
              ? 'Permission Denied: Android security settings require enabling "USB debugging (Security Settings)" in Developer Options to allow input event injection on this vendor ROM.'
              : `Tap execution failed: ${res.stderr || `Exit code ${res.code}`}`;

            this.notifyActionAudit({
              action: 'tap',
              serial,
              clientName,
              status: 'FAILED',
              details: `(${x}, ${y})`,
              durationMs,
              error: errMsg
            });

            return {
              isError: true,
              content: [{ type: 'text', text: errMsg }]
            };
          }

          this.notifyActionAudit({
            action: 'tap',
            serial,
            clientName,
            status: 'SUCCESS',
            details: `(${x}, ${y})`,
            durationMs
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  action: 'tap',
                  serial,
                  x,
                  y,
                  coordinates: { x, y },
                  durationMs,
                  status: 'completed'
                }, null, 2)
              }
            ]
          };
        } catch (err: any) {
          const durationMs = Date.now() - startTime;
          this.notifyActionAudit({
            action: 'tap',
            serial,
            clientName,
            status: 'FAILED',
            details: `(${x}, ${y})`,
            durationMs,
            error: err?.message || String(err)
          });
          return {
            isError: true,
            content: [{ type: 'text', text: `ADB execution error: ${err?.message || err}` }]
          };
        }
      }
    );

    /**
     * Tool 10: swipe (Tier 3 - write:input)
     */
    this.server.tool(
      'swipe',
      'Simulate a touchscreen drag/swipe gesture from (x1, y1) to (x2, y2) over durationMs. Requires Tier 3 paired session token.',
      {
        token: z.string().describe('Active paired session token with Tier 3 permission'),
        serial: z.string().describe('Target Android device serial identifier'),
        x1: z.number().int().min(0).describe('Starting horizontal coordinate'),
        y1: z.number().int().min(0).describe('Starting vertical coordinate'),
        x2: z.number().int().min(0).describe('Ending horizontal coordinate'),
        y2: z.number().int().min(0).describe('Ending vertical coordinate'),
        durationMs: z.number().int().min(50).max(10000).default(300).describe('Swipe duration in milliseconds (50ms - 10000ms)')
      },
      async ({ token, serial, x1, y1, x2, y2, durationMs }) => {
        const startTime = Date.now();
        const session = this.pairingManager.getSession(token);
        const clientName = session?.clientName || 'Unauthenticated';

        // 1. Authorization
        if (!this.pairingManager.isTierAllowed(token, 3)) {
          this.notifyActionAudit({
            action: 'swipe',
            serial,
            clientName,
            status: 'REJECTED',
            details: `(${x1},${y1})->(${x2},${y2}) ${durationMs}ms`,
            error: 'Unauthorized: Tier 3 permission required'
          });
          return {
            isError: true,
            content: [{ type: 'text', text: 'Unauthorized: Operation requires an active paired session with Tier 3 (write:input) permission.' }]
          };
        }

        // 2. Serial & Duration Validation
        if (!SecurityValidator.isValidSerial(serial)) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Invalid device serial identifier format: "${serial}".` }]
          };
        }
        if (!SecurityValidator.isValidSwipeDuration(durationMs)) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Invalid durationMs: ${durationMs}. Must be an integer between 50ms and 10000ms.` }]
          };
        }

        // 3. Device Connected Verification
        const devices = await this.deviceManager.getDevices();
        const target = devices.find(d => d.serial === serial);
        if (!target) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Target device "${serial}" is not attached or was disconnected.` }]
          };
        }
        if (target.state !== 'device') {
          return {
            isError: true,
            content: [{ type: 'text', text: `Device "${serial}" is in "${target.state}" state. Device must be authorized and ready ("device") to accept input.` }]
          };
        }

        // 4. Screen Bounds Validation
        const screenSize = await this.deviceManager.getScreenSize(serial);
        if (screenSize) {
          if (
            !SecurityValidator.isValidCoordinate(x1, screenSize.width) ||
            !SecurityValidator.isValidCoordinate(x2, screenSize.width) ||
            !SecurityValidator.isValidCoordinate(y1, screenSize.height) ||
            !SecurityValidator.isValidCoordinate(y2, screenSize.height)
          ) {
            const err = `Out-of-bounds swipe coordinates: (${x1}, ${y1}) -> (${x2}, ${y2}) exceeds screen dimensions (${screenSize.width}x${screenSize.height}).`;
            this.notifyActionAudit({
              action: 'swipe',
              serial,
              clientName,
              status: 'REJECTED',
              details: `(${x1},${y1})->(${x2},${y2}) ${durationMs}ms`,
              error: err
            });
            return {
              isError: true,
              content: [{ type: 'text', text: err }]
            };
          }
        }

        // 5. Pre-dispatch authorization re-check (TOCTOU race defense)
        if (!this.pairingManager.isTierAllowed(token, 3)) {
          this.notifyActionAudit({
            action: 'swipe',
            serial,
            clientName,
            status: 'REJECTED',
            details: `(${x1},${y1})->(${x2},${y2}) ${durationMs}ms`,
            error: 'Unauthorized: Session was revoked or expired prior to execution dispatch'
          });
          return {
            isError: true,
            content: [{ type: 'text', text: 'Unauthorized: Session was revoked or expired prior to execution dispatch.' }]
          };
        }

        // 6. Execute ADB swipe
        try {
          const timeout = Math.max(5000, durationMs + 3000);
          const res = await this.deviceManager.executeAdb(
            ['-s', serial, 'shell', 'input', 'swipe', x1.toString(), y1.toString(), x2.toString(), y2.toString(), durationMs.toString()],
            timeout
          );
          const elapsed = Date.now() - startTime;

          if (res.code !== 0 || (res.stderr && res.stderr.length > 0)) {
            const isMiuiSec = res.stderr.includes('INJECT_EVENTS') || res.stderr.includes('SecurityException');
            const errMsg = isMiuiSec
              ? 'Permission Denied: Android security settings require enabling "USB debugging (Security Settings)" in Developer Options to allow input event injection on this vendor ROM.'
              : `Swipe execution failed: ${res.stderr || `Exit code ${res.code}`}`;

            this.notifyActionAudit({
              action: 'swipe',
              serial,
              clientName,
              status: 'FAILED',
              details: `(${x1},${y1})->(${x2},${y2}) ${durationMs}ms`,
              durationMs: elapsed,
              error: errMsg
            });

            return {
              isError: true,
              content: [{ type: 'text', text: errMsg }]
            };
          }

          this.notifyActionAudit({
            action: 'swipe',
            serial,
            clientName,
            status: 'SUCCESS',
            details: `(${x1},${y1})->(${x2},${y2}) ${durationMs}ms`,
            durationMs: elapsed
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  action: 'swipe',
                  serial,
                  from: { x: x1, y: y1 },
                  to: { x: x2, y: y2 },
                  durationMs,
                  status: 'completed'
                }, null, 2)
              }
            ]
          };
        } catch (err: any) {
          const elapsed = Date.now() - startTime;
          return {
            isError: true,
            content: [{ type: 'text', text: `ADB swipe error: ${err?.message || err}` }]
          };
        }
      }
    );

    /**
     * Tool 11: keyevent (Tier 3 - write:input)
     */
    this.server.tool(
      'keyevent',
      'Simulate an Android hardware or navigation keyevent (e.g. 3=HOME, 4=BACK, 24=VOL_UP, 25=VOL_DOWN, 26=POWER, 82=MENU, 187=APP_SWITCH). Requires Tier 3 paired session token.',
      {
        token: z.string().describe('Active paired session token with Tier 3 permission'),
        serial: z.string().describe('Target Android device serial identifier'),
        keyCode: z.number().int().min(0).max(300).describe('Android keycode integer (0-300)')
      },
      async ({ token, serial, keyCode }) => {
        const startTime = Date.now();
        const session = this.pairingManager.getSession(token);
        const clientName = session?.clientName || 'Unauthenticated';

        // 1. Authorization
        if (!this.pairingManager.isTierAllowed(token, 3)) {
          this.notifyActionAudit({
            action: 'keyevent',
            serial,
            clientName,
            status: 'REJECTED',
            details: `keyCode: ${keyCode}`,
            error: 'Unauthorized: Tier 3 permission required'
          });
          return {
            isError: true,
            content: [{ type: 'text', text: 'Unauthorized: Operation requires an active paired session with Tier 3 (write:input) permission.' }]
          };
        }

        // 2. Serial & KeyCode Validation
        if (!SecurityValidator.isValidSerial(serial)) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Invalid device serial identifier format: "${serial}".` }]
          };
        }
        if (!SecurityValidator.isValidKeyCode(keyCode)) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Invalid keyCode: ${keyCode}. Keycode must be an integer between 0 and 300.` }]
          };
        }

        // 3. Device Connected Verification
        const devices = await this.deviceManager.getDevices();
        const target = devices.find(d => d.serial === serial);
        if (!target) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Target device "${serial}" is not attached or was disconnected.` }]
          };
        }
        if (target.state !== 'device') {
          return {
            isError: true,
            content: [{ type: 'text', text: `Device "${serial}" is in "${target.state}" state. Device must be authorized and ready ("device") to accept input.` }]
          };
        }

        // 4. Pre-dispatch authorization re-check (TOCTOU race defense)
        if (!this.pairingManager.isTierAllowed(token, 3)) {
          this.notifyActionAudit({
            action: 'keyevent',
            serial,
            clientName,
            status: 'REJECTED',
            details: `keyCode: ${keyCode}`,
            error: 'Unauthorized: Session was revoked or expired prior to execution dispatch'
          });
          return {
            isError: true,
            content: [{ type: 'text', text: 'Unauthorized: Session was revoked or expired prior to execution dispatch.' }]
          };
        }

        // 5. Execute ADB keyevent
        try {
          const res = await this.deviceManager.executeAdb(['-s', serial, 'shell', 'input', 'keyevent', keyCode.toString()], 5000);
          const durationMs = Date.now() - startTime;

          if (res.code !== 0 || (res.stderr && res.stderr.length > 0)) {
            const isMiuiSec = res.stderr.includes('INJECT_EVENTS') || res.stderr.includes('SecurityException');
            const errMsg = isMiuiSec
              ? 'Permission Denied: Android security settings require enabling "USB debugging (Security Settings)" in Developer Options to allow input event injection on this vendor ROM.'
              : `Keyevent execution failed: ${res.stderr || `Exit code ${res.code}`}`;

            this.notifyActionAudit({
              action: 'keyevent',
              serial,
              clientName,
              status: 'FAILED',
              details: `keyCode: ${keyCode}`,
              durationMs,
              error: errMsg
            });

            return {
              isError: true,
              content: [{ type: 'text', text: errMsg }]
            };
          }

          this.notifyActionAudit({
            action: 'keyevent',
            serial,
            clientName,
            status: 'SUCCESS',
            details: `keyCode: ${keyCode}`,
            durationMs
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  action: 'keyevent',
                  serial,
                  keyCode,
                  durationMs,
                  status: 'completed'
                }, null, 2)
              }
            ]
          };
        } catch (err: any) {
          const durationMs = Date.now() - startTime;
          return {
            isError: true,
            content: [{ type: 'text', text: `ADB keyevent error: ${err?.message || err}` }]
          };
        }
      }
    );

    /**
     * Tool 12: input_text (Tier 3 - write:input)
     */
    this.server.tool(
      'input_text',
      'Inject alphanumeric text into the currently focused input field on an Android device. Automatically encodes spaces as %s and strictly verifies safe ASCII printable characters to prevent corruption or shell injection. Requires Tier 3 paired session token.',
      {
        token: z.string().describe('Active paired session token with Tier 3 permission'),
        serial: z.string().describe('Target Android device serial identifier'),
        text: z.string().describe('Text string to enter (ASCII printable characters; spaces are automatically encoded as %s)')
      },
      async ({ token, serial, text }) => {
        const startTime = Date.now();
        const session = this.pairingManager.getSession(token);
        const clientName = session?.clientName || 'Unauthenticated';

        // 1. Authorization
        if (!this.pairingManager.isTierAllowed(token, 3)) {
          this.notifyActionAudit({
            action: 'input_text',
            serial,
            clientName,
            status: 'REJECTED',
            details: `[TEXT_INPUT: ${text.length} chars]`,
            error: 'Unauthorized: Tier 3 permission required'
          });
          return {
            isError: true,
            content: [{ type: 'text', text: 'Unauthorized: Operation requires an active paired session with Tier 3 (write:input) permission.' }]
          };
        }

        // 2. Serial Validation
        if (!SecurityValidator.isValidSerial(serial)) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Invalid device serial identifier format: "${serial}".` }]
          };
        }

        // 3. Text Sanitization & Encoding
        const sanitized = SecurityValidator.sanitizeInputText(text);
        if (!sanitized.valid || !sanitized.encoded) {
          this.notifyActionAudit({
            action: 'input_text',
            serial,
            clientName,
            status: 'REJECTED',
            details: `[TEXT_INPUT: ${text.length} chars]`,
            error: sanitized.error
          });
          return {
            isError: true,
            content: [{ type: 'text', text: sanitized.error || 'Text validation failed.' }]
          };
        }

        // 4. Device Connected Verification
        const devices = await this.deviceManager.getDevices();
        const target = devices.find(d => d.serial === serial);
        if (!target) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Target device "${serial}" is not attached or was disconnected.` }]
          };
        }
        if (target.state !== 'device') {
          return {
            isError: true,
            content: [{ type: 'text', text: `Device "${serial}" is in "${target.state}" state. Device must be authorized and ready ("device") to accept input.` }]
          };
        }

        // 5. Pre-dispatch authorization re-check (TOCTOU race defense)
        if (!this.pairingManager.isTierAllowed(token, 3)) {
          this.notifyActionAudit({
            action: 'input_text',
            serial,
            clientName,
            status: 'REJECTED',
            details: `[TEXT_INPUT: ${text.length} chars]`,
            error: 'Unauthorized: Session was revoked or expired prior to execution dispatch'
          });
          return {
            isError: true,
            content: [{ type: 'text', text: 'Unauthorized: Session was revoked or expired prior to execution dispatch.' }]
          };
        }

        // 6. Execute ADB input text
        try {
          const res = await this.deviceManager.executeAdb(['-s', serial, 'shell', 'input', 'text', sanitized.encoded], 5000);
          const durationMs = Date.now() - startTime;

          if (res.code !== 0 || (res.stderr && res.stderr.length > 0)) {
            const isMiuiSec = res.stderr.includes('INJECT_EVENTS') || res.stderr.includes('SecurityException');
            const errMsg = isMiuiSec
              ? 'Permission Denied: Android security settings require enabling "USB debugging (Security Settings)" in Developer Options to allow input event injection on this vendor ROM.'
              : `Input text execution failed: ${res.stderr || `Exit code ${res.code}`}`;

            this.notifyActionAudit({
              action: 'input_text',
              serial,
              clientName,
              status: 'FAILED',
              details: `[TEXT_INPUT: ${text.length} chars]`,
              durationMs,
              error: errMsg
            });

            return {
              isError: true,
              content: [{ type: 'text', text: errMsg }]
            };
          }

          // Successful execution (Notice: we do NOT log the raw text in audit logs to preserve sensitive data/passwords!)
          this.notifyActionAudit({
            action: 'input_text',
            serial,
            clientName,
            status: 'SUCCESS',
            details: `[TEXT_INPUT: ${text.length} chars]`,
            durationMs
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  action: 'input_text',
                  serial,
                  charactersInjected: text.length,
                  length: text.length,
                  durationMs,
                  status: 'completed'
                }, null, 2)
              }
            ]
          };
        } catch (err: any) {
          const durationMs = Date.now() - startTime;
          return {
            isError: true,
            content: [{ type: 'text', text: `ADB input text error: ${err?.message || err}` }]
          };
        }
      }
    );
  }
}
