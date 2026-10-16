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

export interface PendingPairingRequest {
  pin: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
}

export interface McpServerConfig {
  name?: string;
  version?: string;
  adbPath?: string;
  capturesDir?: string;
  sessionTtlMs?: number;
  pinTtlMs?: number;
}
