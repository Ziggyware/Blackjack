/**
 * VELVET — shared protocol & domain types.
 * Everything here is isomorphic: it runs identically on the Node table server
 * and inside the browser (offline "local table" fallback + bots).
 */

export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank =
  | 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
export const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** A card as the *client* is allowed to see it. Hidden cards carry no rank/suit. */
export interface CardView {
  id: string;
  /** monotonic deal order inside the round — drives animation stagger */
  seq: number;
  /** server timestamp of the deal, ms */
  at: number;
  hidden: boolean;
  rank?: Rank;
  suit?: Suit;
}

export interface HandTotal {
  best: number;
  soft: boolean;
  bust: boolean;
  blackjack: boolean;
  count: number;
}

export type HandResult =
  | 'win' | 'lose' | 'push' | 'blackjack' | 'bust' | 'surrender' | 'charlie';

export interface HandView {
  id: string;
  cards: CardView[];
  bet: number;
  doubled: boolean;
  split: boolean;
  surrendered: boolean;
  done: boolean;
  total: HandTotal | null;
  result: HandResult | null;
  /** net chips for this hand (positive = won) */
  payout: number;
}

export type ActionKind =
  | 'hit' | 'stand' | 'double' | 'split' | 'surrender' | 'insurance' | 'bet' | 'rebet';

export interface PlayerStats {
  rounds: number;
  hands: number;
  wins: number;
  losses: number;
  pushes: number;
  blackjacks: number;
  busts: number;
  biggestWin: number;
  wagered: number;
  net: number;
  streak: number;
  bestStreak: number;
}

export interface OccupantView {
  id: string;
  name: string;
  hue: number;
  bot: boolean;
  connected: boolean;
  chips: number;
  lastAction: ActionKind | null;
  lastActionAt: number;
  thinking: boolean;
  autoRebet: boolean;
  stats: PlayerStats;
}

export type SeatStatus =
  | 'empty' | 'out' | 'betting' | 'turn' | 'waiting' | 'done' | 'settled';

export interface SeatView {
  index: number;
  occupant: OccupantView | null;
  bet: number;
  insurance: number;
  hands: HandView[];
  handCursor: number;
  status: SeatStatus;
  inRound: boolean;
  timerEndsAt: number | null;
  /** chips won/lost in the round that just settled */
  roundNet: number | null;
  roundLabel: string | null;
  insuranceOffered: boolean;
}

export interface SpectatorView {
  id: string;
  name: string;
  hue: number;
  bot: boolean;
}

export type Phase =
  | 'idle' | 'shuffle' | 'betting' | 'dealing' | 'insurance'
  | 'players' | 'dealer' | 'settle';

export interface Rules {
  decks: number;
  dealerStandsSoft17: boolean;
  blackjackPays: number;      // 1.5 = 3:2
  insurancePays: number;      // 2 = 2:1
  doubleAnyTwo: boolean;
  doubleAfterSplit: boolean;
  maxSplits: number;          // 3 -> up to 4 hands
  splitAcesOneCard: boolean;
  surrender: 'late' | 'none';
  fiveCardCharlie: boolean;
  minBet: number;
  maxBet: number;
  betSeconds: number;
  turnSeconds: number;
  startingChips: number;
  rebuyAmount: number;
  /** reshuffle once the shoe drops below this fraction */
  penetration: number;
}

export interface ShoeView {
  decks: number;
  total: number;
  remaining: number;
  penetration: number;  // 0..1 consumed
  reshuffleAt: number;  // remaining cards that trigger a shuffle
  shuffling: boolean;
  discarded: number;
}

export interface DealerView {
  cards: CardView[];
  total: HandTotal | null;
  /** total of the visible upcard only, shown while the hole card is hidden */
  upTotal: HandTotal | null;
  holeRevealed: boolean;
  bust: boolean;
  blackjack: boolean;
}

export type ChatKind = 'player' | 'system' | 'bot' | 'deal';

export interface ChatView {
  id: string;
  kind: ChatKind;
  from: string;
  fromId: string;
  hue: number;
  text: string;
  at: number;
  tone?: 'info' | 'good' | 'bad' | 'epic';
}

export interface HistoryHand {
  name: string;
  hue: number;
  cards: string[];      // "A♠" style codes
  dealer: string[];
  bet: number;
  net: number;
  result: HandResult | 'insurance';
}

export interface HistoryEntry {
  round: number;
  at: number;
  dealer: string[];
  dealerTotal: number;
  hands: HistoryHand[];
  pot: number;
}

export interface ToastView {
  id: string;
  text: string;
  tone: 'info' | 'good' | 'bad' | 'epic';
  at: number;
  seat?: number;
}

export interface TableView {
  roomId: string;
  name: string;
  code: string;
  private: boolean;
  phase: Phase;
  phaseEndsAt: number | null;
  round: number;
  rules: Rules;
  shoe: ShoeView;
  dealer: DealerView;
  seats: SeatView[];
  spectators: SpectatorView[];
  turn: { seat: number; hand: number } | null;
  messages: ChatView[];
  history: HistoryEntry[];
  toasts: ToastView[];
  leaderboard: { id: string; name: string; hue: number; chips: number; net: number; bot: boolean }[];
  serverTime: number;
  /** cumulative chips the house has taken off this table */
  houseNet: number;
  /** what the players won/lost, net, in the round that just settled */
  tableNet: number;
  hottest: { name: string; hue: number; streak: number } | null;
}

/* ------------------------------------------------------------------ */
/* effects                                                             */
/* ------------------------------------------------------------------ */

export type SoundName =
  | 'deal' | 'flip' | 'chip' | 'chipSoft' | 'win' | 'blackjack' | 'bust'
  | 'push' | 'shuffle' | 'turn' | 'tick' | 'chat' | 'join' | 'click'
  | 'split' | 'deny' | 'charlie';

export type Fx =
  | { kind: 'sound'; name: SoundName; gain?: number }
  | { kind: 'burst'; tone: 'win' | 'blackjack' | 'bust' | 'push' | 'chips' | 'charlie'; seat?: number; amount?: number }
  | { kind: 'toast'; text: string; tone?: ToastView['tone']; seat?: number }
  | { kind: 'reaction'; from: string; fromId: string; hue: number; emoji: string }
  | { kind: 'phase'; phase: Phase }
  | { kind: 'shuffle' }
  | { kind: 'payout'; seat: number; amount: number };

/* ------------------------------------------------------------------ */
/* wire protocol                                                       */
/* ------------------------------------------------------------------ */

export interface JoinPayload {
  name: string;
  hue: number;
  token?: string | null;
  roomId?: string | null;
  code?: string | null;
  seat?: number | null;
}

export type ClientMsg =
  | { type: 'hello'; name: string; hue: number; token?: string | null }
  | { type: 'listRooms' }
  | { type: 'join'; payload: JoinPayload }
  | { type: 'createRoom'; name: string; private: boolean; rules?: Partial<Rules>; playerName?: string; hue?: number }
  | { type: 'leave' }
  | { type: 'sit'; seat: number }
  | { type: 'leaveSeat' }
  | { type: 'bet'; amount: number }
  | { type: 'clearBet' }
  | { type: 'autoRebet'; on: boolean }
  | { type: 'rebuy' }
  | { type: 'action'; action: 'hit' | 'stand' | 'double' | 'split' | 'surrender' }
  | { type: 'insurance'; take: boolean }
  | { type: 'chat'; text: string }
  | { type: 'reaction'; emoji: string }
  | { type: 'bots'; count: number }
  | { type: 'ping'; t: number };

export type ServerMsg =
  | { type: 'welcome'; you: string; token: string; serverTime: number; rooms: RoomSummary[] }
  | { type: 'rooms'; rooms: RoomSummary[] }
  | { type: 'joined'; roomId: string; you: string; seat: number | null; token: string }
  | { type: 'table'; state: TableView; fx: Fx[] }
  | { type: 'lobby'; state: TableView }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong'; t: number; serverTime: number };

export interface RoomSummary {
  roomId: string;
  name: string;
  code: string;
  private: boolean;
  players: number;
  seats: number;
  freeSeats: number;
  phase: Phase;
  minBet: number;
  maxBet: number;
  tagline: string;
  accent: number;
  fiveCardCharlie: boolean;
}

export const DENOMINATIONS = [5, 25, 100, 500, 1000, 5000] as const;

export const CHIP_COLORS: Record<number, { body: string; edge: string; ink: string }> = {
  1: { body: '#e8ecf5', edge: '#9aa6bf', ink: '#1b1f2b' },
  5: { body: '#ff4d6d', edge: '#ffd0d9', ink: '#2a0410' },
  25: { body: '#22e08a', edge: '#c7ffe4', ink: '#032316' },
  100: { body: '#1b1d29', edge: '#f6d99a', ink: '#f6d99a' },
  500: { body: '#8b5cf6', edge: '#e2d5ff', ink: '#170a2e' },
  1000: { body: '#22d3ee', edge: '#d3fbff', ink: '#03222a' },
  5000: { body: '#ff3ea5', edge: '#ffd6ee', ink: '#2b0319' },
};

export function suitSymbol(suit: Suit): string {
  return suit === 'S' ? '♠' : suit === 'H' ? '♥' : suit === 'D' ? '♦' : '♣';
}

export function cardCode(rank: Rank | undefined, suit: Suit | undefined): string {
  if (!rank || !suit) return '🂠';
  return `${rank}${suitSymbol(suit)}`;
}
