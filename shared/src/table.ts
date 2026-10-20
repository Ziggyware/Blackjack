import {
  Shoe, RANK_VALUE, chipBreakdown, fullTotal, handTotal, isTen, toView,
} from './cards.js';
import type { Card, Rng } from './cards.js';
import { BOT_PROFILES } from './bots.js';
import { advise } from './strategy.js';
import { legalActions, NO_ACTIONS } from './actions.js';
import type { LegalActions } from './actions.js';
import type {
  ActionKind, CardView, ChatView, Fx, HandResult, HandTotal, HandView, HistoryEntry,
  OccupantView, Phase, PlayerStats, Rank, Rules, SeatStatus, SeatView, ShoeView,
  SoundName, SpectatorView, TableView, ToastView,
} from './types.js';
import { cardCode } from './types.js';

export const DEFAULT_RULES: Rules = {
  decks: 6,
  dealerStandsSoft17: true,
  blackjackPays: 1.5,
  insurancePays: 2,
  doubleAnyTwo: true,
  doubleAfterSplit: true,
  maxSplits: 3,
  splitAcesOneCard: true,
  surrender: 'late',
  fiveCardCharlie: false,
  minBet: 10,
  maxBet: 2500,
  betSeconds: 22,
  turnSeconds: 25,
  startingChips: 2500,
  rebuyAmount: 2500,
  penetration: 0.25,
};

let counter = 0;
export function uid(prefix = 'x'): string {
  counter += 1;
  return `${prefix}${counter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export interface Person {
  id: string;
  name: string;
  hue: number;
  bot: boolean;
  connected: boolean;
  chips: number;
  seat: number | null;
  autoRebet: boolean;
  lastAction: ActionKind | null;
  lastActionAt: number;
  thinking: boolean;
  stats: PlayerStats;
  lastBet: number;
  profile: number;
  joinedAt: number;
  /** 0 while connected; otherwise the timestamp they dropped */
  disconnectedAt: number;
}

interface HandState {
  id: string;
  cards: Card[];
  bet: number;
  doubled: boolean;
  split: boolean;
  splitAces: boolean;
  surrendered: boolean;
  done: boolean;
  result: HandResult | null;
  payout: number;
  decided: boolean;
}

interface SeatState {
  index: number;
  personId: string | null;
  bet: number;
  insurance: number;
  insuranceOffered: boolean;
  insuranceDecided: boolean;
  hands: HandState[];
  handCursor: number;
  status: SeatStatus;
  inRound: boolean;
  timerEndsAt: number | null;
  botBetAt: number | null;
  botActAt: number | null;
  roundNet: number | null;
  roundLabel: string | null;
}

export interface TableOptions {
  roomId: string;
  name: string;
  code: string;
  private?: boolean;
  seatCount?: number;
  rules?: Partial<Rules>;
  now?: () => number;
  rng?: Rng;
  autoBots?: number;
  /** how long a dropped player keeps their seat before it is released */
  absentGraceMs?: number;
}

interface ScriptStep { at: number; run: () => void }

const QUIP_WIN = ['called it.', 'the shoe loves me.', 'easy money.', 'again. again!', 'dealer owes me rent.'];
const QUIP_LOSE = ['rough.', 'that ace was hiding.', 'one more round to fix this.', 'the shoe turned on me.', 'cold deck, cold heart.'];
const QUIP_BJ = ['BLACKJACK. perfection.', 'natural. no notes.', 'twenty-one on the nose.'];
const QUIP_BUST = ['greedy. my fault.', 'should have stood.', 'and that is why charts exist.'];
const QUIP_IDLE = ['shoe is heating up.', 'anyone counting this?', 'dealer has been cold for six rounds.', 'I trust the pulse, not the gut.', 'place your bets, poets.'];

export class Table {
  readonly roomId: string;
  readonly name: string;
  readonly code: string;
  readonly isPrivate: boolean;
  readonly rules: Rules;
  readonly seatCount: number;

  private people = new Map<string, Person>();
  private seats: SeatState[] = [];
  private shoe: Shoe;
  private discard = 0;
  private rng: Rng;
  private nowFn: () => number;

  phase: Phase = 'idle';
  phaseEndsAt: number | null = null;
  round = 0;
  turn: { seat: number; hand: number } | null = null;
  dealerCards: Card[] = [];
  private holeRevealed = false;

  private script: ScriptStep[] = [];
  private fxBuffer: Fx[] = [];
  private messages: ChatView[] = [];
  private history: HistoryEntry[] = [];
  private toasts: ToastView[] = [];
  private dirty = true;
  private shuffling = false;
  private botChatAt = 0;
  private absentGraceMs: number;
  /** cumulative chips the house has won (or injected via rebuys, as negative) */
  private houseLedger = 0;

  constructor(opts: TableOptions) {
    this.roomId = opts.roomId;
    this.name = opts.name;
    this.code = opts.code;
    this.isPrivate = !!opts.private;
    this.rules = { ...DEFAULT_RULES, ...(opts.rules ?? {}) };
    this.seatCount = opts.seatCount ?? 7;
    this.rng = opts.rng ?? Math.random;
    this.nowFn = opts.now ?? (() => Date.now());
    this.absentGraceMs = opts.absentGraceMs ?? 45_000;
    this.shoe = new Shoe(this.rules.decks, this.rng);
    for (let i = 0; i < this.seatCount; i++) this.seats.push(this.blankSeat(i));
    const bots = opts.autoBots ?? 0;
    if (bots > 0) {
      // seed bots immediately so an empty table still feels inhabited
      const t = this.nowFn();
      for (let i = 0; i < bots; i++) this.spawnBot();
      void t;
    }
    this.beginBetting(this.nowFn(), true);
  }

  /* ---------------------------------------------------------------- */
  /* plumbing                                                          */
  /* ---------------------------------------------------------------- */

  private blankSeat(index: number): SeatState {
    return {
      index, personId: null, bet: 0, insurance: 0, insuranceOffered: false,
      insuranceDecided: false, hands: [], handCursor: 0, status: 'empty',
      inRound: false, timerEndsAt: null, botBetAt: null, botActAt: null,
      roundNet: null, roundLabel: null,
    };
  }

  get houseNet(): number { return this.houseLedger; }

  markDirty(): void { this.dirty = true; }
  consumeDirty(): boolean { const d = this.dirty; this.dirty = false; return d; }
  flushFx(): Fx[] { const out = this.fxBuffer; this.fxBuffer = []; return out; }

  private fx(f: Fx): void { this.fxBuffer.push(f); this.dirty = true; }
  private sound(name: SoundName, gain?: number): void { this.fx({ kind: 'sound', name, gain }); }
  private toast(text: string, tone: ToastView['tone'] = 'info', seat?: number): void {
    const t: ToastView = { id: uid('t'), text, tone, at: this.nowFn(), seat };
    this.toasts.push(t);
    if (this.toasts.length > 4) this.toasts.shift();
    this.fx({ kind: 'toast', text, tone, seat });
  }

  private schedule(delay: number, run: () => void): void {
    const last = this.script.length ? this.script[this.script.length - 1]!.at : this.nowFn();
    this.script.push({ at: Math.max(last, this.nowFn()) + delay, run });
  }

  private drain(now: number): void {
    let guard = 0;
    while (this.script.length && this.script[0]!.at <= now && guard++ < 64) {
      const step = this.script.shift()!;
      step.run();
    }
  }

  get people_list(): Person[] { return [...this.people.values()]; }

  person(id: string): Person | undefined { return this.people.get(id); }

  seatOf(personId: string): number | null {
    const p = this.people.get(personId);
    return p ? p.seat : null;
  }

  /* ---------------------------------------------------------------- */
  /* roster                                                            */
  /* ---------------------------------------------------------------- */

  addPerson(input: { id?: string; name: string; hue: number; bot?: boolean; chips?: number; profile?: number }): Person {
    const id = input.id ?? uid('p');
    const existing = this.people.get(id);
    if (existing) return existing;
    const p: Person = {
      id,
      name: input.name.slice(0, 18),
      hue: ((input.hue % 360) + 360) % 360,
      bot: !!input.bot,
      connected: true,
      chips: input.chips ?? this.rules.startingChips,
      seat: null,
      autoRebet: false,
      lastAction: null,
      lastActionAt: 0,
      thinking: false,
      stats: emptyStats(),
      lastBet: 0,
      profile: input.profile ?? Math.floor(this.rng() * BOT_PROFILES.length),
      joinedAt: this.nowFn(),
      disconnectedAt: 0,
    };
    this.people.set(id, p);
    this.dirty = true;
    return p;
  }

  removePerson(id: string): void {
    const p = this.people.get(id);
    if (!p) return;
    if (p.seat !== null) {
      const seat = this.seats[p.seat];
      if (seat) {
        // chips in play are forfeit if they bail mid-round; otherwise refund the bet
        if (!seat.inRound && seat.bet > 0) { p.chips += seat.bet; seat.bet = 0; }
        if (!seat.inRound) {
          seat.personId = null;
          seat.status = 'empty';
          seat.hands = [];
          seat.insurance = 0;
        } else {
          // ghost seat resolves the round; whatever is committed goes to the house
          seat.personId = null;
          seat.status = 'waiting';
          const committed = seat.hands.reduce((a, h) => a + h.bet, 0) + seat.insurance;
          this.houseLedger += committed;
        }
      }
    }
    p.seat = null;
    this.people.delete(id);
    if (this.turn && this.seats[this.turn.seat]?.personId === null) this.turn = null;
    this.dirty = true;
  }

  setConnected(id: string, connected: boolean): void {
    const p = this.people.get(id);
    if (!p) return;
    p.connected = connected;
    p.disconnectedAt = connected ? 0 : this.nowFn();
    this.dirty = true;
  }

  /** Move a house player out of a seat a human wants, or off the table entirely. */
  private relocateBot(bot: Person, seat: SeatState): void {
    bot.chips += seat.bet;
    seat.personId = null;
    seat.status = 'empty';
    seat.bet = 0;
    seat.hands = [];
    seat.insurance = 0;
    seat.botBetAt = null;
    const free = this.seats.filter((s) => !s.personId && !s.inRound && s.index !== seat.index);
    if (free.length > 0) {
      const target = free[Math.floor(this.rng() * free.length)]!;
      target.personId = bot.id;
      target.status = 'out';
      bot.seat = target.index;
      this.system(`${bot.name} moves to seat ${target.index + 1}`);
    } else {
      bot.seat = null;
      this.system(`${bot.name} steps away from the table`);
    }
    this.dirty = true;
  }

  sit(personId: string, index: number): { ok: boolean; error?: string } {
    const p = this.people.get(personId);
    if (!p) return { ok: false, error: 'unknown player' };
    if (index < 0 || index >= this.seatCount) return { ok: false, error: 'no such seat' };
    const seat = this.seats[index];
    if (!seat) return { ok: false, error: 'no such seat' };
    if (seat.personId === personId) return { ok: true };
    if (seat.inRound) return { ok: false, error: 'round in progress' };
    if (seat.personId) {
      const occupant = this.people.get(seat.personId);
      // house players always yield their seat to a human
      if (!occupant?.bot || p.bot) return { ok: false, error: 'seat taken' };
      this.relocateBot(occupant, seat);
    }
    if (p.seat !== null) {
      const old = this.seats[p.seat];
      if (old) { old.personId = null; old.status = 'empty'; old.hands = []; old.bet = 0; }
    }
    p.seat = index;
    seat.personId = personId;
    seat.status = 'out';
    seat.hands = [];
    seat.bet = 0;
    this.dirty = true;
    this.sound('join');
    this.system(`${p.name} takes seat ${index + 1}`);
    return { ok: true };
  }

  leaveSeat(personId: string): { ok: boolean; error?: string } {
    const p = this.people.get(personId);
    if (!p || p.seat === null) return { ok: true };
    const seat = this.seats[p.seat];
    if (seat?.inRound) return { ok: false, error: 'finish the round first' };
    if (seat) {
      if (seat.bet > 0) p.chips += seat.bet;
      seat.personId = null; seat.bet = 0; seat.status = 'empty'; seat.hands = [];
      seat.insurance = 0; seat.roundNet = null; seat.roundLabel = null;
    }
    p.seat = null;
    this.dirty = true;
    return { ok: true };
  }

  spawnBot(): Person {
    const taken = new Set<number>();
    for (const p of this.people.values()) if (p.seat !== null) taken.add(p.seat);
    const free: number[] = [];
    for (let i = 0; i < this.seatCount; i++) if (!taken.has(i)) free.push(i);
    const profile = BOT_PROFILES[Math.floor(this.rng() * BOT_PROFILES.length)]!;
    const existingNames = new Set([...this.people.values()].map((p) => p.name));
    let name = profile.name;
    let n = 2;
    while (existingNames.has(name)) { name = `${profile.name} ${n++}`; }
    const bot = this.addPerson({
      name,
      hue: profile.hue + Math.floor(this.rng() * 24) - 12,
      bot: true,
      chips: profile.chips,
      profile: BOT_PROFILES.indexOf(profile),
    });
    if (free.length > 0) {
      const seat = free[Math.floor(this.rng() * free.length)]!;
      this.sit(bot.id, seat);
    }
    return bot;
  }

  addBots(count: number): void {
    for (let i = 0; i < count; i++) {
      const free = this.seats.filter((s) => !s.personId).length;
      if (free === 0) break;
      this.spawnBot();
    }
  }

  removeBots(count?: number): void {
    const bots = [...this.people.values()].filter((p) => p.bot && p.seat !== null && !this.seats[p.seat!]?.inRound);
    const n = count ?? bots.length;
    for (let i = 0; i < Math.min(n, bots.length); i++) this.removePerson(bots[i]!.id);
  }

  /* ---------------------------------------------------------------- */
  /* betting                                                           */
  /* ---------------------------------------------------------------- */

  canBet(personId: string): { ok: boolean; error?: string } {
    const p = this.people.get(personId);
    if (!p) return { ok: false, error: 'not at the table' };
    if (p.seat === null) return { ok: false, error: 'take a seat first' };
    if (this.phase !== 'betting') return { ok: false, error: 'betting is closed' };
    return { ok: true };
  }

  placeBet(personId: string, amount: number, replace = false): { ok: boolean; error?: string } {
    const gate = this.canBet(personId);
    if (!gate.ok) return gate;
    const p = this.people.get(personId)!;
    const seat = this.seats[p.seat!]!;
    const delta = Math.floor(amount);
    if (!Number.isFinite(delta) || delta === 0) return { ok: false, error: 'bad amount' };
    const next = replace ? delta : seat.bet + delta;
    if (next < 0) return { ok: false, error: 'bad amount' };
    if (next > this.rules.maxBet) return { ok: false, error: `table max is ${this.rules.maxBet}` };
    if (next > 0 && next < this.rules.minBet) return { ok: false, error: `table min is ${this.rules.minBet}` };
    if (next > p.chips + seat.bet) return { ok: false, error: 'not enough chips' };
    const move = next - seat.bet;
    p.chips -= move;
    seat.bet = next;
    p.lastAction = 'bet';
    p.lastActionAt = this.nowFn();
    if (next > 0) p.lastBet = next;
    this.dirty = true;
    this.sound(move >= 500 ? 'chip' : 'chipSoft');
    return { ok: true };
  }

  clearBet(personId: string): { ok: boolean; error?: string } {
    const gate = this.canBet(personId);
    if (!gate.ok) return gate;
    const p = this.people.get(personId)!;
    const seat = this.seats[p.seat!]!;
    p.chips += seat.bet;
    seat.bet = 0;
    this.dirty = true;
    this.sound('click');
    return { ok: true };
  }

  setAutoRebet(personId: string, on: boolean): void {
    const p = this.people.get(personId);
    if (!p) return;
    p.autoRebet = on;
    this.dirty = true;
  }

  rebuy(personId: string): { ok: boolean; error?: string } {
    const p = this.people.get(personId);
    if (!p) return { ok: false, error: 'not at the table' };
    if (p.chips >= this.rules.minBet) return { ok: false, error: 'you still have chips' };
    p.chips += this.rules.rebuyAmount;
    this.houseLedger -= this.rules.rebuyAmount;
    this.dirty = true;
    this.sound('chip');
    this.system(`${p.name} takes a rebuy — ${this.rules.rebuyAmount} chips`, 'info');
    return { ok: true };
  }

  /* ---------------------------------------------------------------- */
  /* round lifecycle                                                   */
  /* ---------------------------------------------------------------- */

  private beginBetting(now: number, initial = false): void {
    const need = Math.floor(this.shoe.total * this.rules.penetration);
    if (this.shoe.remaining < need && !initial) {
      this.beginShuffle(now);
      return;
    }
    this.round += 1;
    this.phase = 'betting';
    this.phaseEndsAt = now + this.rules.betSeconds * 1000;
    this.dealerCards = [];
    this.holeRevealed = false;
    this.turn = null;
    this.script = [];
    for (const seat of this.seats) {
      seat.hands = [];
      seat.handCursor = 0;
      seat.inRound = false;
      seat.insurance = 0;
      seat.insuranceOffered = false;
      seat.insuranceDecided = false;
      seat.timerEndsAt = null;
      seat.botActAt = null;
      seat.roundNet = null;
      seat.roundLabel = null;
      const p = seat.personId ? this.people.get(seat.personId) : null;
      if (!p) { seat.status = 'empty'; seat.bet = 0; continue; }
      seat.status = 'betting';
      if (p.autoRebet && p.lastBet > 0 && seat.bet === 0) {
        const want = Math.min(p.lastBet, p.chips, this.rules.maxBet);
        if (want >= this.rules.minBet) {
          p.chips -= want;
          seat.bet = want;
          this.sound('chipSoft');
        }
      }
      seat.botBetAt = null;
    }
    this.fx({ kind: 'phase', phase: 'betting' });
    if (!initial) this.sound('chipSoft');
  }

  private beginShuffle(now: number): void {
    this.phase = 'shuffle';
    this.shuffling = true;
    this.phaseEndsAt = now + 2600;
    this.dirty = true;
    this.fx({ kind: 'shuffle' });
    this.sound('shuffle');
    this.system('Shuffling a fresh shoe', 'info');
  }

  private finishShuffle(now: number): void {
    this.shoe.shuffle();
    this.discard = 0;
    this.shuffling = false;
    this.dirty = true;
    this.beginBetting(now);
  }

  private startDeal(now: number): void {
    const active = this.seats.filter((s) => s.personId && s.bet >= this.rules.minBet);
    if (active.length === 0) {
      this.phaseEndsAt = now + this.rules.betSeconds * 1000;
      this.dirty = true;
      this.toast('Table is waiting for bets', 'info');
      return;
    }
    const cardsNeeded = active.length * 2 + 3;
    if (this.shoe.remaining < cardsNeeded) {
      this.beginShuffle(now);
      return;
    }
    this.phase = 'dealing';
    this.phaseEndsAt = null;
    this.fx({ kind: 'phase', phase: 'dealing' });
    for (const seat of active) {
      const p = this.people.get(seat.personId!)!;
      seat.inRound = true;
      seat.status = 'waiting';
      seat.hands = [newHand(seat.bet)];
      seat.handCursor = 0;
      p.stats.wagered += seat.bet;
      p.lastAction = null;
      p.thinking = false;
    }
    // mark non-betting seats as out
    for (const seat of this.seats) {
      if (!seat.inRound && seat.personId) seat.status = 'out';
    }

    const order: (() => void)[] = [];
    for (let pass = 0; pass < 2; pass++) {
      for (const seat of active) {
        order.push(() => {
          const c = this.drawCard();
          if (c) seat.hands[0]!.cards.push(c);
          this.sound('deal');
          this.dirty = true;
        });
      }
      if (pass === 0) {
        order.push(() => {
          const c = this.drawCard();
          if (c) this.dealerCards.push(c);
          this.sound('deal');
          this.dirty = true;
        });
      } else {
        order.push(() => {
          const c = this.drawCard();
          if (c) { c.hidden = true; this.dealerCards.push(c); }
          this.sound('deal');
          this.dirty = true;
        });
      }
    }
    order.forEach((fn, i) => this.schedule(i === 0 ? 220 : 200, fn));
    this.schedule(320, () => this.afterDeal());
    this.dirty = true;
  }

  private drawCard(): Card | null {
    const c = this.shoe.draw(this.nowFn());
    if (!c) { this.shoe.shuffle(); return this.shoe.draw(this.nowFn()); }
    this.dirty = true;
    return c;
  }

  private afterDeal(): void {
    const now = this.nowFn();
    const up = this.dealerCards[0]?.rank ?? null;
    const naturals: SeatState[] = [];
    for (const seat of this.seats) {
      if (!seat.inRound) continue;
      const h = seat.hands[0];
      if (!h) continue;
      const t = fullTotal(h.cards);
      if (t?.blackjack) {
        h.done = true;
        h.decided = true;
        h.result = 'blackjack';
        naturals.push(seat);
        seat.status = 'done';
        const p = this.people.get(seat.personId ?? '');
        if (p) {
          this.toast(`${p.name} — Blackjack!`, 'epic', seat.index);
          this.fx({ kind: 'burst', tone: 'blackjack', seat: seat.index });
          this.sound('blackjack');
        }
      }
    }
    const activeSeats = this.seats.filter((s) => s.inRound);
    const dealerBJ = fullTotal(this.dealerCards)?.blackjack ?? false;

    if (up === 'A') {
      // insurance window, then peek
      this.phase = 'insurance';
      this.phaseEndsAt = now + 9000;
      this.dirty = true;
      for (const seat of activeSeats) {
        if (seat.status === 'done') { seat.insuranceDecided = true; continue; }
        seat.insuranceOffered = true;
        const p = this.people.get(seat.personId ?? '');
        if (p?.bot) {
          seat.botActAt = now + 500 + Math.floor(this.rng() * 2600);
          seat.insuranceDecided = false;
        } else if (p) {
          seat.insuranceDecided = false;
        } else {
          seat.insuranceDecided = true;
        }
      }
      this.toast('Dealer shows an Ace — insurance?', 'info');
      this.fx({ kind: 'phase', phase: 'insurance' });
      return;
    }

    if (dealerBJ) {
      this.revealHole();
      this.schedule(500, () => this.settle());
      this.phase = 'dealer';
      this.dirty = true;
      return;
    }
    if (activeSeats.every((s) => s.status === 'done')) {
      this.phase = 'dealer';
      this.dirty = true;
      this.schedule(420, () => this.dealerPlay());
      return;
    }
    void naturals;
    this.startPlayerTurns();
  }

  private revealHole(): void {
    for (const c of this.dealerCards) c.hidden = false;
    this.holeRevealed = true;
    this.sound('flip');
    this.dirty = true;
  }

  private resolveInsurancePeek(): void {
    const now = this.nowFn();
    const dealerBJ = fullTotal(this.dealerCards)?.blackjack ?? false;
    if (dealerBJ) {
      this.revealHole();
      this.toast('Dealer has blackjack', 'bad');
      this.phase = 'dealer';
      this.dirty = true;
      this.schedule(700, () => this.settle());
    } else {
      this.system('Dealer checks the hole — no blackjack', 'info');
      this.phase = 'players';
      this.dirty = true;
      this.startPlayerTurns();
      void now;
    }
  }

  private startPlayerTurns(): void {
    this.phase = 'players';
    this.turn = null;
    this.dirty = true;
    this.fx({ kind: 'phase', phase: 'players' });
    this.nextTurn();
  }

  private nextTurn(): void {
    const now = this.nowFn();
    const startSeat = this.turn ? this.turn.seat : 0;
    const startHand = this.turn ? this.turn.hand : 0;
    // finish scanning the current seat first, then wrap
    for (let i = 0; i < this.seatCount; i++) {
      const idx = (startSeat + i) % this.seatCount;
      const seat = this.seats[idx]!;
      if (!seat.inRound) continue;
      const from = i === 0 ? startHand : 0;
      for (let h = from; h < seat.hands.length; h++) {
        if (i === 0 && h === startHand && this.turn) continue; // already resolved
        const hand = seat.hands[h];
        if (!hand || hand.done) continue;
        this.assignTurn(idx, h);
        return;
      }
      void from;
    }
    // nobody left to act
    this.turn = null;
    for (const seat of this.seats) if (seat.inRound && seat.status !== 'done') seat.status = 'done';
    this.dirty = true;
    this.phase = 'dealer';
    this.schedule(520, () => this.dealerPlay());
    void now;
  }

  private assignTurn(seatIdx: number, handIdx: number): void {
    const now = this.nowFn();
    const seat = this.seats[seatIdx]!;
    this.turn = { seat: seatIdx, hand: handIdx };
    seat.handCursor = handIdx;
    seat.status = 'turn';
    const p = this.people.get(seat.personId ?? '');
    const canAct = this.availableActions(seatIdx, handIdx);
    if (!canAct.hit && !canAct.double && !canAct.split && !canAct.surrender) {
      // nothing legal (e.g. split aces already completed) — auto-stand
      this.schedule(260, () => this.applyAction(seatIdx, 'stand'));
      seat.timerEndsAt = null;
      return;
    }
    if (p?.bot) {
      const base = 700 + Math.floor(this.rng() * 1500);
      seat.botActAt = now + base;
      seat.timerEndsAt = now + Math.max(6000, base + 4000);
      p.thinking = true;
    } else if (p) {
      seat.timerEndsAt = now + this.rules.turnSeconds * 1000;
      p.thinking = true;
      this.sound('turn');
    } else {
      seat.timerEndsAt = now + 3500; // ghost seat — resolve quickly
    }
    this.dirty = true;
  }

  availableActions(seatIdx: number, handIdx: number): LegalActions {
    const seat = this.seats[seatIdx];
    const p = seat ? this.people.get(seat.personId ?? '') : undefined;
    const hand = seat?.hands[handIdx];
    if (!seat || !hand || !p) return { ...NO_ACTIONS };
    return legalActions({
      cards: hand.cards.filter((c) => !c.hidden).map((c) => c.rank),
      total: fullTotal(hand.cards),
      phase: this.phase,
      isTurn: this.phase === 'players' && this.turn?.seat === seatIdx && this.turn?.hand === handIdx,
      handCount: seat.hands.length,
      chips: p.chips,
      bet: hand.bet,
      doubled: hand.doubled,
      split: hand.split,
      splitAces: hand.splitAces,
      decided: hand.decided,
      dealerUp: this.dealerCards[0]?.rank ?? null,
      rules: this.rules,
      insuranceOffered: seat.insuranceOffered,
      insuranceDecided: seat.insuranceDecided,
      inRound: seat.inRound,
    });
  }

  /* ---------------------------------------------------------------- */
  /* player actions                                                    */
  /* ---------------------------------------------------------------- */

  act(personId: string, action: 'hit' | 'stand' | 'double' | 'split' | 'surrender'): { ok: boolean; error?: string } {
    if (this.phase !== 'players' || !this.turn) return { ok: false, error: 'not your turn' };
    const seat = this.seats[this.turn.seat];
    if (!seat || seat.personId !== personId) return { ok: false, error: 'not your turn' };
    const p = this.people.get(personId);
    if (!p) return { ok: false, error: 'unknown player' };
    const avail = this.availableActions(this.turn.seat, this.turn.hand);
    if (!avail[action]) return { ok: false, error: `${action} is not available` };
    this.applyAction(this.turn.seat, action);
    return { ok: true };
  }

  private applyAction(seatIdx: number, action: 'hit' | 'stand' | 'double' | 'split' | 'surrender'): void {
    const now = this.nowFn();
    const seat = this.seats[seatIdx]!;
    const hand = seat.hands[seat.handCursor];
    if (!hand) return;
    const p = this.people.get(seat.personId ?? '');
    if (p) {
      p.thinking = false;
      p.lastAction = action;
      p.lastActionAt = now;
    }
    seat.timerEndsAt = null;
    seat.botActAt = null;
    hand.decided = true;

    switch (action) {
      case 'hit': {
        const c = this.drawCard();
        if (c) hand.cards.push(c);
        this.sound('deal');
        const t = fullTotal(hand.cards);
        if (t?.bust) {
          hand.done = true;
          hand.result = 'bust';
          this.fx({ kind: 'burst', tone: 'bust', seat: seatIdx });
          this.sound('bust');
          if (p?.bot) this.botChat(p, QUIP_BUST);
        } else if (this.rules.fiveCardCharlie && t && t.count >= 5) {
          hand.done = true;
          hand.result = 'charlie';
          this.toast(`${p?.name ?? 'Player'} — Five card Charlie!`, 'epic', seatIdx);
          this.fx({ kind: 'burst', tone: 'charlie', seat: seatIdx });
          this.sound('charlie');
        } else if (t && t.best === 21) {
          hand.done = true;
          this.sound('flip');
        }
        break;
      }
      case 'stand':
        hand.done = true;
        this.sound('click');
        break;
      case 'double': {
        if (p) p.chips -= hand.bet;
        hand.bet *= 2;
        hand.doubled = true;
        const c = this.drawCard();
        if (c) hand.cards.push(c);
        hand.done = true;
        this.sound('chip');
        this.sound('deal');
        const t = fullTotal(hand.cards);
        if (t?.bust) {
          hand.result = 'bust';
          this.fx({ kind: 'burst', tone: 'bust', seat: seatIdx });
          this.sound('bust');
          if (p?.bot) this.botChat(p, QUIP_BUST);
        } else {
          this.toast(`${p?.name ?? 'Player'} doubles down`, 'info', seatIdx);
        }
        break;
      }
      case 'split': {
        if (!p) break;
        const second = hand.cards.pop();
        if (!second) break;
        p.chips -= hand.bet;
        const isAces = hand.cards[0]?.rank === 'A';
        const newBet = hand.bet;
        hand.split = true;
        hand.splitAces = isAces;
        hand.bet = newBet;
        const extra: HandState = { ...newHand(newBet), split: true, splitAces: isAces };
        extra.cards = [second];
        const insertAt = seat.handCursor + 1;
        seat.hands.splice(insertAt, 0, extra);
        const c1 = this.drawCard();
        const c2 = this.drawCard();
        if (c1) hand.cards.push(c1);
        if (c2) extra.cards.push(c2);
        this.sound('split');
        this.sound('deal');
        this.toast(`${p.name} splits`, 'info', seatIdx);
        if (isAces && this.rules.splitAcesOneCard) {
          hand.done = true;
          extra.done = true;
        }
        if (fullTotal(hand.cards)?.bust) { hand.done = true; hand.result = 'bust'; }
        if (fullTotal(extra.cards)?.bust) { extra.done = true; extra.result = 'bust'; }
        break;
      }
      case 'surrender': {
        hand.done = true;
        hand.surrendered = true;
        hand.result = 'surrender';
        this.sound('push');
        this.toast(`${p?.name ?? 'Player'} surrenders half`, 'info', seatIdx);
        break;
      }
    }
    this.dirty = true;
    this.afterHandAction(seatIdx);
  }

  private afterHandAction(seatIdx: number): void {
    const seat = this.seats[seatIdx]!;
    const hand = seat.hands[seat.handCursor];
    if (hand && !hand.done) {
      // same hand continues (after a hit); refresh the timer
      const p = this.people.get(seat.personId ?? '');
      const now = this.nowFn();
      if (p?.bot) {
        seat.botActAt = now + 600 + Math.floor(this.rng() * 1300);
        seat.timerEndsAt = now + 6000;
        p.thinking = true;
      } else if (p) {
        seat.timerEndsAt = now + this.rules.turnSeconds * 1000;
        p.thinking = true;
      }
      this.dirty = true;
      return;
    }
    // move to the next hand at this seat, else next seat
    let next = seat.handCursor;
    while (next < seat.hands.length - 1) {
      next++;
      if (!seat.hands[next]!.done) {
        this.turn = { seat: seatIdx, hand: next };
        this.assignTurn(seatIdx, next);
        return;
      }
    }
    const allDone = seat.hands.every((h) => h.done);
    if (allDone) seat.status = 'done';
    this.turn = { seat: seatIdx, hand: seat.handCursor };
    this.nextTurn();
  }

  takeInsurance(personId: string, take: boolean): { ok: boolean; error?: string } {
    if (this.phase !== 'insurance') return { ok: false, error: 'insurance is closed' };
    const p = this.people.get(personId);
    if (!p || p.seat === null) return { ok: false, error: 'not at the table' };
    const seat = this.seats[p.seat];
    if (!seat || !seat.insuranceOffered || seat.insuranceDecided) return { ok: false, error: 'not available' };
    seat.insuranceDecided = true;
    if (take) {
      const amount = Math.floor(seat.bet / 2);
      if (amount <= 0) return { ok: false, error: 'no bet to insure' };
      if (p.chips < amount) return { ok: false, error: 'not enough chips' };
      p.chips -= amount;
      seat.insurance = amount;
      this.sound('chip');
      this.system(`${p.name} takes insurance`, 'info');
    } else {
      this.sound('click');
    }
    seat.botActAt = null;
    this.dirty = true;
    this.maybeCloseInsurance();
    return { ok: true };
  }

  private maybeCloseInsurance(): void {
    const pending = this.seats.some((s) => s.inRound && s.insuranceOffered && !s.insuranceDecided);
    if (!pending && this.phase === 'insurance') {
      this.phaseEndsAt = Math.min(this.phaseEndsAt ?? this.nowFn(), this.nowFn() + 600);
    }
  }

  /* ---------------------------------------------------------------- */
  /* dealer + settlement                                               */
  /* ---------------------------------------------------------------- */

  private dealerPlay(): void {
    const live = this.seats.flatMap((s) => (s.inRound ? s.hands : []))
      .filter((h) => h.result !== 'bust' && h.result !== 'surrender' && h.result !== 'blackjack' && h.result !== 'charlie');
    this.revealHole();
    if (live.length === 0) {
      this.schedule(520, () => this.settle());
      return;
    }
    this.phase = 'dealer';
    this.dirty = true;
    this.schedule(560, () => this.dealerStep());
  }

  private dealerStep(): void {
    const t = fullTotal(this.dealerCards);
    if (!t) { this.settle(); return; }
    const mustHit = t.best < 17 || (!this.rules.dealerStandsSoft17 && t.best === 17 && t.soft);
    if (mustHit) {
      const c = this.drawCard();
      if (c) this.dealerCards.push(c);
      this.sound('deal');
      const nt = fullTotal(this.dealerCards);
      if (nt?.bust) {
        this.toast('Dealer busts', 'good');
        this.fx({ kind: 'burst', tone: 'win' });
        this.schedule(760, () => this.settle());
      } else {
        this.schedule(720, () => this.dealerStep());
      }
      this.dirty = true;
      return;
    }
    this.schedule(520, () => this.settle());
  }

  private settle(): void {
    const now = this.nowFn();
    this.phase = 'settle';
    this.turn = null;
    this.revealHole();
    this.dirty = true;
    this.fx({ kind: 'phase', phase: 'settle' });
    const dealerTotal = fullTotal(this.dealerCards);
    const dealerBJ = dealerTotal?.blackjack ?? false;
    const dealerBust = dealerTotal?.bust ?? false;
    const dealerBest = dealerTotal?.best ?? 0;
    const entry: HistoryEntry = {
      round: this.round,
      at: now,
      dealer: this.dealerCards.map((c) => cardCode(c.rank, c.suit)),
      dealerTotal: dealerBest,
      hands: [],
      pot: 0,
    };

    let tableNet = 0;
    const payouts: { seat: SeatState; person: Person | undefined; net: number; label: string; tone: 'win' | 'blackjack' | 'bust' | 'push' | 'chips' | 'charlie' }[] = [];

    for (const seat of this.seats) {
      if (!seat.inRound) continue;
      const p = this.people.get(seat.personId ?? '');
      let seatNet = 0;
      const labels: string[] = [];
      let tone: 'win' | 'blackjack' | 'bust' | 'push' | 'chips' | 'charlie' = 'push';

      if (seat.insurance > 0) {
        if (dealerBJ) {
          const win = Math.floor(seat.insurance * this.rules.insurancePays);
          seatNet += win;
          labels.push(`insurance +${win}`);
        } else {
          seatNet -= seat.insurance;
          labels.push(`insurance −${seat.insurance}`);
        }
        entry.hands.push({
          name: p?.name ?? 'House', hue: p?.hue ?? 200, cards: [], dealer: [],
          bet: seat.insurance, net: dealerBJ ? seat.insurance * 2 : -seat.insurance, result: 'insurance',
        });
      }

      for (const hand of seat.hands) {
        const t = fullTotal(hand.cards);
        const best = t?.best ?? 0;
        let net = 0;
        let result: HandResult;
        if (hand.result === 'surrender') {
          net = -Math.floor(hand.bet / 2);
          result = 'surrender';
        } else if (hand.result === 'bust' || (t?.bust ?? false)) {
          net = -hand.bet;
          result = 'bust';
        } else if (hand.result === 'blackjack' && !dealerBJ) {
          net = Math.floor(hand.bet * this.rules.blackjackPays);
          result = 'blackjack';
        } else if (hand.result === 'blackjack' && dealerBJ) {
          net = 0;
          result = 'push';
        } else if (dealerBJ) {
          net = -hand.bet;
          result = 'lose';
        } else if (dealerBust || best > dealerBest) {
          net = hand.bet;
          result = hand.result === 'charlie' ? 'charlie' : 'win';
        } else if (best === dealerBest) {
          net = 0;
          result = 'push';
        } else {
          net = -hand.bet;
          result = 'lose';
        }
        hand.result = result;
        hand.payout = net;
        seatNet += net;
        tableNet += net;
        entry.pot += hand.bet;
        entry.hands.push({
          name: p?.name ?? 'House', hue: p?.hue ?? 200,
          cards: hand.cards.map((c) => cardCode(c.rank, c.suit)),
          dealer: entry.dealer, bet: hand.bet, net, result,
        });
        if (result === 'blackjack') { labels.push('BLACKJACK'); tone = 'blackjack'; }
        else if (result === 'charlie') { labels.push('CHARLIE'); tone = 'charlie'; }
        else if (result === 'bust') { labels.push('BUST'); if (tone === 'push') tone = 'bust'; }
        else if (result === 'win') { labels.push('WIN'); if (tone !== 'blackjack' && tone !== 'charlie') tone = 'win'; }
        else if (result === 'push') labels.push('PUSH');
        else if (result === 'surrender') labels.push('SURRENDER');
        else labels.push('LOSS');

        if (p) {
          p.stats.hands += 1;
          if (net > 0) { p.stats.wins += 1; p.stats.streak = Math.max(1, p.stats.streak + 1); p.stats.bestStreak = Math.max(p.stats.bestStreak, p.stats.streak); }
          else if (net < 0) { p.stats.losses += 1; p.stats.streak = Math.min(-1, p.stats.streak - 1); }
          else p.stats.pushes += 1;
          if (result === 'blackjack') p.stats.blackjacks += 1;
          if (result === 'bust') p.stats.busts += 1;
          if (net > p.stats.biggestWin) p.stats.biggestWin = net;
          p.stats.net += net;
        }
      }

      // return stake + winnings
      if (p) {
        const stake = seat.hands.reduce((a, h) => a + h.bet, 0);
        const credit = stake + seatNet + seat.insurance;
        p.chips += credit;
      }
      this.houseLedger -= seatNet;
      seat.roundNet = seatNet;
      seat.roundLabel = labels.join(' · ');
      seat.status = 'settled';
      seat.inRound = false;
      payouts.push({ seat, person: p, net: seatNet, label: seat.roundLabel ?? '', tone });
      if (p) {
        p.stats.rounds += 1;
        if (p.bot) {
          if (seatNet > 0) this.botChat(p, seatNet >= Math.floor(seat.bet * 1.5) ? QUIP_BJ : QUIP_WIN, 0.55);
          else if (seatNet < 0) this.botChat(p, QUIP_LOSE, 0.4);
        }
      }
    }

    this.history.unshift(entry);
    if (this.history.length > 24) this.history.pop();
    this.discard += this.dealerCards.length + this.seats.reduce((a, s) => a + s.hands.reduce((b, h) => b + h.cards.length, 0), 0);

    // staggered drama
    payouts.forEach((p, i) => {
      this.schedule(120 + i * 260, () => {
        const name = p.person?.name ?? `Seat ${p.seat.index + 1}`;
        if (!p.person) return;
        if (p.tone === 'blackjack' || p.tone === 'charlie') {
          this.sound('blackjack');
          this.fx({ kind: 'burst', tone: p.tone === 'charlie' ? 'charlie' : 'blackjack', seat: p.seat.index, amount: p.net });
        } else if (p.net > 0) {
          this.sound('win');
          this.fx({ kind: 'burst', tone: 'win', seat: p.seat.index, amount: p.net });
          this.fx({ kind: 'payout', seat: p.seat.index, amount: p.net });
        } else if (p.net < 0) {
          this.sound('bust');
          this.fx({ kind: 'burst', tone: p.tone === 'bust' ? 'bust' : 'push', seat: p.seat.index, amount: p.net });
        } else {
          this.sound('push');
          this.fx({ kind: 'burst', tone: 'push', seat: p.seat.index });
        }
        if (p.net !== 0) {
          this.fx({ kind: 'toast', text: `${name} ${p.net > 0 ? '+' : ''}${p.net}`, tone: p.net > 0 ? 'good' : 'bad', seat: p.seat.index });
        }
        this.dirty = true;
      });
    });

    const humanWins = payouts.filter((p) => !p.person?.bot && p.net > 0);
    if (humanWins.length > 0 && dealerBust) this.system(`Dealer busts with ${dealerBest} — the table takes it`, 'good');
    else if (dealerBJ) this.system('Dealer blackjack — the house sweeps', 'bad');

    this.schedule(340 + payouts.length * 260 + 1200, () => {
      this.endRound();
    });
    this.phaseEndsAt = now + 340 + payouts.length * 260 + 3400;
    this.tableNetLast = tableNet;
    this.dirty = true;
  }

  private tableNetLast = 0;

  private endRound(): void {
    const now = this.nowFn();
    for (const seat of this.seats) {
      seat.bet = 0;
      seat.insurance = 0;
      seat.insuranceOffered = false;
      seat.insuranceDecided = false;
      seat.hands = [];
      seat.roundNet = null;
      seat.roundLabel = null;
      const p = seat.personId ? this.people.get(seat.personId) : null;
      seat.status = p ? 'out' : 'empty';
      if (p && p.chips < this.rules.minBet && !p.bot) {
        this.toast(`${p.name}, you are out of chips — rebuy`, 'bad', seat.index);
      }
      if (p?.bot && p.chips < this.rules.minBet * 4) {
        p.chips += this.rules.rebuyAmount; // house bots never go broke
        this.houseLedger -= this.rules.rebuyAmount;
      }
    }
    this.tableNetLast = 0;
    this.beginBetting(now);
  }

  /**
   * Hold a dropped player's seat long enough for a page refresh, then release
   * it so the table never fills up with ghosts.
   */
  private reapAbsent(now: number): void {
    for (const p of [...this.people.values()]) {
      if (p.bot || p.connected || !p.disconnectedAt) continue;
      if (now - p.disconnectedAt < this.absentGraceMs) continue;
      const seat = p.seat !== null ? this.seats[p.seat] : null;
      if (seat?.inRound) continue; // let the hand finish, then release
      this.system(`${p.name}'s seat was released`, 'info');
      this.removePerson(p.id);
    }
  }

  /* ---------------------------------------------------------------- */
  /* tick                                                              */
  /* ---------------------------------------------------------------- */

  tick(): Fx[] {
    const now = this.nowFn();
    this.drain(now);
    this.pruneToasts(now);
    this.pruneMessages(now);
    this.reapAbsent(now);

    switch (this.phase) {
      case 'shuffle':
        if (this.phaseEndsAt !== null && now >= this.phaseEndsAt) this.finishShuffle(now);
        break;
      case 'betting':
        this.runBotBets(now);
        if (this.phaseEndsAt !== null && now >= this.phaseEndsAt) this.startDeal(now);
        break;
      case 'dealing':
      case 'dealer':
        break;
      case 'insurance':
        this.runBotInsurance(now);
        if (this.phaseEndsAt !== null && now >= this.phaseEndsAt) {
          for (const s of this.seats) if (s.insuranceOffered && !s.insuranceDecided) s.insuranceDecided = true;
          this.resolveInsurancePeek();
        }
        break;
      case 'players':
        this.runTurnClock(now);
        break;
      case 'settle':
        break;
      case 'idle':
        break;
    }

    if (this.phase !== 'betting' && this.phase !== 'shuffle' && this.rng() < 0.0006 && now > this.botChatAt) {
      const bot = this.randomBot();
      if (bot) { this.botChat(bot, QUIP_IDLE, 1); this.botChatAt = now + 45000; }
    }
    return this.flushFx();
  }

  private pruneToasts(now: number): void {
    if (this.toasts.length && this.toasts[0]!.at + 4200 < now) { this.toasts.shift(); this.dirty = true; }
  }

  private pruneMessages(now: number): void {
    if (this.messages.length > 80) { this.messages.splice(0, this.messages.length - 80); this.dirty = true; }
    void now;
  }

  private runBotBets(now: number): void {
    for (const seat of this.seats) {
      if (!seat.personId) { seat.botBetAt = null; continue; }
      const p = this.people.get(seat.personId);
      if (!p?.bot) { seat.botBetAt = null; continue; }
      if (seat.bet > 0 || p.chips < this.rules.minBet) { seat.botBetAt = null; continue; }
      if (seat.botBetAt === null) {
        // bots that arrive mid-window still get a beat before committing
        const room = Math.max(900, (this.phaseEndsAt ?? now + 4000) - now - 800);
        seat.botBetAt = now + 400 + Math.floor(this.rng() * room);
        continue;
      }
      if (now < seat.botBetAt) continue;
      seat.botBetAt = null;
      const bet = this.botWager(p, seat);
      if (bet >= this.rules.minBet && bet <= p.chips) {
        p.chips -= bet;
        seat.bet = bet;
        p.lastBet = bet;
        p.lastAction = 'bet';
        p.lastActionAt = now;
        this.sound('chipSoft');
        this.dirty = true;
      }
    }
  }

  private botWager(p: Person, seat: SeatState): number {
    const profile = BOT_PROFILES[p.profile % BOT_PROFILES.length]!;
    const { minBet, maxBet } = this.rules;
    if (p.chips < minBet) return 0;
    const streakAdj = p.stats.streak >= 2 ? profile.winningsPress : p.stats.streak <= -2 ? profile.lossChase : 1;
    const jitter = 1 + (this.rng() - 0.5) * profile.variance;
    let base = minBet * profile.baseBet * streakAdj * jitter;
    if (seat.bet > 0) base = seat.bet; // already committed a rebet
    base = Math.round(base / minBet) * minBet;
    base = Math.max(minBet, Math.min(maxBet, Math.min(base, p.chips)));
    return base;
  }

  private runBotInsurance(now: number): void {
    for (const seat of this.seats) {
      if (!seat.personId || !seat.insuranceOffered || seat.insuranceDecided) continue;
      const p = this.people.get(seat.personId);
      if (!p) { seat.insuranceDecided = true; continue; }
      if (!p.bot) continue;
      if (seat.botActAt === null || now < seat.botActAt) continue;
      // basic strategy: never insure (except a tiny bit of personality noise)
      const take = this.rng() < 0.08;
      this.takeInsurance(p.id, take);
    }
  }

  private runTurnClock(now: number): void {
    if (!this.turn) { this.nextTurn(); return; }
    const seat = this.seats[this.turn.seat];
    if (!seat || !seat.inRound) { this.nextTurn(); return; }
    const p = this.people.get(seat.personId ?? '');
    if (p?.bot && seat.botActAt !== null && now >= seat.botActAt) {
      this.botDecide(seat);
      return;
    }
    if (!p) {
      if (seat.timerEndsAt !== null && now >= seat.timerEndsAt) this.applyAction(seat.index, 'stand');
      return;
    }
    if (seat.timerEndsAt !== null && now >= seat.timerEndsAt) {
      if (!p.bot) {
        this.system(`${p.name} ran out of time — auto stand`, 'info');
        this.sound('deny');
      }
      this.applyAction(seat.index, 'stand');
    }
  }

  private botDecide(seat: SeatState): void {
    const p = this.people.get(seat.personId ?? '');
    const hand = seat.hands[seat.handCursor];
    if (!p || !hand) { this.applyAction(seat.index, 'stand'); return; }
    const t = fullTotal(hand.cards);
    if (!t) { this.applyAction(seat.index, 'stand'); return; }
    const avail = this.availableActions(seat.index, seat.handCursor);
    const profile = BOT_PROFILES[p.profile % BOT_PROFILES.length]!;
    const advice = advise({
      cards: hand.cards.map((c) => c.rank),
      total: t.best,
      soft: t.soft,
      dealerUp: this.dealerCards[0]?.rank ?? null,
      canDouble: avail.double,
      canSplit: avail.split,
      canSurrender: avail.surrender,
      firstTwoCards: hand.cards.length === 2 && !hand.decided,
      splitAces: hand.splitAces && this.rules.splitAcesOneCard,
    });
    let action = advice.action;
    // personality deviation
    if (this.rng() > profile.discipline) {
      if (profile.style === 'maniac' && (action === 'stand' || action === 'hit') && avail.double) action = 'double';
      else if (profile.style === 'tourist' && action === 'surrender' && avail.hit) action = 'hit';
      else if (profile.style === 'ice' && action === 'double' && t.best < 10) action = 'hit';
      else if (profile.style === 'shark' && action === 'hit' && t.best >= 17) action = 'stand';
    }
    if (action === 'double' && !avail.double) action = advice.fallback ?? 'hit';
    if (action === 'split' && !avail.split) action = 'hit';
    if (action === 'surrender' && !avail.surrender) action = advice.fallback ?? 'hit';
    if (action === 'hit' && !avail.hit) action = 'stand';
    if (action === 'stand' && !avail.stand) action = 'hit';
    if (!avail[action]) action = avail.stand ? 'stand' : 'hit';
    this.applyAction(seat.index, action);
  }

  private randomBot(): Person | undefined {
    const bots = [...this.people.values()].filter((p) => p.bot && p.seat !== null);
    if (bots.length === 0) return undefined;
    return bots[Math.floor(this.rng() * bots.length)];
  }

  private botChat(p: Person, lines: string[], chance = 0.5): void {
    if (this.rng() > chance) return;
    const line = lines[Math.floor(this.rng() * lines.length)]!;
    this.pushChat({ id: uid('m'), kind: 'bot', from: p.name, fromId: p.id, hue: p.hue, text: line, at: this.nowFn() });
  }

  /* ---------------------------------------------------------------- */
  /* chat                                                              */
  /* ---------------------------------------------------------------- */

  chat(personId: string, text: string): { ok: boolean; error?: string } {
    const p = this.people.get(personId);
    if (!p) return { ok: false, error: 'unknown player' };
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 220);
    if (!clean) return { ok: false, error: 'empty' };
    this.pushChat({ id: uid('m'), kind: p.bot ? 'bot' : 'player', from: p.name, fromId: p.id, hue: p.hue, text: clean, at: this.nowFn() });
    this.sound('chat');
    return { ok: true };
  }

  system(text: string, tone: 'info' | 'good' | 'bad' | 'epic' = 'info'): void {
    this.pushChat({
      id: uid('m'), kind: tone === 'info' ? 'system' : 'deal', from: 'TABLE',
      fromId: 'table', hue: 190, text, at: this.nowFn(), tone,
    });
  }

  private pushChat(m: ChatView): void {
    this.messages.push(m);
    if (this.messages.length > 80) this.messages.shift();
    this.dirty = true;
  }

  /* ---------------------------------------------------------------- */
  /* view                                                              */
  /* ---------------------------------------------------------------- */

  view(): TableView {
    const now = this.nowFn();
    const seats: SeatView[] = this.seats.map((s) => this.seatView(s, now));
    const dealerTotal = this.holeRevealed ? handTotal(this.dealerCards) : null;
    const upCards = this.dealerCards.filter((c) => !c.hidden);
    const spectators: SpectatorView[] = [...this.people.values()]
      .filter((p) => p.seat === null)
      .map((p) => ({ id: p.id, name: p.name, hue: p.hue, bot: p.bot }));
    const leaderboard = [...this.people.values()]
      .filter((p) => p.stats.rounds > 0 || p.seat !== null)
      .map((p) => ({ id: p.id, name: p.name, hue: p.hue, chips: p.chips, net: p.stats.net, bot: p.bot }))
      .sort((a, b) => b.net - a.net || b.chips - a.chips)
      .slice(0, 8);
    const hottest = [...this.people.values()]
      .filter((p) => p.stats.streak >= 2)
      .sort((a, b) => b.stats.streak - a.stats.streak)[0] ?? null;

    return {
      roomId: this.roomId,
      name: this.name,
      code: this.code,
      private: this.isPrivate,
      phase: this.phase,
      phaseEndsAt: this.phaseEndsAt,
      round: this.round,
      rules: this.rules,
      shoe: this.shoeView(),
      dealer: {
        cards: this.dealerCards.map(toView),
        total: dealerTotal,
        upTotal: upCards.length ? handTotal(upCards) : null,
        holeRevealed: this.holeRevealed,
        bust: dealerTotal?.bust ?? false,
        blackjack: dealerTotal?.blackjack ?? false,
      },
      seats,
      spectators,
      turn: this.turn,
      messages: this.messages.slice(-60),
      history: this.history.slice(0, 14),
      toasts: this.toasts.slice(-4),
      leaderboard,
      serverTime: now,
      houseNet: this.houseLedger,
      tableNet: this.tableNetLast,
      hottest: hottest ? { name: hottest.name, hue: hottest.hue, streak: hottest.stats.streak } : null,
    };
  }

  private shoeView(): ShoeView {
    return {
      decks: this.rules.decks,
      total: this.shoe.total,
      remaining: this.shoe.remaining,
      penetration: this.shoe.penetration,
      reshuffleAt: Math.floor(this.shoe.total * this.rules.penetration),
      shuffling: this.shuffling,
      discarded: this.discard,
    };
  }

  private seatView(s: SeatState, now: number): SeatView {
    const p = s.personId ? this.people.get(s.personId) : undefined;
    const occupant: OccupantView | null = p ? {
      id: p.id, name: p.name, hue: p.hue, bot: p.bot, connected: p.connected,
      chips: p.chips, lastAction: p.lastAction, lastActionAt: p.lastActionAt,
      thinking: p.thinking, autoRebet: p.autoRebet, stats: p.stats,
    } : null;
    const hands: HandView[] = s.hands.map((h) => {
      const vis = handTotal(h.cards);
      const real = fullTotal(h.cards);
      const total: HandTotal | null = h.cards.some((c) => c.hidden) ? vis : real;
      return {
        id: h.id,
        cards: h.cards.map(toView),
        bet: h.bet,
        doubled: h.doubled,
        split: h.split,
        surrendered: h.surrendered,
        done: h.done,
        total,
        result: h.result,
        payout: h.payout,
      };
    });
    let status = s.status;
    if (!p && s.personId === null && s.hands.length === 0) status = 'empty';
    if (this.phase === 'betting' && p && s.bet === 0 && status !== 'turn') status = 'betting';
    return {
      index: s.index,
      occupant,
      bet: s.bet,
      insurance: s.insurance,
      hands,
      handCursor: s.handCursor,
      status,
      inRound: s.inRound,
      timerEndsAt: s.timerEndsAt !== null && s.timerEndsAt > now ? s.timerEndsAt : null,
      roundNet: s.roundNet,
      roundLabel: s.roundLabel,
      insuranceOffered: s.insuranceOffered && !s.insuranceDecided && this.phase === 'insurance',
    };
  }

  hintFor(seatIdx: number, handIdx: number) {
    const seat = this.seats[seatIdx];
    const hand = seat?.hands[handIdx];
    if (!hand) return null;
    const t = fullTotal(hand.cards);
    if (!t) return null;
    const avail = this.availableActions(seatIdx, handIdx);
    return advise({
      cards: hand.cards.map((c) => c.rank),
      total: t.best,
      soft: t.soft,
      dealerUp: this.dealerCards[0]?.rank ?? null,
      canDouble: avail.double,
      canSplit: avail.split,
      canSurrender: avail.surrender,
      firstTwoCards: hand.cards.length === 2 && !hand.decided,
      splitAces: hand.splitAces && this.rules.splitAcesOneCard,
    });
  }

  chipsFor(amount: number): number[] { return chipBreakdown(amount); }

  /** Full rules text for the UI panel. */
  rulesText(): string[] {
    const r = this.rules;
    return [
      `${r.decks} decks · shuffle at ${Math.round(r.penetration * 100)}% penetration`,
      `Blackjack pays ${r.blackjackPays === 1.5 ? '3 to 2' : `${r.blackjackPays * 100}%`}`,
      `Dealer ${r.dealerStandsSoft17 ? 'stands' : 'hits'} soft 17`,
      r.doubleAnyTwo ? 'Double on any two cards' : 'Double on 9–11 only',
      r.doubleAfterSplit ? 'Double after split allowed' : 'No double after split',
      `Split up to ${r.maxSplits + 1} hands${r.splitAcesOneCard ? ' · aces take one card' : ''}`,
      r.surrender === 'late' ? 'Late surrender' : 'No surrender',
      r.fiveCardCharlie ? 'Five card Charlie auto-wins' : 'No five card Charlie',
      `Insurance pays ${r.insurancePays} to 1`,
      `Limits ${r.minBet}–${r.maxBet}`,
    ];
  }
}

export function emptyStats(): PlayerStats {
  return {
    rounds: 0, hands: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, busts: 0,
    biggestWin: 0, wagered: 0, net: 0, streak: 0, bestStreak: 0,
  };
}

function newHand(bet: number): HandState {
  return {
    id: uid('h'), cards: [], bet, doubled: false, split: false, splitAces: false,
    surrendered: false, done: false, result: null, payout: 0, decided: false,
  };
}

export { RANK_VALUE, isTen };
