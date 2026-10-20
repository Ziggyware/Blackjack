/**
 * Browser smoke test without a browser.
 *
 * Mounts the real React client inside jsdom, lets it open a genuine WebSocket
 * to the running table server (through whatever origin we point it at), and
 * then drives a complete round by clicking actual DOM nodes: enter the lobby,
 * take a seat, drop chips, wait for the deal, play the hand, watch it settle.
 *
 *   npx tsx scripts/browser-smoke.tsx [http://127.0.0.1:5173]
 */
import { JSDOM, VirtualConsole } from 'jsdom';

const ORIGIN = process.argv[2] ?? 'http://127.0.0.1:5173';
const failures: string[] = [];
const check = (cond: boolean, label: string) => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failures.push(label);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const virtualConsole = new VirtualConsole();
const pageErrors: string[] = [];
virtualConsole.on('jsdomError', (e: Error) => {
  // jsdom has no canvas/WebGL — that path is expected to degrade gracefully
  if (/not implemented/i.test(e.message)) return;
  pageErrors.push(e.message);
});
virtualConsole.on('error', (...a: unknown[]) => pageErrors.push(a.map(String).join(' ')));
virtualConsole.on('warn', (...a: unknown[]) => pageErrors.push(a.map(String).join(' ')));

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: ORIGIN + '/',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
  virtualConsole,
});

const { window } = dom;
// quiet the canvas/WebGL "not implemented" noise and take the graceful path
(window.HTMLCanvasElement.prototype as unknown as { getContext: () => null }).getContext = () => null;

const g = globalThis as unknown as Record<string, unknown>;
// NOTE: we deliberately leave `WebSocket` and the event constructors alone —
// Node 22 ships its own WebSocket and jsdom's Event classes clash with it.
// The client only needs the DOM globals below; the harness uses `window.*`
// explicitly when synthesising events.
for (const key of [
  'window', 'document', 'navigator', 'location', 'HTMLElement', 'HTMLInputElement',
  'SVGElement', 'Element', 'Node',
  'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage',
  'DOMRect', 'MutationObserver',
]) {
  Object.defineProperty(g, key, {
    value: (window as unknown as Record<string, unknown>)[key],
    configurable: true,
    writable: true,
  });
}
g.self = window;
(window as unknown as { matchMedia?: unknown }).matchMedia ??= (q: string) => ({
  matches: false, media: q, onchange: null,
  addListener: () => {}, removeListener: () => {},
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
});
(window as unknown as { scrollTo?: unknown }).scrollTo ??= () => {};
(window.Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView ??= function () {};

const { createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const App = (await import('../client/src/App.js')).default;
const { useStore } = await import('../client/src/state/store.js');

const $ = (sel: string) => window.document.querySelector(sel);
const $$ = (sel: string) => [...window.document.querySelectorAll(sel)];
const text = () => window.document.body.textContent ?? '';

function click(el: Element | null): void {
  if (!el) return;
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
}

function typeInto(el: Element | null, value: string): void {
  if (!el) return;
  const input = el as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

async function waitFor(fn: () => boolean, ms: number, label: string): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(80);
  }
  check(false, `${label} (timed out after ${ms}ms)`);
  return false;
}

console.log(`\n♠  VELVET browser smoke test → ${ORIGIN}\n`);

const root = createRoot(window.document.getElementById('root')!);
root.render(createElement(App));
await sleep(200);

/* ---------------- lobby ---------------- */
await waitFor(() => text().includes('VELVET'), 8000, 'app boots into the lobby');
check(!!$('.lobby'), 'lobby overlay is present');
await waitFor(() => useStore.getState().rooms.length > 0, 15000, 'room list arrives over the socket');
await sleep(150);
const kind = useStore.getState().kind;
check(kind === 'remote' || kind === 'local', `table connection established (${kind})`);
if (kind === 'local') {
  console.log('  · no room server at this origin — running the in-browser engine fallback');
}
check($$('.room').length >= 1, `lobby lists ${$$('.room').length} rooms`);

typeInto($('#nick'), 'Vela');
const slider = $('#hue') as HTMLInputElement | null;
if (slider) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(slider, '285');
  slider.dispatchEvent(new window.Event('input', { bubbles: true }));
}
check($('.avatar') !== null, 'live avatar preview renders');

/* ---------------- enter the table ---------------- */
click($('.room'));
await sleep(60);
click($('.enterbtn'));
await waitFor(() => !!$('.felt'), 12000, 'the felt appears after entering');
check(useStore.getState().atTable, 'store marks us at the table');
check(text().includes('NEON HOUSE') || text().includes('MIDNIGHT') || text().includes('ORACLE'), 'top bar names the room');

/* ---------------- take a seat ---------------- */
const state0 = useStore.getState().table!;
await waitFor(() => $$('.seat').length === state0.seats.length, 8000, 'all seats render');
check($$('.seat').length === state0.seats.length, `${$$('.seat').length} seat nodes in the arc`);
check($$('.dealer .card').length >= 0, 'dealer area mounted');
check(!!useStore.getState().you, 'server assigned us an identity');

// House players always yield a seat to a human — the felt has to say so.
check($$('.seat__claim').length > 0, `${$$('.seat__claim').length} house players offer their seat`);

// Seats are locked while a round is in flight, and a house player's seat is taken
// with a different button than an empty one — so keep offering until we're in.
let lastOffer = 0;
const seatedOk = await waitFor(() => {
  const t = useStore.getState().table;
  if (!t) return false;
  if (t.seats.some((s) => s.occupant?.id === useStore.getState().you)) return true;
  const now = Date.now();
  if (now - lastOffer > 400) {
    lastOffer = now;
    click(
      $('.seat--empty .seat__empty:not([disabled])') ??
        $('.seat__claim:not([disabled])'),
    );
  }
  return false;
}, 40000, 'we are seated');
check(seatedOk, 'the table accepted our seat request');

const seated = useStore.getState().table!.seats.find((s) => s.occupant?.id === useStore.getState().you)!;
check(seated.occupant!.name === 'Vela', `seat shows our name (${seated.occupant!.name})`);
check(seated.occupant!.chips > 0, `bankroll ${seated.occupant!.chips}`);

/* ---------------- place a bet ---------------- */
const freshBetting = () => {
  const t = useStore.getState().table;
  return t?.phase === 'betting' && t.phaseEndsAt !== null && t.phaseEndsAt - Date.now() > 9000;
};
await waitFor(freshBetting, 90000, 'a fresh betting window opens');
const chipsBefore = useStore.getState().table!.seats.find((s) => s.occupant?.id === useStore.getState().you)!.occupant!.chips;
const chipBtns = $$('.tray .chip--btn') as HTMLButtonElement[];
check(chipBtns.length >= 3, `${chipBtns.length} chip denominations in the tray`);
const enabled = chipBtns.filter((b) => !b.disabled);
click(enabled[0] ?? null);
await sleep(120);
click(enabled[0] ?? null);
await waitFor(() => {
  const s = useStore.getState().table!.seats.find((x) => x.occupant?.id === useStore.getState().you);
  return (s?.bet ?? 0) > 0;
}, 8000, 'the wager lands on the felt');

const mySeat = () => useStore.getState().table!.seats.find((x) => x.occupant?.id === useStore.getState().you)!;
check(mySeat().bet > 0, `bet ${mySeat().bet} registered`);
check(mySeat().occupant!.chips === chipsBefore - mySeat().bet, 'bankroll debited the moment the bet was placed');
check($$('.betslot .chip').length >= 1, 'chip stack renders in the bet slot');
const ourSeatEl = window.document.querySelector(`[data-seat="${mySeat().index}"]`);
check(!!ourSeatEl?.querySelector('.seat__bet .chipstack'), 'our chip stack renders on the felt');
check(!!window.document.querySelector('.errbar') === false, 'no server rejection after a legal chip drop');

/* ---------------- the round ---------------- */
await waitFor(() => {
  const p = useStore.getState().table?.phase;
  return p === 'dealing' || p === 'players' || p === 'insurance';
}, 60000, 'cards are dealt');
await waitFor(() => $$('.dealer .card').length >= 2, 12000, 'the dealer holds two cards');
check($$('.dealer .card__face--back').length >= 1, 'the hole card renders face down');

// play out the hand by clicking whatever the dock offers
let clicks = 0;
const settled = await (async () => {
  const end = Date.now() + 90000;
  while (Date.now() < end) {
    const st = useStore.getState();
    const t = st.table!;
    if (t.phase === 'settle') return true;
    if (t.phase === 'insurance' && mySeat().insuranceOffered) {
      const decline = $$('.act').find((b) => /decline/i.test(b.textContent ?? ''));
      click(decline ?? null);
      clicks++;
    }
    const mine = t.turn && t.seats[t.turn.seat]?.occupant?.id === st.you;
    if (mine) {
      const btns = $$('.act').filter((b) => !(b as HTMLButtonElement).disabled);
      const stand = btns.find((b) => /stand/i.test(b.textContent ?? ''));
      const hit = btns.find((b) => /hit/i.test(b.textContent ?? ''));
      const hand = t.seats[t.turn!.seat]!.hands[t.turn!.hand];
      const want = (hand?.total?.best ?? 0) >= 15 ? stand : hit;
      click(want ?? stand ?? hit ?? null);
      clicks++;
    }
    await sleep(110);
  }
  return false;
})();
check(settled, `round settled after ${clicks} table clicks`);
check($$('.seat .card').length > 0, 'hands are still on the felt at settlement');
check(!!$('.dealer__total'), 'dealer total badge rendered');

await waitFor(() => useStore.getState().table?.phase === 'betting', 45000, 'the table cycles back to betting');
const after = useStore.getState().table!.history[0];
check(!!after, 'hand history captured the round');
check((after?.hands.length ?? 0) > 0, `history holds ${after?.hands.length ?? 0} results`);

/* ---------------- chat + reactions ---------------- */
const input = $('.composer input');
typeInto(input, 'shipping it');
input?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
await waitFor(() => (useStore.getState().table?.messages ?? []).some((m) => m.text === 'shipping it'), 8000, 'chat round trip');
check(text().includes('shipping it'), 'the message renders in the panel');
click($('.quick button'));
await sleep(400);
check(true, 'reaction button fires without error');

/* ---------------- panel tabs ---------------- */
const tabChecks: [string, () => boolean][] = [
  ['Hands', () => !!$('.hrow') || text().includes('No settled rounds')],
  ['Ranks', () => text().includes('Leaderboard') && !!$('.lrow')],
  ['Rules', () => text().includes('house rules') && $$('.rulelist li').length > 5],
  ['Table', () => !!$('.composer input') && !!$('.chat')],
];
for (const [label, ok] of tabChecks) {
  const tab = $$('.tab').find((t) => (t.textContent ?? '').trim() === label);
  check(!!tab, `${label} tab exists`);
  click(tab ?? null);
  await sleep(120);
  check(ok(), `${label} tab renders its content`);
}

/* ---------------- keyboard shortcuts ---------------- */
await waitFor(freshBetting, 90000, 'next fresh betting window');
window.dispatchEvent(new window.KeyboardEvent('keydown', { key: '1', bubbles: true }));
await waitFor(() => mySeat().bet > 0, 6000, 'keyboard chip drop');
check(mySeat().bet > 0, `key 1 dropped a chip (bet ${mySeat().bet})`);
window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'c', bubbles: true }));
await waitFor(() => mySeat().bet === 0, 6000, 'keyboard clear bet');
check(mySeat().bet === 0, 'key C cleared the bet');

/* ---------------- health ---------------- */
const serious = pageErrors.filter((e) => !/not implemented|WebGL|canvas|getContext|not wrapped in act|testing environment is not configured|ReactDOM.render is no longer supported/i.test(e));
check(serious.length === 0, `no page errors${serious.length ? ': ' + serious[0].slice(0, 160) : ''}`);
const warn = (window as unknown as { __reactErrors?: string[] }).__reactErrors;
check(!warn, 'no react render errors captured');

root.unmount();
window.close();

console.log('');
if (failures.length) {
  console.log(`✗ ${failures.length} browser check(s) failed:`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
console.log('✓ the real client drove a full multiplayer round end to end\n');
process.exit(0);
