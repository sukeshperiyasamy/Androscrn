import crypto from 'crypto';
import { PairingSession, PendingPairingRequest, PermissionTier, IControlBridge } from './types';

/**
 * PairingManager enforces the Pairing-First Security Model for external AI clients.
 * - Tier 0 (read:telemetry): Always permitted.
 * - Tier 1 (read:logs): Always permitted with sensitive data redaction.
 * - Tier 2 (read:screen): Permitted for visual inspection.
 * - Tier 3 (write:input): Requires a paired session via Human-in-the-Loop (HITL) approval.
 * - Tier 4 (write:admin): Requires explicit human interactive approval.
 */
export class PairingManager {
  private pendingRequests: Map<string, PendingPairingRequest> = new Map();
  private activeSessions: Map<string, PairingSession> = new Map();
  private pinTtlMs: number;
  private sessionTtlMs: number;
  private controlBridge?: IControlBridge;

  constructor(pinTtlMs = 60000, sessionTtlMs = 30 * 60 * 1000, controlBridge?: IControlBridge) {
    this.pinTtlMs = pinTtlMs;
    this.sessionTtlMs = sessionTtlMs;
    this.controlBridge = controlBridge;

    if (this.controlBridge) {
      this.controlBridge.onPairingDecision((requestId, decision) => {
        if (decision === 'APPROVED') {
          this.approveRequest(requestId);
        } else {
          this.denyRequest(requestId);
        }
      });

      this.controlBridge.onRevokeSession(sessionId => {
        this.revokeSession(sessionId);
      });

      this.controlBridge.onRevokeAll(() => {
        this.revokeAllSessions();
      });
    }
  }

  public setControlBridge(bridge: IControlBridge): void {
    this.controlBridge = bridge;
    this.controlBridge.onPairingDecision((requestId, decision) => {
      if (decision === 'APPROVED') {
        this.approveRequest(requestId);
      } else {
        this.denyRequest(requestId);
      }
    });

    this.controlBridge.onRevokeSession(sessionId => {
      this.revokeSession(sessionId);
    });

    this.controlBridge.onRevokeAll(() => {
      this.revokeAllSessions();
    });
  }

  /**
   * Registers a new pairing request and notifies the trusted Desktop UI.
   * NOTE: The PIN is generated and sent to the desktop UI, but NOT returned to the MCP client.
   */
  public async requestPairing(
    clientName = 'AI-Client',
    requestedTier: PermissionTier = 3
  ): Promise<{ requestId?: string; expiresInSeconds?: number; error?: string }> {
    // If control bridge is configured but disconnected, reject
    if (this.controlBridge && !this.controlBridge.isConnected()) {
      return {
        error: 'Pairing unavailable: AndroScrn desktop application is not connected. Human-in-the-loop pairing requires an active desktop session.'
      };
    }

    const requestId = crypto.randomUUID();
    const pin = crypto.randomInt(100000, 999999).toString();
    const now = Date.now();

    const request: PendingPairingRequest = {
      requestId,
      pin,
      clientName,
      requestedTier,
      createdAt: now,
      expiresAt: now + this.pinTtlMs,
      attempts: 0,
      status: 'PENDING'
    };

    this.pendingRequests.set(requestId, request);

    if (this.controlBridge) {
      const delivered = await this.controlBridge.sendPairingRequest(request);
      if (!delivered && !this.controlBridge.isConnected()) {
        this.pendingRequests.delete(requestId);
        return {
          error: 'Failed to deliver pairing request to AndroScrn desktop. Make sure the desktop workbench is open.'
        };
      }
    }

    return {
      requestId,
      expiresInSeconds: Math.floor(this.pinTtlMs / 1000)
    };
  }

  /**
   * Approves a pending pairing request (called by Desktop UI).
   */
  public approveRequest(requestId: string): boolean {
    const req = this.pendingRequests.get(requestId);
    if (!req) return false;

    if (Date.now() > req.expiresAt) {
      this.pendingRequests.delete(requestId);
      return false;
    }

    req.status = 'APPROVED';
    return true;
  }

  /**
   * Denies a pending pairing request (called by Desktop UI).
   */
  public denyRequest(requestId: string): boolean {
    const req = this.pendingRequests.get(requestId);
    if (!req) return false;

    req.status = 'DENIED';
    return true;
  }

  /**
   * Exchanges an approved requestId (or a correct out-of-band PIN) for an authorized session token.
   */
  public pairSession(
    requestId: string,
    pin?: string,
    clientName?: string
  ): { success: boolean; token?: string; error?: string } {
    const req = this.pendingRequests.get(requestId);
    if (!req) {
      return { success: false, error: 'Invalid or expired pairing requestId. Call request_pairing first.' };
    }

    if (Date.now() > req.expiresAt) {
      this.pendingRequests.delete(requestId);
      return { success: false, error: 'Pairing request has expired. Request a new pairing session.' };
    }

    if (req.status === 'DENIED') {
      this.pendingRequests.delete(requestId);
      return { success: false, error: 'Pairing request was denied by the user in the desktop application.' };
    }

    let authorized = false;

    // Path A: Desktop user approved via UI button
    if (req.status === 'APPROVED') {
      authorized = true;
    }
    // Path B: Out-of-band PIN verification
    else if (pin) {
      req.attempts++;
      if (req.attempts > 3) {
        this.pendingRequests.delete(requestId);
        return { success: false, error: 'Too many incorrect PIN attempts. Pairing request has been invalidated.' };
      }

      if (req.pin === pin.trim()) {
        authorized = true;
      } else {
        return { success: false, error: `Invalid PIN. ${4 - req.attempts} attempt(s) remaining.` };
      }
    } else {
      return {
        success: false,
        error: 'Pairing request is pending user approval in the desktop application, or the 6-digit PIN displayed on the desktop screen must be provided.'
      };
    }

    if (!authorized) {
      return { success: false, error: 'Pairing authorization failed.' };
    }

    // Success: Generate session token
    const token = crypto.randomBytes(32).toString('hex');
    const sessionId = crypto.randomUUID();
    const now = Date.now();

    const session: PairingSession = {
      sessionId,
      token,
      createdAt: now,
      expiresAt: now + this.sessionTtlMs,
      tiers: [0, 1, 2, req.requestedTier],
      clientName: clientName || req.clientName
    };

    this.activeSessions.set(token, session);
    this.pendingRequests.delete(requestId); // Request consumed

    return { success: true, token };
  }

  /**
   * Validates if a token is active and has the required permission tier.
   */
  public isTierAllowed(token: string | undefined, tier: PermissionTier): boolean {
    // Read-only telemetry, redacted logs, and screen capture are Tier 0, 1, 2
    if (tier <= 2) {
      return true;
    }

    if (!token) {
      return false;
    }

    const session = this.activeSessions.get(token);
    if (!session) {
      return false;
    }

    if (Date.now() > session.expiresAt) {
      this.activeSessions.delete(token);
      return false;
    }

    return session.tiers.includes(tier);
  }

  /**
   * Emergency Kill Switch: Revokes all active tokens immediately.
   */
  public revokeAllSessions(): void {
    this.activeSessions.clear();
    this.pendingRequests.clear();
  }

  /**
   * Revokes a specific session token or sessionId.
   */
  public revokeSession(tokenOrSessionId: string): boolean {
    // Check by token
    if (this.activeSessions.has(tokenOrSessionId)) {
      return this.activeSessions.delete(tokenOrSessionId);
    }

    // Check by sessionId
    for (const [token, session] of this.activeSessions.entries()) {
      if (session.sessionId === tokenOrSessionId) {
        return this.activeSessions.delete(token);
      }
    }

    return false;
  }

  /**
   * Returns list of currently active non-expired sessions.
   */
  public getActiveSessions(): PairingSession[] {
    const now = Date.now();
    const valid: PairingSession[] = [];
    for (const [token, session] of this.activeSessions.entries()) {
      if (now <= session.expiresAt) {
        valid.push(session);
      } else {
        this.activeSessions.delete(token);
      }
    }
    return valid;
  }

  /**
   * Returns list of currently pending pairing requests.
   */
  public getPendingRequests(): PendingPairingRequest[] {
    const now = Date.now();
    const valid: PendingPairingRequest[] = [];
    for (const [id, req] of this.pendingRequests.entries()) {
      if (now <= req.expiresAt) {
        valid.push(req);
      } else {
        this.pendingRequests.delete(id);
      }
    }
    return valid;
  }
}
