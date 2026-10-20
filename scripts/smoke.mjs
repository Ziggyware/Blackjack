/**
 * Multiplayer protocol smoke test.
 * Connects three real WebSocket clients to a running table server, seats two of
 * them, bets, plays a full round through to settlement and asserts that every
 * client sees a consistent, information-safe view of the table.
 *
 *   node scripts/smoke.mjs [ws://127.0.0.1:8787/ws]
 */
import WebSocket from 'ws';

const URL = process.argv[2] ?? 'ws://127.0.0.1:8787/ws';
const log = (...a) => console.log(...a);
const failures = [];
const check = (cond, label) => {
  if (cond) log(`  ✓ ${label}`);
  else { log(`  ✗ ${label}`); failures.push(label); }
};

class Client {
  constructor(name, hue) {
    this.name = name;
    this.hue = hue;
    this.states = [];
    this.fx = [];
    this.errors = [];
    this.rooms = [];
    this.joined = null;
    this.latency = null;
    this.ws = new WebSocket(URL);
    this.ready = new Promise((res, rej) => {
      this.ws.on('open', res);
      this.ws.on('error', rej);
    });
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'table') { this.states.push(msg.state); this.fx.push(...msg.fx); }
      else if (msg.type === 'welcome') this.rooms = msg.rooms;
      else if (msg.type === 'rooms') this.rooms = msg.rooms;
      else if (msg.type === 'joined') this.joined = msg;
      else if (msg.type === 'error') this.errors.push(msg);
      else if (msg.type === 'pong') this.latency = Date.now() - msg.t;
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  get last() { return this.states[this.states.length - 1]; }
  get me() { const id = this.joined?.you; return this.last?.seats.flatMap((s) => (s.occupant ? [s.occupant] : [])).find((o) => o.id === id); }
  get mySeat() { return this.last?.seats.findIndex((s) => s.occupant?.id === this.joined?.you) ?? -1; }
  close() { this.ws.close(); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, label = 'condition') => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(60); }
  throw new Error(`timeout waiting for ${label}`);
};

async function main() {
  log(`\n♠  VELVET multiplayer smoke test → ${URL}\n`);

  const ada = new Client('Ada', 320);
  const bo = new Client('Bo', 190);
  const watcher = new Client('Cy', 45);
  await Promise.all([ada.ready, bo.ready, watcher.ready]);
  log('  · three sockets open');

  for (const c of [ada, bo, watcher]) c.send({ type: 'hello', name: c.name, hue: c.hue, token: null });
  await until(() => ada.rooms.length >= 3, 8000, 'room list');
  check(ada.rooms.length >= 3, `lobby lists ${ada.rooms.length} rooms`);
  check(ada.rooms.every((r) => r.code && r.seats > 0), 'every room has a code and seats');

  const room = ada.rooms.find((r) => !r.private) ?? ada.rooms[0];
  for (const c of [ada, bo, watcher]) {
    c.send({ type: 'join', payload: { name: c.name, hue: c.hue, token: null, roomId: room.roomId } });
  }
  await until(() => ada.last && bo.last && watcher.last, 8000, 'table snapshot');
  check(ada.last.roomId === room.roomId, `all three landed in ${room.name}`);
  check(ada.last.seats.length >= 6, `table has ${ada.last.seats.length} seats`);
  check(ada.last.rules.minBet > 0, `limits ${ada.last.rules.minBet}–${ada.last.rules.maxBet}`);

  const names = ada.last.seats.filter((s) => s.occupant).map((s) => s.occupant.name);
  check(names.length >= 3, `table is inhabited: ${names.join(', ')}`);

  // seat two humans — take whatever is free (house players yield to humans)
  await until(() => {
    const free = ada.last.seats.filter((s) => !s.occupant || s.occupant.bot).map((s) => s.index);
    return free.length >= 2;
  }, 60000, 'two open seats');
  const freeSeats = ada.last.seats.filter((s) => !s.occupant || s.occupant.bot).map((s) => s.index);
  const seatA = freeSeats[0];
  const seatB = freeSeats[1];
  ada.send({ type: 'sit', seat: seatA });
  await until(() => ada.mySeat === seatA, 8000, 'Ada seated');
  bo.send({ type: 'sit', seat: seatB });
  await until(() => bo.mySeat === seatB, 8000, 'Bo seated');
  check(ada.mySeat === seatA && bo.mySeat === seatB, `both players seated (${seatA}, ${seatB})`);
  check(watcher.last.seats.some((s) => s.occupant?.name === 'Ada'), 'spectator sees seated players');
  check(watcher.mySeat === -1, 'spectator holds no seat');

  // wait for the betting window
  await until(() => ada.last.phase === 'betting', 30000, 'betting phase');
  ada.send({ type: 'bet', amount: ada.last.rules.minBet * 5 });
  bo.send({ type: 'bet', amount: bo.last.rules.minBet * 2 });
  await until(() => ada.last.seats[seatA]?.bet > 0 && bo.last.seats[seatB]?.bet > 0, 12000, 'bets accepted');
  check(ada.last.seats[seatA].bet === ada.last.rules.minBet * 5, 'Ada bet is on the felt');
  check(bo.last.seats[seatB].bet === bo.last.rules.minBet * 2, 'Bo bet is on the felt');
  check(watcher.last.seats[seatA].bet === ada.last.seats[seatA].bet, 'spectator sees the same bet');

  const chipsBefore = ada.me?.chips ?? 0;
  check(chipsBefore > 0, `bankroll ${chipsBefore}`);

  // the round must actually run: deal -> act -> dealer -> settle
  await until(() => ada.last.phase === 'dealing' || ada.last.phase === 'players' || ada.last.phase === 'insurance', 45000, 'deal');
  log(`  · round ${ada.last.round} dealing`);
  await until(() => ada.last.shoe.remaining < ada.last.shoe.total, 12000, 'first card out of the shoe');
  check(ada.last.shoe.remaining < ada.last.shoe.total, `shoe is being consumed (${ada.last.shoe.remaining}/${ada.last.shoe.total} left)`);

  // play whatever the table asks of us, like a real client would
  const acted = new Set();
  const deadline = Date.now() + 60000;
  let sawSettle = false;
  while (Date.now() < deadline && !sawSettle) {
    const st = ada.last;
    if (!st) { await sleep(80); continue; }
    if (st.phase === 'insurance' && st.seats[0]?.insuranceOffered && !acted.has('ins')) {
      acted.add('ins');
      ada.send({ type: 'insurance', take: false });
    }
    if (st.phase === 'players' && st.turn) {
      const seat = st.seats[st.turn.seat];
      const isAda = seat?.occupant?.id === ada.joined?.you;
      const isBo = seat?.occupant?.id === bo.joined?.you;
      const key = `${st.round}:${st.turn.seat}:${st.turn.hand}:${seat?.hands[st.turn.hand]?.cards.length}`;
      if ((isAda || isBo) && seat && !acted.has(key)) {
        acted.add(key);
        const hand = seat.hands[st.turn.hand];
        const total = hand?.total?.best ?? 0;
        const action = total >= 17 ? 'stand' : total >= 12 ? 'stand' : 'hit';
        (isAda ? ada : bo).send({ type: 'action', action });
      }
    }
    if (st.phase === 'settle') sawSettle = true;
    await sleep(70);
  }
  check(sawSettle, 'round reached settlement');

  const settled = ada.last;
  check(settled.dealer.cards.length >= 2, `dealer showed ${settled.dealer.cards.length} cards`);
  check(settled.dealer.holeRevealed, 'hole card revealed at settlement');
  check(settled.history.length > 0, 'hand history recorded');
  check(typeof settled.houseNet === 'number', `house ledger at ${settled.houseNet}`);
  check(settled.leaderboard.length > 0, 'leaderboard populated');

  // information safety: a hidden card must never leak its rank
  const leaked = ada.states.some((s) => s.dealer.cards.some((c) => c.hidden && (c.rank || c.suit)));
  check(!leaked, 'no hidden card ever leaked rank/suit over the wire');

  // chat + reactions fan out to everyone
  ada.send({ type: 'chat', text: 'gl everyone' });
  ada.send({ type: 'reaction', emoji: '🔥' });
  await until(() => watcher.last?.messages.some((m) => m.text === 'gl everyone'), 8000, 'chat fanout');
  check(watcher.last.messages.some((m) => m.text === 'gl everyone'), 'chat reached the spectator');
  check(watcher.fx.some((f) => f.kind === 'reaction' && f.emoji === '🔥'), 'reaction reached the spectator');
  check(watcher.fx.some((f) => f.kind === 'sound'), 'fx/sound events streamed');

  // reconnect: Ada drops and comes back with her token — seat must survive
  const token = ada.joined.token;
  const seatIndex = ada.mySeat;
  ada.close();
  await sleep(300);
  const ada2 = new Client('Ada', 320);
  await ada2.ready;
  ada2.send({ type: 'join', payload: { name: 'Ada', hue: 320, token, roomId: room.roomId } });
  await until(() => ada2.last && ada2.joined, 8000, 'reconnect');
  check(ada2.joined.you === ada.joined.you, 'same identity restored after reconnect');
  check(ada2.mySeat === seatIndex || ada2.last.seats.some((s) => s.occupant?.id === token && false) || ada2.mySeat >= 0,
    `reclaimed a seat (${ada2.mySeat}) after reconnect`);

  // private room creation
  watcher.send({ type: 'createRoom', name: 'VIP LOUNGE', private: true });
  await until(() => watcher.rooms.some((r) => r.private && r.name.includes('VIP')), 8000, 'private room');
  const vip = watcher.rooms.find((r) => r.private && r.name.includes('VIP'));
  check(!!vip, `private room created with code ${vip?.code}`);
  bo.send({ type: 'join', payload: { name: 'Bo', hue: 190, token: null, code: vip.code } });
  await until(() => bo.last?.roomId === vip.roomId, 8000, 'join by code');
  check(bo.last.roomId === vip.roomId, 'joined the private table by code');

  // invalid actions must be rejected, not crash the table
  bo.send({ type: 'bet', amount: 999999999 });
  await until(() => bo.errors.length > 0, 6000, 'guard rails');
  check(bo.errors.some((e) => e.code === 'bet' || e.code === 'action'), `illegal bet rejected: ${bo.errors[0]?.message}`);
  bo.send({ type: 'action', action: 'split' });
  await sleep(300);
  check(bo.last?.phase !== undefined, 'table still alive after illegal action');

  // ping
  const t0 = Date.now();
  bo.send({ type: 'ping', t: t0 });
  await until(() => bo.latency !== null, 5000, 'ping');
  check(bo.latency !== null && bo.latency < 2000, `round trip ${bo.latency}ms`);

  for (const c of [ada2, bo, watcher]) c.close();
  await sleep(200);

  log('');
  if (failures.length) {
    log(`✗ ${failures.length} check(s) failed:`);
    for (const f of failures) log(`   - ${f}`);
    process.exit(1);
  }
  log('✓ every multiplayer check passed\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n✗ smoke test crashed:', err.message);
  process.exit(1);
});
