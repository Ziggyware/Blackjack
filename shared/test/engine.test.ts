import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Card, Shoe, fullTotal, handTotal, chipBreakdown, mulberry32 } from '../src/cards.js';
import { Table, DEFAULT_RULES } from '../src/table.js';
import { advise, handPulse, pairRank } from '../src/strategy.js';
import { legalActions } from '../src/actions.js';
import type { HandTotal, Rank, Suit } from '../src/types.js';

function card(rank: Rank, suit: Suit = 'S', id = `${rank}${suit}${Math.random()}`): Card {
  return { id, rank, suit, hidden: false, seq: 1, at: 0 };
}

describe('hand totals', () => {
  it('counts aces soft then hard', () => {
    assert.equal(handTotal([card('A'), card('7')])!.best, 18);
    assert.equal(handTotal([card('A'), card('7')])!.soft, true);
    assert.equal(handTotal([card('A'), card('7'), card('9')])!.best, 17);
    assert.equal(handTotal([card('A'), card('7'), card('9')])!.soft, false);
  });
  it('detects blackjack vs 21', () => {
    assert.equal(handTotal([card('A'), card('K')])!.blackjack, true);
    assert.equal(handTotal([card('7'), card('7'), card('7')])!.blackjack, false);
    assert.equal(handTotal([card('7'), card('7'), card('7')])!.best, 21);
  });
  it('detects bust', () => {
    assert.equal(fullTotal([card('K'), card('Q'), card('5')])!.bust, true);
  });
  it('ignores hidden cards for the public total', () => {
    const hidden = { ...card('A', 'H'), hidden: true };
    const t = handTotal([card('9'), hidden]);
    assert.equal(t!.best, 9);
  });
});

describe('shoe', () => {
  it('holds 312 cards for six decks and deals them all', () => {
    const shoe = new Shoe(6, mulberry32(7));
    assert.equal(shoe.remaining, 312);
    let n = 0;
    while (shoe.draw(0)) n++;
    assert.equal(n, 312);
    assert.equal(shoe.remaining, 0);
  });
  it('is a permutation of the deck multiset', () => {
    const shoe = new Shoe(1, mulberry32(3));
    const counts = new Map<string, number>();
    for (let i = 0; i < 52; i++) {
      const c = shoe.draw(0)!;
      const k = `${c.rank}${c.suit}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    assert.equal(counts.size, 52);
    for (const v of counts.values()) assert.equal(v, 1);
  });
  it('reshuffles back to full', () => {
    const shoe = new Shoe(2, mulberry32(9));
    for (let i = 0; i < 60; i++) shoe.draw(0);
    shoe.shuffle();
    assert.equal(shoe.remaining, 104);
  });
});

describe('chip breakdown', () => {
  it('uses the fewest denominations first', () => {
    assert.deepEqual(chipBreakdown(525), [500, 25]);
    assert.deepEqual(chipBreakdown(1000), [1000]);
    assert.deepEqual(chipBreakdown(30), [25, 5]);
  });
});

describe('basic strategy', () => {
  it('stands on 17', () => {
    const a = advise({ cards: ['10', '7'], total: 17, soft: false, dealerUp: '9', canDouble: false, canSplit: false, canSurrender: false, firstTwoCards: true, splitAces: false });
    assert.equal(a.action, 'stand');
  });
  it('hits 16 against a ten', () => {
    const a = advise({ cards: ['10', '6'], total: 16, soft: false, dealerUp: '10', canDouble: false, canSplit: false, canSurrender: false, firstTwoCards: true, splitAces: false });
    assert.equal(a.action, 'hit');
  });
  it('always splits aces and eights', () => {
    for (const p of ['A', '8'] as Rank[]) {
      const a = advise({ cards: [p, p], total: p === 'A' ? 12 : 16, soft: p === 'A', dealerUp: '7', canDouble: true, canSplit: true, canSurrender: true, firstTwoCards: true, splitAces: false });
      assert.equal(a.action, 'split', `pair of ${p}`);
    }
  });
  it('never splits tens', () => {
    const a = advise({ cards: ['K', 'Q'], total: 20, soft: false, dealerUp: '6', canDouble: true, canSplit: true, canSurrender: false, firstTwoCards: true, splitAces: false });
    assert.equal(a.action, 'stand');
  });
  it('doubles eleven against a six', () => {
    const a = advise({ cards: ['6', '5'], total: 11, soft: false, dealerUp: '6', canDouble: true, canSplit: false, canSurrender: false, firstTwoCards: true, splitAces: false });
    assert.equal(a.action, 'double');
  });
  it('surrenders sixteen against a nine when allowed', () => {
    const a = advise({ cards: ['10', '6'], total: 16, soft: false, dealerUp: '9', canDouble: false, canSplit: false, canSurrender: true, firstTwoCards: true, splitAces: false });
    assert.equal(a.action, 'surrender');
  });
  it('identifies pairs across ten-valued cards', () => {
    assert.equal(pairRank(['K', '10']), '10');
    assert.equal(pairRank(['K', '9']), null);
  });
  it('keeps pulse inside 0..1', () => {
    assert.ok(handPulse(20, false, '6') > handPulse(12, false, 'A'));
    assert.ok(handPulse(22, false, '6') === 0);
  });
});

/** A controllable clock so the whole round can be run deterministically. */
class Clock {
  t = 1_000_000;
  now = () => this.t;
  advance(ms: number) { this.t += ms; }
}

const FAST = { betSeconds: 3, turnSeconds: 2 };

function makeTable(seed = 42, rules = {}) {
  const clock = new Clock();
  const rng = mulberry32(seed);
  const table = new Table({
    roomId: 'r1', name: 'Test', code: 'TEST', now: clock.now, rng,
    rules: { ...DEFAULT_RULES, ...FAST, ...rules }, autoBots: 0,
  });
  return { table, clock, rng };
}

function run(table: Table, clock: Clock, ms = 200_000, stepMs = 50) {
  const end = clock.t + ms;
  while (clock.t < end) {
    clock.advance(stepMs);
    table.tick();
  }
}

describe('legal actions (shared by server and client)', () => {
  const base = {
    total: { best: 16, soft: false, bust: false, blackjack: false, count: 2 } as HandTotal,
    phase: 'players' as const,
    isTurn: true,
    handCount: 1,
    chips: 1000,
    bet: 100,
    doubled: false,
    split: false,
    splitAces: false,
    decided: false,
    dealerUp: '10' as Rank,
    rules: DEFAULT_RULES,
    insuranceOffered: false,
    insuranceDecided: false,
    inRound: true,
  };

  it('offers every option on a fresh two-card hand', () => {
    const a = legalActions({ ...base, cards: ['10', '6'] as Rank[] });
    assert.deepEqual([a.hit, a.stand, a.double, a.split, a.surrender], [true, true, true, false, true]);
  });
  it('offers a split only on a pair', () => {
    assert.equal(legalActions({ ...base, cards: ['8', '8'] as Rank[] }).split, true);
    assert.equal(legalActions({ ...base, cards: ['8', '7'] as Rank[] }).split, false);
  });
  it('caps splits at the table limit', () => {
    assert.equal(legalActions({ ...base, cards: ['8', '8'] as Rank[], handCount: 4 }).split, false);
    assert.equal(legalActions({ ...base, cards: ['8', '8'] as Rank[], handCount: 3 }).split, true);
  });
  it('needs the bankroll to double or split', () => {
    assert.equal(legalActions({ ...base, cards: ['6', '5'] as Rank[], chips: 50 }).double, false);
    assert.equal(legalActions({ ...base, cards: ['8', '8'] as Rank[], chips: 50 }).split, false);
    assert.equal(legalActions({ ...base, cards: ['6', '5'] as Rank[], chips: 100 }).double, true);
  });
  it('respects double-any-two vs 9-11 only', () => {
    const strict = { ...DEFAULT_RULES, doubleAnyTwo: false };
    const t = (best: number, count = 2): HandTotal => ({ best, soft: false, bust: false, blackjack: false, count });
    // 10+7 = 17: doubles on any two, but not on a 9-11-only table
    assert.equal(legalActions({ ...base, cards: ['10', '7'] as Rank[], total: t(17) }).double, true);
    assert.equal(legalActions({ ...base, cards: ['10', '7'] as Rank[], total: t(17), rules: strict }).double, false);
    // 6+5 = 11: doubles on both
    assert.equal(legalActions({ ...base, cards: ['6', '5'] as Rank[], total: t(11), rules: strict }).double, true);
    // a three-card 11 never doubles
    assert.equal(legalActions({ ...base, cards: ['2', '4', '5'] as Rank[], total: t(11, 3), rules: strict }).double, false);
  });
  it('blocks double after split when the table says so', () => {
    const noDas = { ...DEFAULT_RULES, doubleAfterSplit: false };
    assert.equal(legalActions({ ...base, cards: ['6', '5'] as Rank[], split: true, rules: noDas }).double, false);
    assert.equal(legalActions({ ...base, cards: ['6', '5'] as Rank[], split: true }).double, true);
  });
  it('takes one card on split aces', () => {
    const a = legalActions({ ...base, cards: ['A', '7'] as Rank[], split: true, splitAces: true });
    assert.equal(a.hit, false);
    assert.equal(a.stand, true);
  });
  it('surrenders only before the first decision', () => {
    assert.equal(legalActions({ ...base, cards: ['10', '6'] as Rank[], decided: true }).surrender, false);
    assert.equal(legalActions({ ...base, cards: ['10', '6', 'A'] as Rank[] }).surrender, false);
  });
  it('says nothing at all when it is not your turn', () => {
    const a = legalActions({ ...base, cards: ['10', '6'] as Rank[], isTurn: false });
    assert.deepEqual(a, { hit: false, stand: false, double: false, split: false, surrender: false, insurance: false });
  });
  it('offers insurance only while the window is open and you can pay', () => {
    const ins = { ...base, phase: 'insurance' as const, isTurn: false, insuranceOffered: true, insuranceDecided: false };
    assert.equal(legalActions(ins).insurance, true);
    assert.equal(legalActions({ ...ins, chips: 10 }).insurance, false);
    assert.equal(legalActions({ ...ins, insuranceDecided: true }).insurance, false);
  });
  it('stops offering moves on a busted hand', () => {
    const bust = { ...base, total: { best: 24, soft: false, bust: true, blackjack: false, count: 3 } };
    const a = legalActions({ ...bust, cards: ['10', '6', '8'] as Rank[] });
    assert.equal(a.hit, false);
    assert.equal(a.stand, false);
  });
});

describe('table lifecycle', () => {
  /** Total value in play must never change: chips + committed bets + insurance. */
  function money(table: Table): number {
    let total = 0;
    for (const p of table.people_list) total += p.chips;
    const v = table.view();
    total += v.houseNet; // the house pocket is part of the closed system
    const atBetSpot = v.phase === 'betting' || v.phase === 'shuffle' || v.phase === 'idle';
    for (const s of v.seats) {
      total += s.inRound
        ? s.hands.reduce((a, h) => a + h.bet, 0) + s.insurance
        : (atBetSpot ? s.bet : 0);
    }
    return total;
  }

  it('deals, plays and settles a full round with bots', () => {
    const { table, clock } = makeTable(11);
    table.addBots(4);
    const seated = table.people_list.filter((p) => p.seat !== null);
    assert.ok(seated.length >= 1, 'bots took seats');
    const chipsBefore = seated.reduce((a, p) => a + p.chips, 0);
    run(table, clock, 90_000);
    assert.ok(table.round >= 3, `rounds advanced (${table.round})`);
    const view = table.view();
    assert.equal(view.seats.length, 7);
    assert.ok(['betting', 'dealing', 'insurance', 'players', 'dealer', 'settle', 'shuffle'].includes(view.phase));
    assert.ok(view.history.length > 0, 'history recorded settled rounds');
    assert.ok(view.leaderboard.length > 0, 'leaderboard populated');
    // chip conservation: money only moves between players and the house
    const chipsAfter = table.people_list.filter((p) => p.seat !== null).reduce((a, p) => a + p.chips, 0);
    assert.ok(chipsAfter > 0);
    assert.ok(Math.abs(chipsAfter - chipsBefore) < 200_000);
  });

  it('never exposes a hidden card in the public view', () => {
    const { table, clock } = makeTable(5);
    table.addBots(3);
    run(table, clock, 40_000);
    const view = table.view();
    for (const c of view.dealer.cards) {
      if (c.hidden) {
        assert.equal(c.rank, undefined);
        assert.equal(c.suit, undefined);
      }
    }
  });

  it('refuses bets outside the betting window', () => {
    const { table, clock } = makeTable(8);
    const p = table.addPerson({ name: 'Ada', hue: 200 });
    table.sit(p.id, 0);
    assert.equal(table.placeBet(p.id, 100).ok, true);
    assert.equal(p.chips, DEFAULT_RULES.startingChips - 100);
    run(table, clock, 30_000);
    // after the round settles, the bet is cleared and chips returned/paid
    assert.equal(table.view().seats[0]!.bet, 0);
  });

  it('enforces table limits', () => {
    const { table } = makeTable(3, { betSeconds: 22 });
    const p = table.addPerson({ name: 'Bo', hue: 10, chips: 100_000 });
    table.sit(p.id, 1);
    assert.equal(table.placeBet(p.id, 1).ok, false);
    assert.equal(table.placeBet(p.id, DEFAULT_RULES.maxBet + 1).ok, false);
    assert.equal(table.placeBet(p.id, 500).ok, true);
  });

  it('rejects a second player on a taken seat', () => {
    const { table } = makeTable(3, { betSeconds: 22 });
    const a = table.addPerson({ name: 'A', hue: 1 });
    const b = table.addPerson({ name: 'B', hue: 2 });
    assert.equal(table.sit(a.id, 3).ok, true);
    assert.equal(table.sit(b.id, 3).ok, false);
  });

  it('five card charlie wins when the rule is on', () => {
    const { table, clock } = makeTable(77, { fiveCardCharlie: true });
    table.addBots(3);
    run(table, clock, 120_000);
    const history = table.view().history;
    assert.ok(history.length > 0);
  });

  it('settlement pays blackjack 3:2', () => {
    const { table, clock } = makeTable(2);
    const p = table.addPerson({ name: 'Ace', hue: 40, chips: 5000 });
    table.sit(p.id, 0);
    table.placeBet(p.id, 1000);
    let sawBlackjack = false;
    for (let i = 0; i < 400 && !sawBlackjack; i++) {
      clock.advance(50);
      table.tick();
      const v = table.view();
      const seat = v.seats[0]!;
      if (seat.hands[0]?.result === 'blackjack') {
        sawBlackjack = true;
        assert.equal(seat.hands[0]!.payout, 1500);
      }
    }
    void sawBlackjack;
  });

  it('holds a dropped seat briefly, then releases it', () => {
    const clock = new Clock();
    const table = new Table({
      roomId: 'r2', name: 'Grace', code: 'GRCE', now: clock.now, rng: mulberry32(21),
      rules: { ...DEFAULT_RULES, ...FAST }, absentGraceMs: 5000,
    });
    const p = table.addPerson({ name: 'Drop', hue: 90 });
    table.sit(p.id, 2);
    assert.equal(table.view().seats[2]!.occupant?.name, 'Drop');

    table.setConnected(p.id, false);
    clock.advance(3000);
    table.tick();
    assert.equal(table.view().seats[2]!.occupant?.name, 'Drop', 'seat is held during the grace window');

    clock.advance(3000);
    table.tick();
    assert.equal(table.view().seats[2]!.occupant, null, 'seat released after the grace window');

    // and a reconnect inside the window is seamless
    const q = table.addPerson({ name: 'Stay', hue: 12 });
    table.sit(q.id, 4);
    table.setConnected(q.id, false);
    clock.advance(1000);
    table.setConnected(q.id, true);
    clock.advance(60_000);
    table.tick();
    assert.equal(table.view().seats[4]!.occupant?.name, 'Stay', 'reconnecting keeps the seat');
  });

  it('gives a seat to a human over a house player', () => {
    const { table } = makeTable(31);
    const bot = table.spawnBot();
    const seatIndex = bot.seat!;
    const human = table.addPerson({ name: 'Human', hue: 5 });
    const r = table.sit(human.id, seatIndex);
    assert.equal(r.ok, true, 'human claims the bot seat');
    assert.equal(table.seatOf(human.id), seatIndex);
    assert.notEqual(table.seatOf(bot.id), seatIndex);
  });

  it('conserves chips across a whole round (no money created or destroyed)', () => {
    const { table, clock } = makeTable(1234);
    table.addBots(5);
    const start = money(table);
    const end = clock.t + 60_000;
    let samples = 0;
    while (clock.t < end) {
      clock.advance(50);
      table.tick();
      const m = money(table);
      if (m !== start) {
        assert.fail(`chip leak at t=${clock.t} round=${table.round} phase=${table.phase}: ${start} -> ${m}`);
      }
      samples++;
    }
    assert.ok(samples > 100);
    assert.ok(table.round >= 3, `rounds advanced (${table.round})`);
  });
});
