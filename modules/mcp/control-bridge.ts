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
 * Enforces maximum message size and message structure validation to prevent memory exhaustion.
 */
export class NdjsonFramer extends EventEmitter {
  private buffer = '';
  private maxMessageBytes: number;

  constructor(maxMessageBytes = 1024 * 1024) {
    super();
    this.maxMessageBytes = maxMessageBytes;
  }

  public handleData(chunk: Buffer | string): void {
    this.buffer += chunk.toString('utf8');

    // Memory exhaustion protection: drop buffer if oversized without newline
    if (this.buffer.length > this.maxMessageBytes) {
      this.emit(
        'parseError',
        new Error(`Message payload exceeded limit of ${this.maxMessageBytes} bytes`),
        this.buffer.slice(0, 256)
      );
      this.buffer = '';
      return;
    }

    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        if (line.length > this.maxMessageBytes) {
          this.emit(
            'parseError',
            new Error(`Message line exceeded limit of ${this.maxMessageBytes} bytes`),
            line.slice(0, 256)
          );
        } else {
          try {
            const parsed = JSON.parse(line);
            // Protocol schema guard: must be a non-null object with a valid string type property
            if (
              parsed &&
              typeof parsed === 'object' &&
              !Array.isArray(parsed) &&
              typeof parsed.type === 'string' &&
              parsed.type.length > 0
            ) {
              this.emit('message', parsed);
            } else {
              this.emit(
                'parseError',
                new Error('Invalid message shape: expected JSON object with non-empty string type property'),
                line
              );
            }
          } catch (err) {
            this.emit('parseError', err, line);
          }
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

  public connect(timeoutMs = 5000): Promise<boolean> {
    return new Promise(resolve => {
      if (this.connected || this.socket) {
        return resolve(true);
      }

      this.closedExplicitly = false;
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (sock) {
            try {
              sock.destroy();
            } catch {
              // ignore
            }
          }
          this.connected = false;
          this.socket = null;
          resolve(false);
        }
      }, timeoutMs);

      const sock = net.connect(this.pipePath, () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
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
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        this.connected = false;
        this.socket = null;
        resolve(false);
      });

      sock.on('close', () => {
        clearTimeout(timer);
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

  public sendActionAudit(audit: any): boolean {
    return this.send(audit);
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
      this.socket.removeAllListeners();
      try {
        this.socket.destroy();
      } catch {
        // ignore
      }
      this.socket = null;
      this.connected = false;
    }
    this.framer.removeAllListeners();
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
  private recentAudits: any[] = [];

  public static readonly MAX_CLIENTS = 10;
  public static readonly MAX_PENDING_REQUESTS = 25;
  public static readonly MAX_AUDIT_LOGS = 50;

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
    recentAudits?: any[];
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
      activeSessions: Array.from(this.activeSessions.values()),
      recentAudits: this.recentAudits.slice(0, 25)
    };
  }

  public getRecentAudits(): any[] {
    return [...this.recentAudits];
  }

  private handleClientConnection(socket: net.Socket): void {
    // Bound total concurrent connected clients to prevent denial-of-service
    if (this.clients.size >= McpControlServer.MAX_CLIENTS) {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      this.emit('connectionRejected', 'Max client connections reached');
      return;
    }

    this.clients.add(socket);
    this.emit('clientConnected', this.clients.size);

    const framer = new NdjsonFramer();
    const dataHandler = (chunk: Buffer | string) => framer.handleData(chunk);
    const messageHandler = (msg: McpIpcMessage) => {
      this.handleClientMessage(socket, msg);
    };

    const cleanup = () => {
      socket.removeListener('data', dataHandler);
      socket.removeListener('error', cleanup);
      socket.removeListener('close', cleanup);
      framer.removeListener('message', messageHandler);
      framer.removeAllListeners();
      this.clients.delete(socket);
      this.emit('clientDisconnected', this.clients.size);
    };

    socket.on('data', dataHandler);
    framer.on('message', messageHandler);
    socket.on('error', cleanup);
    socket.on('close', cleanup);
  }

  private handleClientMessage(socket: net.Socket, msg: McpIpcMessage): void {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
      return;
    }

    switch (msg.type) {
      case 'MCP_HELLO':
        this.emit('mcpHello', msg);
        break;
      case 'PAIRING_REQUEST': {
        // Validate required fields and field types
        if (
          typeof msg.requestId !== 'string' || !msg.requestId ||
          typeof msg.clientName !== 'string' || !msg.clientName ||
          typeof msg.requestedTier !== 'number' ||
          typeof msg.pin !== 'string' || !msg.pin
        ) {
          return;
        }

        // Prune expired requests
        const now = Date.now();
        for (const [id, r] of this.pendingRequests.entries()) {
          if (now > r.expiresAt) {
            this.pendingRequests.delete(id);
          }
        }

        // Enforce maximum pending requests limit
        if (this.pendingRequests.size >= McpControlServer.MAX_PENDING_REQUESTS) {
          this.emit('error', new Error('Max pending pairing requests limit reached'));
          return;
        }

        const req: PendingPairingRequest = {
          requestId: msg.requestId,
          pin: msg.pin,
          clientName: msg.clientName,
          requestedTier: msg.requestedTier as any,
          createdAt: typeof msg.createdAt === 'number' ? msg.createdAt : now,
          expiresAt: typeof msg.expiresAt === 'number' ? msg.expiresAt : (now + 60000),
          attempts: 0,
          status: 'PENDING'
        };
        this.pendingRequests.set(msg.requestId, req);
        this.emit('pairingRequested', req);
        break;
      }
      case 'SESSION_CREATED': {
        if (
          typeof msg.sessionId !== 'string' || !msg.sessionId ||
          typeof msg.expiresAt !== 'number' ||
          !Array.isArray(msg.tiers)
        ) {
          return;
        }

        const session: PairingSession = {
          sessionId: msg.sessionId,
          token: '[REDACTED]', // Desktop does not store raw secrets
          createdAt: Date.now(),
          expiresAt: msg.expiresAt,
          tiers: msg.tiers as any,
          clientName: typeof msg.clientName === 'string' ? msg.clientName : 'AI-Client'
        };
        this.activeSessions.set(msg.sessionId, session);
        this.emit('sessionCreated', session);
        break;
      }
      case 'ACTION_AUDIT': {
        if (
          typeof msg.action !== 'string' ||
          typeof msg.serial !== 'string' ||
          typeof msg.status !== 'string'
        ) {
          return;
        }
        this.recentAudits.unshift(msg);
        if (this.recentAudits.length > McpControlServer.MAX_AUDIT_LOGS) {
          this.recentAudits.pop();
        }
        this.emit('actionAudit', msg);
        break;
      }
      default:
        break;
    }
  }
}
