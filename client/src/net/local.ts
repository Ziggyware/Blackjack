import { DEFAULT_RULES, TableHost } from '@velvet/shared';
import type { ClientMsg, RoomSummary, ServerMsg } from '@velvet/shared';
import type { Connection } from './connection.js';

const LOCAL_ROOM_ID = 'local-neon';

const LOCAL_SUMMARY: RoomSummary = {
  roomId: LOCAL_ROOM_ID,
  name: 'NEON HOUSE',
  code: 'SOLO',
  private: false,
  players: 0,
  seats: 7,
  freeSeats: 7,
  phase: 'betting',
  minBet: DEFAULT_RULES.minBet,
  maxBet: DEFAULT_RULES.maxBet,
  tagline: 'Offline table · running the live engine in your browser',
  accent: 322,
  fiveCardCharlie: false,
};

/**
 * The whole authoritative engine, running in the browser tab. It exists so the
 * table is never dead: if the room server cannot be reached (proxied preview
 * without WebSocket support, airplane mode, a static deploy) the game simply
 * continues locally with identical rules and live bots.
 */
export class LocalConnection implements Connection {
  readonly kind = 'local' as const;
  private host: TableHost;
  private sessionId = 'local-you';
  private attached = false;
  private onMessage: (m: ServerMsg) => void;

  constructor(onMessage: (m: ServerMsg) => void) {
    this.onMessage = onMessage;
    this.host = new TableHost({
      roomId: LOCAL_ROOM_ID,
      name: 'NEON HOUSE',
      code: 'SOLO',
      seatCount: 7,
      rules: { ...DEFAULT_RULES },
      autoBots: 0,
      tickMs: 50,
    });
    this.host.table.addBots(4);
    this.host.start();
    this.queue({ type: 'welcome', you: this.sessionId, token: 'local', serverTime: Date.now(), rooms: [LOCAL_SUMMARY] });
  }

  private queue(msg: ServerMsg): void {
    // defer so callers never see state mutate synchronously mid-send
    queueMicrotask(() => this.onMessage(msg));
  }

  private ensureAttached(name: string, hue: number, token?: string | null): void {
    if (this.attached) return;
    this.attached = true;
    const res = this.host.attach(
      { id: this.sessionId, send: (m) => this.queue(m) },
      { name, hue, token },
    );
    this.queue({ type: 'joined', roomId: LOCAL_ROOM_ID, you: res.personId, seat: null, token: 'local' });
    this.host.push();
  }

  send(msg: ClientMsg): void {
    switch (msg.type) {
      case 'hello':
        this.queue({ type: 'welcome', you: this.sessionId, token: 'local', serverTime: Date.now(), rooms: [LOCAL_SUMMARY] });
        return;
      case 'listRooms':
        this.queue({ type: 'rooms', rooms: [LOCAL_SUMMARY] });
        return;
      case 'join':
        this.ensureAttached(msg.payload.name, msg.payload.hue, msg.payload.token);
        if (msg.payload.seat !== null && msg.payload.seat !== undefined) {
          this.host.handle(this.sessionId, { type: 'sit', seat: msg.payload.seat });
        }
        this.host.push();
        return;
      case 'createRoom':
        // a single offline table — pretend the new room is it
        this.ensureAttached('Host', 44);
        this.host.push();
        return;
      case 'ping':
        this.queue({ type: 'pong', t: msg.t, serverTime: Date.now() });
        return;
      default:
        if (!this.attached) this.ensureAttached('Guest', 200);
        this.host.handle(this.sessionId, msg);
        return;
    }
  }

  close(): void {
    this.host.stop();
  }
}
