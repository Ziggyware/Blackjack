import type { ClientMsg, ServerMsg } from '@velvet/shared';
import { LocalConnection } from './local.js';

export type ConnKind = 'remote' | 'local';
export type ConnState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'offline';

export interface Connection {
  kind: ConnKind;
  send(msg: ClientMsg): void;
  close(): void;
}

export interface ConnectOpts {
  onMessage: (msg: ServerMsg) => void;
  onState?: (kind: ConnKind, state: ConnState, latency?: number) => void;
  /** give up on the room server after this long and run the engine in-browser */
  timeoutMs?: number;
}

function socketUrl(): string {
  const proto = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws';
  const host = typeof location !== 'undefined' ? location.host : 'localhost:5173';
  return `${proto}://${host}/ws`;
}

class RemoteConnection implements Connection {
  readonly kind = 'remote' as const;
  private ws: WebSocket | null = null;
  private queue: ClientMsg[] = [];
  private closed = false;
  private attempts = 0;
  private backoff = 600;
  private lastPing = 0;

  constructor(private opts: ConnectOpts) {}

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('closed'));
      let settled = false;
      const ws = new WebSocket(socketUrl());
      this.ws = ws;
      this.opts.onState?.('remote', this.attempts === 0 ? 'connecting' : 'reconnecting');

      ws.onopen = () => {
        settled = true;
        this.attempts = 0;
        this.backoff = 600;
        this.opts.onState?.('remote', 'open');
        for (const m of this.queue.splice(0)) this.raw(m);
        this.startHeartbeat();
        resolve();
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as ServerMsg;
          if (msg.type === 'pong') {
            this.opts.onState?.('remote', 'open', Date.now() - msg.t);
            return;
          }
          this.opts.onMessage(msg);
        } catch { /* ignore malformed frames */ }
      };
      ws.onerror = () => { if (!settled) { settled = true; reject(new Error('socket error')); } };
      ws.onclose = () => {
        this.stopHeartbeat();
        if (this.closed) return;
        this.opts.onState?.('remote', 'reconnecting');
        this.attempts += 1;
        const delay = Math.min(8000, this.backoff * Math.pow(1.6, this.attempts - 1));
        setTimeout(() => { if (!this.closed) void this.open().catch(() => { /* retried below */ }); }, delay);
      };
    });
  }

  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      this.lastPing = Date.now();
      this.raw({ type: 'ping', t: this.lastPing });
    }, 5000);
  }
  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private raw(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(msg)); return; } catch { /* fall through to queue */ }
    }
    if (this.queue.length < 60) this.queue.push(msg);
  }

  send(msg: ClientMsg): void { this.raw(msg); }

  close(): void {
    this.closed = true;
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
  }
}

/**
 * Prefer the real room server; fall back to the in-browser engine when the
 * socket cannot be established at all.
 */
export async function connect(opts: ConnectOpts): Promise<Connection> {
  const remote = new RemoteConnection(opts);
  const timeout = opts.timeoutMs ?? 4500;
  try {
    await Promise.race([
      remote.open(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout)),
    ]);
    return remote;
  } catch {
    remote.close();
    opts.onState?.('local', 'offline');
    return new LocalConnection(opts.onMessage);
  }
}
