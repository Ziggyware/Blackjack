import type { CardView, HandTotal, Rank, Suit } from './types.js';
import { RANKS, SUITS } from './types.js';

export const RANK_VALUE: Record<Rank, number> = {
  A: 11, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, J: 10, Q: 10, K: 10,
};

export interface Card {
  id: string;
  rank: Rank;
  suit: Suit;
  hidden: boolean;
  seq: number;
  at: number;
}

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cards left in a freshly built shoe of `decks` decks. */
export function freshDeckCodes(decks: number): { rank: Rank; suit: Suit }[] {
  const out: { rank: Rank; suit: Suit }[] = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) for (const rank of RANKS) out.push({ rank, suit });
  }
  return out;
}

export class Shoe {
  private cards: { rank: Rank; suit: Suit }[];
  private cursor = 0;
  private uid = 0;
  readonly decks: number;
  readonly total: number;
  private rng: Rng;

  constructor(decks: number, rng: Rng = Math.random) {
    this.decks = decks;
    this.rng = rng;
    this.cards = freshDeckCodes(decks);
    this.total = this.cards.length;
    this.shuffle();
  }

  shuffle(): void {
    // Fisher–Yates
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      const tmp = this.cards[i]!;
      this.cards[i] = this.cards[j]!;
      this.cards[j] = tmp;
    }
    this.cursor = 0;
  }

  get remaining(): number {
    return this.cards.length - this.cursor;
  }

  get penetration(): number {
    return this.cursor / this.cards.length;
  }

  draw(now: number): Card | null {
    const proto = this.cards[this.cursor];
    if (!proto) return null;
    this.cursor++;
    this.uid++;
    return {
      id: `c${this.uid}_${proto.rank}${proto.suit}`,
      rank: proto.rank,
      suit: proto.suit,
      hidden: false,
      seq: this.uid,
      at: now,
    };
  }

  /** Peek without consuming (used for tests / dealer-hole logic). */
  peek(offset = 0): { rank: Rank; suit: Suit } | null {
    return this.cards[this.cursor + offset] ?? null;
  }
}

export function isTen(rank: Rank): boolean {
  return rank === '10' || rank === 'J' || rank === 'Q' || rank === 'K';
}

export function handTotal(cards: Card[]): HandTotal | null {
  const visible = cards.filter((c) => !c.hidden);
  if (visible.length === 0) return null;
  let total = 0;
  let aces = 0;
  for (const c of visible) {
    if (c.rank === 'A') { aces++; total += 11; } else total += RANK_VALUE[c.rank];
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  const soft = aces > 0 && total <= 21;
  return {
    best: total,
    soft,
    bust: total > 21,
    blackjack: visible.length === 2 && total === 21,
    count: visible.length,
  };
}

/** Total of every card including hidden ones — engine-internal only. */
export function fullTotal(cards: Card[]): HandTotal | null {
  return handTotal(cards.map((c) => ({ ...c, hidden: false })));
}

export function toView(card: Card): CardView {
  return card.hidden
    ? { id: card.id, seq: card.seq, at: card.at, hidden: true }
    : { id: card.id, seq: card.seq, at: card.at, hidden: false, rank: card.rank, suit: card.suit };
}

/**
 * Break a wager into the house chip denominations, biggest first.
 * Used to render physical chip stacks.
 */
export function chipBreakdown(amount: number, denominations: readonly number[] = [5000, 1000, 500, 100, 25, 5, 1]): number[] {
  const out: number[] = [];
  let left = Math.max(0, Math.floor(amount));
  for (const d of denominations) {
    while (left >= d && out.length < 40) { out.push(d); left -= d; }
  }
  if (left > 0 && out.length < 40) out.push(left);
  return out;
}
