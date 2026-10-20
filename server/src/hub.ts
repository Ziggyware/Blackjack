import { DEFAULT_RULES } from '@velvet/shared';
import type { RoomSummary, Rules } from '@velvet/shared';
import { Room } from './room.js';
import type { RoomMeta } from './room.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode(): string {
  let out = '';
  for (let i = 0; i < 4; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

interface HouseTable {
  name: string;
  tagline: string;
  accent: number;
  seatCount: number;
  bots: number;
  rules: Partial<Rules>;
}

/** The three permanent public rooms. Each has its own character. */
export const HOUSE_TABLES: HouseTable[] = [
  {
    name: 'NEON HOUSE',
    tagline: 'Six decks · blackjack 3:2 · the flagship floor',
    accent: 322,
    seatCount: 7,
    bots: 4,
    rules: { minBet: 10, maxBet: 2500, startingChips: 2500 },
  },
  {
    name: 'MIDNIGHT VELVET',
    tagline: 'Five card Charlie · dealer hits soft 17 · chaos friendly',
    accent: 186,
    seatCount: 7,
    bots: 3,
    rules: { fiveCardCharlie: true, dealerStandsSoft17: false, minBet: 25, maxBet: 5000, startingChips: 5000, betSeconds: 20, turnSeconds: 22 },
  },
  {
    name: 'THE ORACLE',
    tagline: 'Deep limits · late surrender · counters welcome',
    accent: 44,
    seatCount: 6,
    bots: 3,
    rules: { minBet: 100, maxBet: 25000, startingChips: 50000, rebuyAmount: 25000, surrender: 'late', turnSeconds: 30 },
  },
];

export class Hub {
  private rooms = new Map<string, Room>();
  private byCode = new Map<string, string>();
  private uidCounter = 0;

  constructor() {
    for (const t of HOUSE_TABLES) {
      this.createRoom({
        name: t.name,
        tagline: t.tagline,
        accent: t.accent,
        isPrivate: false,
        seatCount: t.seatCount,
        rules: t.rules,
        bots: t.bots,
      });
    }
  }

  createRoom(spec: {
    name: string;
    tagline?: string;
    accent?: number;
    isPrivate?: boolean;
    seatCount?: number;
    rules?: Partial<Rules>;
    bots?: number;
  }): Room {
    this.uidCounter += 1;
    const roomId = `r${this.uidCounter}_${Date.now().toString(36)}`;
    let code = makeCode();
    while (this.byCode.has(code)) code = makeCode();
    const meta: RoomMeta = {
      roomId,
      name: spec.name.slice(0, 28).toUpperCase() || 'PRIVATE TABLE',
      code,
      tagline: spec.tagline ?? 'Private table — invite by code',
      accent: spec.accent ?? Math.floor(Math.random() * 360),
      isPrivate: !!spec.isPrivate,
      createdAt: Date.now(),
      lastEmptyAt: Date.now(),
    };
    const rules: Partial<Rules> = { ...DEFAULT_RULES, ...(spec.rules ?? {}) };
    const room = new Room(meta, {
      roomId,
      name: meta.name,
      code,
      private: meta.isPrivate,
      seatCount: spec.seatCount ?? 7,
      rules,
      autoBots: 0,
    });
    room.host.table.addBots(spec.bots ?? 0);
    this.rooms.set(roomId, room);
    this.byCode.set(code, roomId);
    return room;
  }

  get(roomId: string): Room | undefined { return this.rooms.get(roomId); }

  byRoomCode(code: string): Room | undefined {
    const id = this.byCode.get(code.trim().toUpperCase());
    return id ? this.rooms.get(id) : undefined;
  }

  defaultRoom(): Room {
    const first = [...this.rooms.values()].find((r) => !r.meta.isPrivate);
    return first ?? this.createRoom({ name: 'NEON HOUSE', tagline: 'Floor', accent: 322 });
  }

  summaries(): RoomSummary[] {
    return [...this.rooms.values()].map((r) => {
      const table = r.host.table;
      const seated = table.people_list.filter((p) => p.seat !== null).length;
      return {
        roomId: r.meta.roomId,
        name: r.meta.name,
        code: r.meta.code,
        private: r.meta.isPrivate,
        players: seated,
        seats: table.seatCount,
        freeSeats: Math.max(0, table.seatCount - seated),
        phase: table.phase,
        minBet: table.rules.minBet,
        maxBet: table.rules.maxBet,
        tagline: r.meta.tagline,
        accent: r.meta.accent,
        fiveCardCharlie: table.rules.fiveCardCharlie,
      };
    }).sort((a, b) => Number(a.private) - Number(b.private) || b.players - a.players);
  }

  /** Drop long-abandoned private rooms. */
  reap(maxIdleMs = 15 * 60_000): void {
    const now = Date.now();
    for (const [id, room] of this.rooms) {
      if (!room.meta.isPrivate) { room.meta.lastEmptyAt = now; continue; }
      if (room.isEmpty) {
        if (now - room.meta.lastEmptyAt > maxIdleMs) {
          room.destroy();
          this.rooms.delete(id);
          this.byCode.delete(room.meta.code);
        }
      } else {
        room.meta.lastEmptyAt = now;
      }
    }
  }

  get size(): number { return this.rooms.size; }
  get playerCount(): number {
    return [...this.rooms.values()].reduce((a, r) => a + r.host.sessionCount, 0);
  }
}
