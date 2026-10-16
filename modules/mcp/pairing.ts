import crypto from 'crypto';
import { PairingSession, PendingPairingRequest, PermissionTier } from './types';

/**
 * PairingManager enforces the Pairing-First Security Model for external AI clients.
 * - Tier 0 (read:telemetry): Always permitted.
 * - Tier 1 (read:logs): Always permitted with sensitive data redaction.
 * - Tier 2 (read:screen): Permitted for visual inspection.
 * - Tier 3 (write:input): Requires a paired session via 6-digit PIN handshake.
 * - Tier 4 (write:admin): Requires explicit human interactive approval.
 */
export class PairingManager {
  private pendingPin: PendingPairingRequest | null = null;
  private activeSessions: Map<string, PairingSession> = new Map();
  private pinTtlMs: number;
  private sessionTtlMs: number;

  constructor(pinTtlMs = 60000, sessionTtlMs = 30 * 60 * 1000) {
    this.pinTtlMs = pinTtlMs;
    this.sessionTtlMs = sessionTtlMs;
  }

  /**
   * Generates a new 6-digit numeric pairing PIN with a 60-second TTL.
   */
  public requestPin(): { pin: string; expiresInSeconds: number } {
    const pin = crypto.randomInt(100000, 999999).toString();
    const now = Date.now();
    this.pendingPin = {
      pin,
      createdAt: now,
      expiresAt: now + this.pinTtlMs,
      attempts: 0
    };

    return {
      pin,
      expiresInSeconds: Math.floor(this.pinTtlMs / 1000)
    };
  }

  /**
   * Exchanges a 6-digit PIN for an authorized session token.
   */
  public pairSession(pin: string, clientName = 'AI-Client'): { success: boolean; token?: string; error?: string } {
    if (!this.pendingPin) {
      return { success: false, error: 'No pairing PIN has been requested. Call request_pairing first.' };
    }

    if (Date.now() > this.pendingPin.expiresAt) {
      this.pendingPin = null;
      return { success: false, error: 'Pairing PIN has expired. Request a new PIN.' };
    }

    this.pendingPin.attempts++;
    if (this.pendingPin.attempts > 3) {
      this.pendingPin = null;
      return { success: false, error: 'Too many incorrect attempts. Pairing PIN has been invalidated.' };
    }

    if (this.pendingPin.pin !== pin.trim()) {
      return { success: false, error: `Invalid PIN. ${4 - this.pendingPin.attempts} attempt(s) remaining.` };
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
      tiers: [0, 1, 2, 3], // Paired sessions grant up to Tier 3 (input actions)
      clientName
    };

    this.activeSessions.set(token, session);
    this.pendingPin = null; // PIN consumed

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
    this.pendingPin = null;
  }

  /**
   * Revokes a specific session token.
   */
  public revokeSession(token: string): boolean {
    return this.activeSessions.delete(token);
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
}
