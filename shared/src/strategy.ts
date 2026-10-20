import { RANK_VALUE, isTen } from './cards.js';
import type { Rank } from './types.js';

/**
 * Basic strategy for a 6-deck shoe, dealer stands soft 17, double after split,
 * late surrender. Used by the house bots and by the optional "Coach" overlay so
 * a human can learn perfect play at the table.
 */

export type StrategyAction = 'hit' | 'stand' | 'double' | 'split' | 'surrender';

export interface StrategyContext {
  cards: Rank[];
  total: number;
  soft: boolean;
  dealerUp: Rank | null;
  canDouble: boolean;
  canSplit: boolean;
  canSurrender: boolean;
  firstTwoCards: boolean;
  splitAces: boolean;
}

export interface Advice {
  action: StrategyAction;
  label: string;
  reason: string;
  /** 0..1 — how strongly the chart backs this call */
  confidence: number;
  fallback?: StrategyAction;
}

const UP_ORDER: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];
const upIndex = (r: Rank | null): number => (r === null ? 9 : UP_ORDER.indexOf(r === 'J' || r === 'Q' || r === 'K' ? '10' : r));

// hard totals: rows 5..21, columns 2..A
const HARD: Record<number, string> = {
  5: 'HHHHHHHHHH', 6: 'HHHHHHHHHH', 7: 'HHHHHHHHHH', 8: 'HHHHHHHHHH',
  9: 'HHDDDHHHHH', 10: 'DDDDDDDDHH', 11: 'DDDDDDDDDD',
  12: 'HHSSSSHHHH', 13: 'SSSSSHHHHH', 14: 'SSSSSHHHHH', 15: 'SSSSSHHHHR',
  16: 'SSSSSHHHRR', 17: 'SSSSSSSSSS', 18: 'SSSSSSSSSS', 19: 'SSSSSSSSSS',
  20: 'SSSSSSSSSS', 21: 'SSSSSSSSSS',
};

// soft totals keyed by (11 + kicker) => "A,x"
const SOFT: Record<number, string> = {
  13: 'HHHDDHHHHH', // A,2
  14: 'HHHDDHHHHH', // A,3
  15: 'HHDDDHHHHH', // A,4
  16: 'HHDDDHHHHH', // A,5
  17: 'HHDDDDHHHH', // A,6
  // A,7 -> stand 2, double 3-6, stand 7/8, hit 9/10/A
  18: 'SDDDDSSHHH',
  19: 'SSSSSSSSSS', // A,8
  20: 'SSSSSSSSSS', // A,9
};

const PAIRS: Record<string, string> = {
  A: 'SSSSSSSSSS',
  '2': 'SSSSSSHHHH',
  '3': 'SSSSSSHHHH',
  '4': 'HHHSSHHHHH',
  '5': 'DDDDDDDDHH', // treat as hard 10
  '6': 'SSSSSSHHHH',
  '7': 'SSSSSSHHHH',
  '8': 'SSSSSSSSSS',
  '9': 'SSSSSSHSSS',
  '10': 'HHHHHHHHHH',
};

function chartChar(table: string, up: Rank | null): string {
  const i = Math.max(0, upIndex(up));
  return table[i] ?? 'H';
}

/** Late surrender exceptions, 6-deck S17. */
function surrenderBeats(total: number, soft: boolean, pair: Rank | null, up: Rank | null): boolean {
  if (soft) return false;
  const i = upIndex(up);
  const upIsTen = up !== null && (up === '10' || isTen(up));
  if (total === 16 && pair !== '8' && (i === 7 || upIsTen || up === 'A')) return true;
  if (total === 15 && (upIsTen || up === 'A')) return true;
  return false;
}

export function pairRank(cards: Rank[]): Rank | null {
  if (cards.length !== 2) return null;
  const [a, b] = cards as [Rank, Rank];
  const norm = (r: Rank) => (isTen(r) ? '10' : r);
  return norm(a) === norm(b) ? norm(a) : null;
}

export function advise(ctx: StrategyContext): Advice {
  if (ctx.splitAces) {
    return { action: 'stand', label: 'Stand', reason: 'Split aces take one card each.', confidence: 1 };
  }
  const up = ctx.dealerUp;
  const pair = pairRank(ctx.cards);
  const upWeak = up !== null && (up === '2' || up === '3' || up === '4' || up === '5' || up === '6');

  if (ctx.canSurrender && ctx.firstTwoCards && surrenderBeats(ctx.total, ctx.soft, pair, up)) {
    return {
      action: 'surrender', label: 'Surrender', confidence: 0.78,
      reason: `${ctx.total} against a dealer ${up ?? '?'} loses more than half the time — fold for half.`,
      fallback: 'hit',
    };
  }

  let code: string;
  let bucket: string;
  if (pair && ctx.canSplit) {
    code = chartChar(PAIRS[pair] ?? 'HHHHHHHHHH', up);
    bucket = `pair of ${pair}s`;
    if (code === 'S') {
      return { action: 'split', label: 'Split', confidence: 0.9, reason: `Always split a ${bucket}.`, fallback: 'hit' };
    }
  }

  if (ctx.soft) {
    const key = Math.min(20, Math.max(13, ctx.total));
    code = chartChar(SOFT[key] ?? 'HHHHHHHHHH', up);
    bucket = `soft ${ctx.total}`;
  } else {
    const key = Math.min(21, Math.max(5, ctx.total));
    code = chartChar(HARD[key] ?? 'HHHHHHHHHH', up);
    bucket = `${ctx.total}`;
  }

  const dealerHole = up === 'A' ? 'a possible blackjack' : upWeak ? 'a stiff hand' : 'a strong upcard';

  switch (code) {
    case 'D':
      return ctx.canDouble
        ? { action: 'double', label: 'Double', confidence: 0.92, reason: `${bucket} vs ${up ?? '?'} — press the edge.`, fallback: 'hit' }
        : { action: 'hit', label: 'Hit', confidence: 0.7, reason: `${bucket} vs ${up ?? '?'} — double not available, so hit.` };
    case 'S':
      return { action: 'stand', label: 'Stand', confidence: 0.95, reason: `${bucket} vs ${dealerHole} — let the dealer break it.` };
    case 'R':
      return ctx.canSurrender
        ? { action: 'surrender', label: 'Surrender', confidence: 0.75, reason: `${bucket} vs ${dealerHole} — fold for half.`, fallback: 'hit' }
        : { action: 'hit', label: 'Hit', confidence: 0.6, reason: `${bucket} vs ${dealerHole} — no surrender, so hit.` };
    default:
      return { action: 'hit', label: 'Hit', confidence: 0.9, reason: `${bucket} vs ${dealerHole} — take a card.` };
  }
}

/**
 * Rough "hand pulse" 0..1 used by the UI tension meter.
 * Not an exact EV — a tuned heuristic that reads well at a glance.
 */
export function handPulse(total: number, soft: boolean, dealerUp: Rank | null): number {
  if (total > 21) return 0;
  if (total === 21) return 1;
  const base = soft ? Math.min(1, (total - 4) / 16) : Math.min(1, Math.max(0, (total - 4) / 17));
  const upVal = dealerUp ? (dealerUp === 'A' ? 11 : RANK_VALUE[dealerUp]) : 10;
  const dealerThreat = upVal === 11 ? 0.22 : upVal >= 7 ? 0.16 : -0.06;
  return Math.max(0.02, Math.min(0.99, base * 0.85 + 0.15 - dealerThreat));
}

/** Insurance is a side bet with a ~7.4% house edge — always decline. */
export function insuranceAdvice(dealerUp: Rank | null, playerHand: Rank[]): boolean {
  void dealerUp; void playerHand;
  return false;
}

export const STRATEGY_LABEL: Record<StrategyAction, string> = {
  hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split', surrender: 'Surrender',
};
