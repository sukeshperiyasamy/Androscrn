/**
 * AndroScrn Named Pipe Control IPC Protocol
 * Connects the Electron Desktop Workbench (Server) to standalone MCP Process(es) (Client).
 */

export const ANDROSCRN_PIPE_NAME = '\\\\.\\pipe\\androscrn-mcp-control';

export type McpIpcMessageType =
  | 'MCP_HELLO'
  | 'PAIRING_REQUEST'
  | 'PAIRING_DECISION'
  | 'SESSION_CREATED'
  | 'REVOKE_SESSION'
  | 'REVOKE_ALL_SESSIONS'
  | 'GET_STATUS_REQUEST'
  | 'GET_STATUS_RESPONSE'
  | 'ACTION_AUDIT'
  | 'PING'
  | 'PONG';

export interface BaseMcpIpcMessage {
  type: McpIpcMessageType;
  timestamp: number;
}

export interface McpHelloMessage extends BaseMcpIpcMessage {
  type: 'MCP_HELLO';
  pid: number;
  serverName: string;
  version: string;
}

export interface PairingRequestIpcMessage extends BaseMcpIpcMessage {
  type: 'PAIRING_REQUEST';
  requestId: string;
  clientName: string;
  requestedTier: number;
  pin: string;
  createdAt: number;
  expiresAt: number;
}

export interface PairingDecisionIpcMessage extends BaseMcpIpcMessage {
  type: 'PAIRING_DECISION';
  requestId: string;
  decision: 'APPROVED' | 'DENIED';
}

export interface SessionCreatedIpcMessage extends BaseMcpIpcMessage {
  type: 'SESSION_CREATED';
  sessionId: string;
  clientName: string;
  tiers: number[];
  expiresAt: number;
}

export interface RevokeSessionIpcMessage extends BaseMcpIpcMessage {
  type: 'REVOKE_SESSION';
  sessionId: string;
}

export interface RevokeAllSessionsIpcMessage extends BaseMcpIpcMessage {
  type: 'REVOKE_ALL_SESSIONS';
}

export interface GetStatusRequestIpcMessage extends BaseMcpIpcMessage {
  type: 'GET_STATUS_REQUEST';
}

export interface GetStatusResponseIpcMessage extends BaseMcpIpcMessage {
  type: 'GET_STATUS_RESPONSE';
  connectedClients: number;
  activeSessions: Array<{
    sessionId: string;
    clientName: string;
    tiers: number[];
    expiresAt: number;
  }>;
  pendingRequests: Array<{
    requestId: string;
    clientName: string;
    requestedTier: number;
    pin: string;
    expiresAt: number;
  }>;
}

export interface ActionAuditIpcMessage extends BaseMcpIpcMessage {
  type: 'ACTION_AUDIT';
  actionId: string;
  action: 'tap' | 'swipe' | 'keyevent' | 'input_text';
  serial: string;
  clientName: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'REJECTED';
  details?: string;
  durationMs?: number;
  error?: string;
}

export interface PingIpcMessage extends BaseMcpIpcMessage {
  type: 'PING';
}

export interface PongIpcMessage extends BaseMcpIpcMessage {
  type: 'PONG';
}

export type McpIpcMessage =
  | McpHelloMessage
  | PairingRequestIpcMessage
  | PairingDecisionIpcMessage
  | SessionCreatedIpcMessage
  | RevokeSessionIpcMessage
  | RevokeAllSessionsIpcMessage
  | GetStatusRequestIpcMessage
  | GetStatusResponseIpcMessage
  | ActionAuditIpcMessage
  | PingIpcMessage
  | PongIpcMessage;
