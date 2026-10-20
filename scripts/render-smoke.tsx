/**
 * Headless render smoke test.
 * Builds a real table snapshot with the engine, pushes it into the client store,
 * and server-renders the whole React tree. Catches crashes in Seat / Dock /
 * Panel / Felt that a type-check cannot, without needing a browser.
 *
 *   npx tsx scripts/render-smoke.tsx
 */
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { Table, DEFAULT_RULES, mulberry32 } from '@velvet/shared';
import type { TableView } from '@velvet/shared';

// jsdom-free globals the components touch during render
const g = globalThis as unknown as { window?: unknown; document?: unknown; localStorage?: unknown; navigator?: unknown };
const store = new Map<string, string>();
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
g.window = {
  addEventListener: () => {}, removeEventListener: () => {},
  innerWidth: 1600, innerHeight: 900, devicePixelRatio: 2,
  location: { protocol: 'http:', host: 'localhost:5173' },
  AudioContext: undefined,
};
g.document = { hidden: false, addEventListener: () => {}, querySelector: () => null, getElementById: () => null };
Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true });

// framer-motion reaches for DOM globals even during a server render
class FakeElement { tagName = 'div'; style = {}; getBoundingClientRect() { return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; } }
class FakeSVGElement extends FakeElement { override tagName = 'svg'; }
const gg = globalThis as unknown as Record<string, unknown>;
gg.SVGElement = FakeSVGElement;
gg.HTMLElement = FakeElement;
gg.Element = FakeElement;
gg.Node = FakeElement;
gg.Event = class { type = ''; };
gg.getComputedStyle = () => ({ getPropertyValue: () => '' });

const { useStore } = await import('../client/src/state/store.js');
const App = (await import('../client/src/App.js')).default;

/**
 * React's server renderer reads useSyncExternalStore's *server* snapshot, which
 * zustand wires to getInitialState(). So for a headless render we have to write
 * into that initial object as well as the live store.
 */
function setForRender(partial: Record<string, unknown>): void {
  const init = useStore.getInitialState() as unknown as Record<string, unknown>;
  Object.assign(init, partial);
  useStore.setState(partial);
}

const failures: string[] = [];
const check = (cond: boolean, label: string) => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failures.push(label);
};

function snapshotAt(seed: number, rounds: number): { view: TableView; humanId: string } {
  let t = 1_700_000_000_000;
  const table = new Table({
    roomId: 'r-render', name: 'NEON HOUSE', code: 'REND', seatCount: 7,
    now: () => t, rng: mulberry32(seed),
    rules: { ...DEFAULT_RULES, betSeconds: 3, turnSeconds: 2 },
  });
  table.addBots(4);
  const human = table.addPerson({ name: 'You', hue: 320 });
  table.sit(human.id, 3);
  for (let i = 0; i < rounds * 200; i++) {
    t += 50;
    if (table.phase === 'betting') table.placeBet(human.id, 250);
    if (table.phase === 'players' && table.turn && table.seatOf(human.id) === table.turn.seat) {
      const acts = table.availableActions(table.turn.seat, table.turn.hand);
      table.act(human.id, acts.stand ? 'stand' : 'hit');
    }
    if (table.phase === 'insurance') table.takeInsurance(human.id, false);
    table.tick();
  }
  return { view: table.view(), humanId: human.id };
}

console.log('\n♠  VELVET client render smoke test\n');

// ---- lobby (no table yet) ----
setForRender({ atTable: false, table: null, rooms: [
  { roomId: 'a', name: 'NEON HOUSE', code: 'NEON', private: false, players: 4, seats: 7, freeSeats: 3,
    phase: 'betting', minBet: 10, maxBet: 2500, tagline: 'Flagship floor', accent: 322, fiveCardCharlie: false },
], status: 'open', kind: 'remote', booted: true });
const lobbyHtml = renderToString(createElement(App));
check(lobbyHtml.includes('VELVET'), 'lobby renders the wordmark');
check(lobbyHtml.includes('NEON HOUSE'), 'lobby lists the rooms');
check(lobbyHtml.includes('Play money') || lobbyHtml.includes('play money'), 'lobby carries the play-money disclaimer');
check(lobbyHtml.includes('Identity hue'), 'lobby renders the identity controls');

// ---- mid-round table ----
const { view, humanId } = snapshotAt(9, 4);
setForRender({ atTable: true, table: view, you: humanId, roomId: view.roomId, status: 'open', kind: 'remote' });
const html = renderToString(createElement(App));

check(html.includes('Bankroll'), 'dock renders the bankroll');
check(html.includes('Dealer') || html.includes('DEALER'), 'dealer area renders');
check(view.seats.some((s) => s.occupant) && html.includes(view.seats.find((s) => s.occupant)!.occupant!.name), 'seat pods render player names');
check(html.includes('card__face'), 'playing cards render faces');
check(html.includes('Hands') && html.includes('Ranks') && html.includes('Rules'), 'side panel renders its tabs');
check(html.includes('Say something') || html.includes('quiet'), 'table chat renders');
check(html.includes(view.code), 'table code is shown');
check(html.includes('PLACE YOUR BETS') || html.includes('YOUR MOVE') || html.includes('DEALING') || html.includes('SETTLING') || html.includes('STANDING BY') || html.includes('S MOVE') || html.includes('SHUFFLING') || html.includes('BET LOCKED') || html.includes('INSURANCE'), 'dock status line renders');
check(html.includes('shoemeter'), 'shoe penetration meter renders');
check(html.includes('textPath') || html.includes('velvetArc'), 'felt arc lettering renders');

// ---- a snapshot with real hands on the table ----
const mid = snapshotAt(1234, 2);
const withHands: TableView = {
  ...mid.view,
  phase: 'players',
  turn: { seat: 3, hand: 0 },
  seats: mid.view.seats.map((s) => (s.index === 3 ? {
    ...s,
    inRound: true,
    status: 'turn' as const,
    bet: 250,
    timerEndsAt: Date.now() + 12000,
    hands: [{
      id: 'h1', bet: 250, doubled: false, split: false, surrendered: false, done: false,
      result: null, payout: 0, total: { best: 16, soft: false, bust: false, blackjack: false, count: 2 },
      cards: [
        { id: 'c1', seq: 1, at: Date.now(), hidden: false, rank: '10' as const, suit: 'S' as const },
        { id: 'c2', seq: 2, at: Date.now(), hidden: false, rank: '6' as const, suit: 'H' as const },
      ],
    }],
  } : s)),
  dealer: {
    ...mid.view.dealer,
    cards: [
      { id: 'd1', seq: 3, at: Date.now(), hidden: false, rank: '9' as const, suit: 'D' as const },
      { id: 'd2', seq: 4, at: Date.now(), hidden: true },
    ],
  },
};
setForRender({ table: withHands, you: mid.humanId });
const playHtml = renderToString(createElement(App));
check(playHtml.includes('Hit') && playHtml.includes('Stand'), 'action buttons render on your turn');
check(playHtml.includes('Surrender') || playHtml.includes('Fold'), 'surrender is offered with late surrender');
check(playHtml.includes('card__face--back'), 'the dealer hole card renders face down');
check(playHtml.includes('Coach') || playHtml.includes('COACH'), 'the strategy coach renders');
check(!playHtml.includes('"rank":"?"'), 'no placeholder ranks leaked into the markup');

console.log('');
if (failures.length) {
  console.log(`✗ ${failures.length} render check(s) failed`);
  process.exit(1);
}
console.log('✓ the whole client tree renders against live engine data\n');
process.exit(0);
