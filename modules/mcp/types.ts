/**
 * AndroScrn Model Context Protocol (MCP) Type Definitions
 */

export type PermissionTier = 0 | 1 | 2 | 3 | 4;

export interface PermissionScope {
  tier: PermissionTier;
  name: 'read:telemetry' | 'read:logs' | 'read:screen' | 'write:input' | 'write:admin';
  description: string;
}

export interface PairingSession {
  sessionId: string;
  token: string;
  createdAt: number;
  expiresAt: number;
  tiers: PermissionTier[];
  clientName?: string;
}

export type PairingRequestStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';

export interface PendingPairingRequest {
  requestId: string;
  pin: string;
  clientName: string;
  requestedTier: PermissionTier;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  status: PairingRequestStatus;
}

export interface IControlBridge {
  isConnected(): boolean;
  sendPairingRequest(request: PendingPairingRequest): Promise<boolean>;
  onPairingDecision(handler: (requestId: string, decision: 'APPROVED' | 'DENIED') => void): void;
  onRevokeSession(handler: (sessionId: string) => void): void;
  onRevokeAll(handler: () => void): void;
}

export interface McpServerConfig {
  name?: string;
  version?: string;
  adbPath?: string;
  capturesDir?: string;
  sessionTtlMs?: number;
  pinTtlMs?: number;
  controlBridge?: IControlBridge;
}
