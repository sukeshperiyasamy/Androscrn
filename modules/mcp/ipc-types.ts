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
  | PingIpcMessage
  | PongIpcMessage;
