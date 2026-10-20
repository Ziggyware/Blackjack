import { Table, uid } from './table.js';
import type { TableOptions } from './table.js';
import type { ClientMsg, Fx, ServerMsg, TableView } from './types.js';

/**
 * A transport-agnostic session. On the server this is a WebSocket; in the
 * browser's offline fallback it is a direct bridge into React state.
 */
export interface HostSession {
  id: string;
  send(msg: ServerMsg): void;
  meta?: Record<string, unknown>;
}

export interface HostOptions extends TableOptions {
  /** ms between simulation steps */
  tickMs?: number;
  onEvent?: (event: HostEvent) => void;
}

export type HostEvent =
  | { type: 'join'; personId: string; name: string }
  | { type: 'leave'; personId: string; name: string }
  | { type: 'broadcast'; state: TableView; fx: Fx[] };

export class TableHost {
  readonly table: Table;
  private sessions = new Map<string, HostSession>();
  private tokens = new Map<string, string>(); // token -> personId
  private personOfSession = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private pendingFx: Fx[] = [];
  private lastSend = 0;
  private tickMs: number;
  private onEvent?: (e: HostEvent) => void;
  private dirty = false;

  constructor(opts: HostOptions) {
    this.table = new Table(opts);
    this.tickMs = opts.tickMs ?? 50;
    this.onEvent = opts.onEvent;
  }

  get state(): TableView { return this.table.view(); }
  get sessionCount(): number { return this.sessions.size; }
  get playerCount(): number { return this.table.people_list.length; }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), this.tickMs);
    // browsers throttle hidden tabs; keep the sim honest by catching up
    if (typeof globalThis !== 'undefined') {
      const g = globalThis as unknown as { document?: { addEventListener?: (t: string, f: () => void) => void } };
      g.document?.addEventListener?.('visibilitychange', () => this.step());
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  step(): void {
    const fx = this.table.tick();
    if (fx.length) this.pendingFx.push(...fx);
    if (this.table.consumeDirty() || this.pendingFx.length) this.flush();
  }

  private flush(): void {
    const now = Date.now();
    if (now - this.lastSend < 25) return;
    this.lastSend = now;
    const state = this.table.view();
    const fx = this.pendingFx;
    this.pendingFx = [];
    const msg: ServerMsg = { type: 'table', state, fx };
    this.onEvent?.({ type: 'broadcast', state, fx });
    for (const s of this.sessions.values()) {
      try { s.send(msg); } catch { /* socket already gone */ }
    }
  }

  /** Force an immediate snapshot (used right after a player action). */
  push(): void {
    this.lastSend = 0;
    this.flush();
  }

  attach(session: HostSession, identity: { token?: string | null; name?: string; hue?: number }): { personId: string; token: string; seat: number | null; isNew: boolean } {
    this.sessions.set(session.id, session);
    let personId: string | null = null;
    let token = identity.token ?? '';
    if (token && this.tokens.has(token)) personId = this.tokens.get(token)!;
    if (!personId) {
      const existing = identity.name
        ? this.table.people_list.find((p) => !p.bot && p.name.toLowerCase() === identity.name!.toLowerCase() && p.seat === null && !this.isConnected(p.id))
        : undefined;
      const person = existing ?? this.table.addPerson({
        name: identity.name || `Guest ${Math.floor(Math.random() * 900 + 100)}`,
        hue: identity.hue ?? Math.floor(Math.random() * 360),
      });
      if (identity.hue !== undefined) person.hue = ((identity.hue % 360) + 360) % 360;
      person.connected = true;
      personId = person.id;
      token = uid('tk');
      this.tokens.set(token, personId);
    }
    this.personOfSession.set(session.id, personId);
    const person = this.table.person(personId)!;
    person.connected = true;
    person.disconnectedAt = 0;
    this.dirty = true;
    this.pendingFx.push({ kind: 'sound', name: 'join' });
    this.onEvent?.({ type: 'join', personId, name: person.name });
    this.table.markDirty();
    this.push();
    void this.dirty;
    return { personId, token, seat: person.seat, isNew: !identity.token };
  }

  private isConnected(personId: string): boolean {
    for (const [sid, pid] of this.personOfSession) if (pid === personId && this.sessions.has(sid)) return true;
    return false;
  }

  detach(sessionId: string, opts: { permanent?: boolean } = {}): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    this.personOfSession.delete(sessionId);
    const personId = [...this.tokens.entries()].find(([, p]) => this.isConnected(p))?.[1];
    void personId;
    for (const [token, pid] of this.tokens) {
      if (!this.isConnected(pid)) {
        const person = this.table.person(pid);
        if (person) {
          person.connected = false;
          person.disconnectedAt = Date.now();
          person.thinking = false;
          if (opts.permanent && person.seat === null) {
            this.table.removePerson(pid);
            this.tokens.delete(token);
          }
        }
      }
    }
    this.table.markDirty();
    this.push();
  }

  personIdFor(sessionId: string): string | null {
    return this.personOfSession.get(sessionId) ?? null;
  }

  handle(sessionId: string, msg: ClientMsg): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const personId = this.personOfSession.get(sessionId);
    const fail = (code: string, message: string) => {
      session.send({ type: 'error', code, message });
      this.pendingFx.push({ kind: 'sound', name: 'deny' });
      this.push();
    };
    if (!personId && msg.type !== 'ping') return fail('no-session', 'Reconnecting…');

    switch (msg.type) {
      case 'ping':
        session.send({ type: 'pong', t: msg.t, serverTime: Date.now() });
        return;
      case 'sit': {
        const r = this.table.sit(personId!, msg.seat);
        if (!r.ok) fail('sit', r.error ?? 'cannot sit');
        break;
      }
      case 'leaveSeat': {
        const r = this.table.leaveSeat(personId!);
        if (!r.ok) fail('seat', r.error ?? 'cannot stand up');
        break;
      }
      case 'bet': {
        const r = this.table.placeBet(personId!, msg.amount);
        if (!r.ok) fail('bet', r.error ?? 'cannot bet');
        break;
      }
      case 'clearBet': {
        const r = this.table.clearBet(personId!);
        if (!r.ok) fail('bet', r.error ?? 'cannot clear');
        break;
      }
      case 'autoRebet':
        this.table.setAutoRebet(personId!, msg.on);
        break;
      case 'rebuy': {
        const r = this.table.rebuy(personId!);
        if (!r.ok) fail('rebuy', r.error ?? 'no rebuy');
        break;
      }
      case 'action': {
        const r = this.table.act(personId!, msg.action);
        if (!r.ok) fail('action', r.error ?? 'illegal move');
        break;
      }
      case 'insurance': {
        const r = this.table.takeInsurance(personId!, msg.take);
        if (!r.ok) fail('insurance', r.error ?? 'insurance closed');
        break;
      }
      case 'chat': {
        const r = this.table.chat(personId!, msg.text);
        if (!r.ok) fail('chat', r.error ?? 'cannot chat');
        break;
      }
      case 'reaction': {
        const p = this.table.person(personId!);
        if (p) {
          this.pendingFx.push({ kind: 'reaction', from: p.name, fromId: p.id, hue: p.hue, emoji: msg.emoji });
          this.pendingFx.push({ kind: 'sound', name: 'chat', gain: 0.4 });
        }
        break;
      }
      case 'bots': {
        if (msg.count > 0) this.table.addBots(msg.count);
        else this.table.removeBots(-msg.count || undefined);
        break;
      }
      case 'leave': {
        const r = this.table.leaveSeat(personId!);
        if (!r.ok) fail('seat', r.error ?? 'finish the round first');
        break;
      }
      default:
        return;
    }
    this.table.markDirty();
    this.push();
  }
}
