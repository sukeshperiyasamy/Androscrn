import net from 'net';
import { EventEmitter } from 'events';
import {
  ANDROSCRN_PIPE_NAME,
  McpIpcMessage,
  PairingRequestIpcMessage,
  PairingDecisionIpcMessage,
  SessionCreatedIpcMessage,
  RevokeSessionIpcMessage,
  RevokeAllSessionsIpcMessage,
  GetStatusResponseIpcMessage
} from './ipc-types';
import { IControlBridge, PendingPairingRequest, PairingSession } from './types';

/**
 * Message framer: Serializes objects to newline-delimited JSON and parses incoming chunks.
 */
export class NdjsonFramer extends EventEmitter {
  private buffer = '';

  public handleData(chunk: Buffer | string): void {
    this.buffer += chunk.toString('utf8');
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        try {
          const parsed = JSON.parse(line);
          this.emit('message', parsed);
        } catch (err) {
          this.emit('parseError', err, line);
        }
      }
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  public static format(msg: McpIpcMessage): string {
    return JSON.stringify(msg) + '\n';
  }
}

/**
 * McpControlClient - Runs inside the standalone MCP Process.
 * Connects to the Electron Desktop Workbench over Windows Named Pipe.
 */
export class McpControlClient extends EventEmitter implements IControlBridge {
  private socket: net.Socket | null = null;
  private framer: NdjsonFramer = new NdjsonFramer();
  private pipePath: string;
  private connected = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closedExplicitly = false;

  constructor(pipePath = ANDROSCRN_PIPE_NAME) {
    super();
    this.pipePath = pipePath;

    this.framer.on('message', (msg: McpIpcMessage) => {
      this.handleIncomingMessage(msg);
    });
  }

  public connect(): Promise<boolean> {
    return new Promise(resolve => {
      if (this.connected || this.socket) {
        return resolve(true);
      }

      this.closedExplicitly = false;
      const sock = net.connect(this.pipePath, () => {
        this.socket = sock;
        this.connected = true;
        this.emit('connected');

        // Send Hello
        this.send({
          type: 'MCP_HELLO',
          pid: process.pid,
          serverName: 'androscrn-mcp',
          version: '1.0.0',
          timestamp: Date.now()
        });

        resolve(true);
      });

      sock.on('data', chunk => {
        this.framer.handleData(chunk);
      });

      sock.on('error', err => {
        this.connected = false;
        this.socket = null;
        resolve(false);
      });

      sock.on('close', () => {
        const wasConnected = this.connected;
        this.connected = false;
        this.socket = null;
        if (wasConnected) {
          this.emit('disconnected');
        }
        if (!this.closedExplicitly) {
          this.scheduleReconnect();
        }
      });
    });
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public send(msg: McpIpcMessage): boolean {
    if (!this.socket || !this.connected) {
      return false;
    }
    try {
      this.socket.write(NdjsonFramer.format(msg));
      return true;
    } catch {
      return false;
    }
  }

  public async sendPairingRequest(request: PendingPairingRequest): Promise<boolean> {
    const msg: PairingRequestIpcMessage = {
      type: 'PAIRING_REQUEST',
      requestId: request.requestId,
      clientName: request.clientName,
      requestedTier: request.requestedTier,
      pin: request.pin,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      timestamp: Date.now()
    };

    return this.send(msg);
  }

  public onPairingDecision(handler: (requestId: string, decision: 'APPROVED' | 'DENIED') => void): void {
    this.on('pairingDecision', handler);
  }

  public onRevokeSession(handler: (sessionId: string) => void): void {
    this.on('revokeSession', handler);
  }

  public onRevokeAll(handler: () => void): void {
    this.on('revokeAll', handler);
  }

  private handleIncomingMessage(msg: McpIpcMessage): void {
    switch (msg.type) {
      case 'PAIRING_DECISION':
        this.emit('pairingDecision', msg.requestId, msg.decision);
        break;
      case 'REVOKE_SESSION':
        this.emit('revokeSession', msg.sessionId);
        break;
      case 'REVOKE_ALL_SESSIONS':
        this.emit('revokeAll');
        break;
      case 'PING':
        this.send({ type: 'PONG', timestamp: Date.now() });
        break;
      default:
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedExplicitly) {
        this.connect().catch(() => {});
      }
    }, 2000);
  }

  public close(): void {
    this.closedExplicitly = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
      this.connected = false;
    }
  }
}

/**
 * McpControlServer - Runs inside the Electron Main Process.
 * Listens on the Windows Named Pipe and coordinates user approvals / revocations.
 */
export class McpControlServer extends EventEmitter {
  private server: net.Server | null = null;
  private pipePath: string;
  private clients: Set<net.Socket> = new Set();
  private pendingRequests: Map<string, PendingPairingRequest> = new Map();
  private activeSessions: Map<string, PairingSession> = new Map();

  constructor(pipePath = ANDROSCRN_PIPE_NAME) {
    super();
    this.pipePath = pipePath;
  }

  public start(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      try {
        const s = net.createServer(socket => {
          this.handleClientConnection(socket);
        });

        s.on('error', err => {
          this.emit('error', err);
          reject(err);
        });

        s.listen(this.pipePath, () => {
          this.server = s;
          this.emit('listening', this.pipePath);
          resolve(true);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  public stop(): Promise<void> {
    return new Promise(resolve => {
      for (const client of this.clients) {
        try {
          client.destroy();
        } catch {
          // ignore
        }
      }
      this.clients.clear();

      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  public broadcast(msg: McpIpcMessage): void {
    const data = NdjsonFramer.format(msg);
    for (const client of this.clients) {
      try {
        client.write(data);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  public approveRequest(requestId: string): boolean {
    const req = this.pendingRequests.get(requestId);
    if (!req) return false;

    req.status = 'APPROVED';
    this.broadcast({
      type: 'PAIRING_DECISION',
      requestId,
      decision: 'APPROVED',
      timestamp: Date.now()
    });

    this.emit('decisionMade', requestId, 'APPROVED');
    return true;
  }

  public denyRequest(requestId: string): boolean {
    const req = this.pendingRequests.get(requestId);
    if (!req) return false;

    req.status = 'DENIED';
    this.broadcast({
      type: 'PAIRING_DECISION',
      requestId,
      decision: 'DENIED',
      timestamp: Date.now()
    });

    this.pendingRequests.delete(requestId);
    this.emit('decisionMade', requestId, 'DENIED');
    return true;
  }

  public revokeSession(sessionId: string): boolean {
    this.activeSessions.delete(sessionId);
    this.broadcast({
      type: 'REVOKE_SESSION',
      sessionId,
      timestamp: Date.now()
    });

    this.emit('sessionRevoked', sessionId);
    return true;
  }

  public revokeAllSessions(): void {
    this.activeSessions.clear();
    this.pendingRequests.clear();
    this.broadcast({
      type: 'REVOKE_ALL_SESSIONS',
      timestamp: Date.now()
    });

    this.emit('allSessionsRevoked');
  }

  public getStatus(): {
    connectedMcpProcesses: number;
    pendingRequests: PendingPairingRequest[];
    activeSessions: PairingSession[];
  } {
    const now = Date.now();
    // Prune expired
    for (const [id, req] of this.pendingRequests.entries()) {
      if (now > req.expiresAt) {
        this.pendingRequests.delete(id);
      }
    }
    for (const [id, session] of this.activeSessions.entries()) {
      if (now > session.expiresAt) {
        this.activeSessions.delete(id);
      }
    }

    return {
      connectedMcpProcesses: this.clients.size,
      pendingRequests: Array.from(this.pendingRequests.values()),
      activeSessions: Array.from(this.activeSessions.values())
    };
  }

  private handleClientConnection(socket: net.Socket): void {
    this.clients.add(socket);
    this.emit('clientConnected', this.clients.size);

    const framer = new NdjsonFramer();
    socket.on('data', chunk => framer.handleData(chunk));

    framer.on('message', (msg: McpIpcMessage) => {
      this.handleClientMessage(socket, msg);
    });

    socket.on('error', () => {
      this.clients.delete(socket);
      this.emit('clientDisconnected', this.clients.size);
    });

    socket.on('close', () => {
      this.clients.delete(socket);
      this.emit('clientDisconnected', this.clients.size);
    });
  }

  private handleClientMessage(socket: net.Socket, msg: McpIpcMessage): void {
    switch (msg.type) {
      case 'MCP_HELLO':
        this.emit('mcpHello', msg);
        break;
      case 'PAIRING_REQUEST': {
        const req: PendingPairingRequest = {
          requestId: msg.requestId,
          pin: msg.pin,
          clientName: msg.clientName,
          requestedTier: msg.requestedTier as any,
          createdAt: msg.createdAt,
          expiresAt: msg.expiresAt,
          attempts: 0,
          status: 'PENDING'
        };
        this.pendingRequests.set(msg.requestId, req);
        this.emit('pairingRequested', req);
        break;
      }
      case 'SESSION_CREATED': {
        const session: PairingSession = {
          sessionId: msg.sessionId,
          token: '[REDACTED]', // Desktop does not store raw secrets
          createdAt: Date.now(),
          expiresAt: msg.expiresAt,
          tiers: msg.tiers as any,
          clientName: msg.clientName
        };
        this.activeSessions.set(msg.sessionId, session);
        this.emit('sessionCreated', session);
        break;
      }
      default:
        break;
    }
  }
}
