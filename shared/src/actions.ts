import type { HandTotal, Phase, Rank, Rules } from './types.js';
import { pairRank } from './strategy.js';

export interface ActionContext {
  cards: Rank[];
  total: HandTotal | null;
  phase: Phase;
  isTurn: boolean;
  handCount: number;
  chips: number;
  bet: number;
  doubled: boolean;
  split: boolean;
  splitAces: boolean;
  /** the player has already made a decision on this hand */
  decided: boolean;
  dealerUp: Rank | null;
  rules: Rules;
  insuranceOffered: boolean;
  insuranceDecided: boolean;
  inRound: boolean;
}

export interface LegalActions {
  hit: boolean;
  stand: boolean;
  double: boolean;
  split: boolean;
  surrender: boolean;
  insurance: boolean;
}

export const NO_ACTIONS: LegalActions = {
  hit: false, stand: false, double: false, split: false, surrender: false, insurance: false,
};

/**
 * The single source of truth for "what may this hand do right now".
 * Used by the authoritative table *and* by the client so the buttons it
 * enables are exactly the moves the server will accept.
 */
export function legalActions(ctx: ActionContext): LegalActions {
  const res: LegalActions = { ...NO_ACTIONS };
  const { rules: r, total: t } = ctx;
  if (!t) return res;

  const live = ctx.isTurn && !t.bust;

  res.insurance = ctx.phase === 'insurance' && ctx.inRound && ctx.insuranceOffered
    && !ctx.insuranceDecided && ctx.chips >= Math.floor(ctx.bet / 2) && ctx.bet > 0;

  if (ctx.phase !== 'players' || !live) return res;

  const oneCardAces = ctx.splitAces && r.splitAcesOneCard;
  res.stand = true;
  res.hit = !oneCardAces && t.count < 11;

  const doubleOkCards = r.doubleAnyTwo ? t.count === 2 : (t.count === 2 && t.best >= 9 && t.best <= 11);
  const afterSplitOk = !ctx.split || r.doubleAfterSplit;
  res.double = doubleOkCards && afterSplitOk && !ctx.doubled && !oneCardAces && ctx.chips >= ctx.bet;

  const pr = pairRank(ctx.cards);
  res.split = !!pr && ctx.cards.length === 2
    && ctx.handCount - 1 < r.maxSplits
    && ctx.chips >= ctx.bet
    && !oneCardAces;

  res.surrender = r.surrender === 'late'
    && !ctx.decided && ctx.cards.length === 2 && !ctx.split && !ctx.doubled;

  return res;
}

export const ACTION_KEYS: Record<string, string> = {
  hit: 'h', stand: 's', double: 'd', split: 'p', surrender: 'r',
};
