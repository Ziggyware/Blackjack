import { DENOMINATIONS, advise, legalActions } from '@velvet/shared';
import type { Advice, Rules } from '@velvet/shared';
import type { HandView, LegalActions, SeatView, TableView } from '@velvet/shared';

/**
 * Chip denominations that can actually be dropped on this table: a single chip
 * must already clear the minimum, or the first click would always be rejected.
 */
export function trayDenominations(rules: Rules): number[] {
  const usable = DENOMINATIONS.filter((d) => d >= rules.minBet && d <= rules.maxBet);
  return usable.length ? usable : DENOMINATIONS.filter((d) => d <= rules.maxBet);
}

export interface PlayState {
  seatIndex: number;
  seat: SeatView | null;
  seated: boolean;
  chips: number;
  betting: boolean;
  myTurn: boolean;
  hand: HandView | null;
  legal: LegalActions | null;
  advice: Advice | null;
  insuranceOpen: boolean;
  dealerUp: string | null;
}

const NONE: LegalActions = {
  hit: false, stand: false, double: false, split: false, surrender: false, insurance: false,
};

/**
 * Everything the client needs to know about "what can I do right now", derived
 * from the authoritative snapshot with the same shared rule function the server
 * uses — so an enabled button is always an accepted move.
 */
export function playState(table: TableView | null, you: string | null): PlayState {
  if (!table) {
    return {
      seatIndex: -1, seat: null, seated: false, chips: 0, betting: false, myTurn: false,
      hand: null, legal: null, advice: null, insuranceOpen: false, dealerUp: null,
    };
  }
  const seatIndex = table.seats.findIndex((s) => s.occupant?.id === you);
  const seat = seatIndex >= 0 ? table.seats[seatIndex]! : null;
  const seated = !!seat;
  const chips = seat?.occupant?.chips ?? 0;
  const betting = table.phase === 'betting' && seated && !seat!.inRound;
  const myTurn = table.phase === 'players' && table.turn !== null && table.turn.seat === seatIndex;
  const hand = myTurn ? seat?.hands[table.turn!.hand] ?? null : null;
  const upCard = table.dealer.cards[0];
  const dealerUp = upCard && !upCard.hidden ? upCard.rank ?? null : null;
  const insuranceOpen = table.phase === 'insurance' && !!seat?.insuranceOffered;

  let legal: LegalActions | null = null;
  let advice: Advice | null = null;

  if (hand && seat) {
    const ranks = hand.cards.filter((c) => !c.hidden).map((c) => c.rank!).filter(Boolean);
    const splitAces = hand.split && ranks[0] === 'A';
    legal = legalActions({
      cards: ranks,
      total: hand.total,
      phase: table.phase,
      isTurn: myTurn,
      handCount: seat.hands.length,
      chips,
      bet: hand.bet,
      doubled: hand.doubled,
      split: hand.split,
      splitAces,
      decided: hand.done || hand.cards.length > 2 || hand.doubled || hand.split,
      dealerUp,
      rules: table.rules,
      insuranceOffered: seat.insuranceOffered,
      insuranceDecided: !seat.insuranceOffered,
      inRound: seat.inRound,
    });
    if (myTurn) {
      advice = advise({
        cards: ranks,
        total: hand.total?.best ?? 0,
        soft: hand.total?.soft ?? false,
        dealerUp,
        canDouble: legal.double,
        canSplit: legal.split,
        canSurrender: legal.surrender,
        firstTwoCards: hand.cards.length === 2 && !hand.split,
        splitAces: splitAces && table.rules.splitAcesOneCard,
      });
    }
  } else if (insuranceOpen && seat) {
    legal = { ...NONE, insurance: true };
  }

  return { seatIndex, seat, seated, chips, betting, myTurn, hand, legal, advice, insuranceOpen, dealerUp };
}
