# VELVET

**A multiplayer blackjack floor that behaves like a real casino — and looks like nothing else.**

Seven seats around a live table. An authoritative dealer engine. House players with
distinct personalities who fold their chips and walk away the second a human wants the
seat. Chat, reactions, a running leaderboard, hand history, real basic-strategy advice.
A shader that breathes behind the felt, a mood-reactive rim that turns cold blue on a
loss and gold on a blackjack, and cards that physically fly out of the shoe.

Play money only — there is no currency here, and no way to lose one.

---

## Run it

```bash
npm install
npm run dev          # table server on :8787  +  client on :5173
```

Open **http://localhost:5173**. That's the whole setup — two processes, no database,
no environment file.

| Command | What it does |
| --- | --- |
| `npm run dev` | Both servers, hot-reloading. The client proxies `/ws` to the table server. |
| `npm run dev:server` | Table server alone (`:8787`, override with `PORT`). |
| `npm run dev:client` | Vite alone (`:5173`). |
| `npm run build` | Production client bundle → `client/dist`. |
| `npm start` | Builds nothing, serves `client/dist` **and** the socket from one port (`:8787`). |
| `npm run verify` | Boots a server and runs all five test layers. See **Testing**. |
| `npm run typecheck` | Strict TypeScript across all three workspaces. |

If the client can't reach a table server, it does not show you an error page. It races
the socket for 4.5 seconds, then quietly boots the **same engine in your browser** and
plays locally against house opponents. Same game, one process, zero configuration.

---

## The floor

Three permanent rooms, each with its own rules and its own colour that the entire UI —
shader, felt, chips, seat rings — inherits through a single `--accent-h` token.

| Room | Limits | Bankroll | House rules |
| --- | --- | --- | --- |
| **NEON HOUSE** <sub>magenta</sub> | 10 – 2,500 | 2,500 | Six decks · blackjack 3:2 · dealer stands soft 17 · 7 seats |
| **MIDNIGHT VELVET** <sub>cyan</sub> | 25 – 5,000 | 5,000 | **Five-card Charlie wins** · dealer **hits** soft 17 · faster clock |
| **THE ORACLE** <sub>gold</sub> | 100 – 25,000 | 50,000 | Late surrender · 30-second turns · 6 seats |

Or create a **private room** with a four-character code (an alphabet with no `I`, `O`,
`0` or `1`, so it can be read aloud over a phone call). Share the code; anyone can join.
Empty rooms are reaped after fifteen minutes.

House players are always seated so the table never looks dead — but the moment you ask
for a seat, one of them packs up, says so in chat, and moves. If you disconnect, your
seat and your chips are held for 45 seconds (longer mid-hand, so you never get folded
out of a live round).

---

## What's on screen

```
┌──────────────────────────────────────────────────────────────┬────────────┐
│ ♠ VELVET   NEON HOUSE  [7XK2]⧉         Round 12   House −4.3k│  HANDS     │
│            6 decks · 3:2 · stands S17  Shoe 187   Seats 5/7   │  RANKS     │
│                                          ● LIVE  🔊  coach     │  RULES     │
├──────────────────────────────────────────────────────────────┤  TABLE     │
│                                                               │            │
│                         dealer · soft 17                      │  history,  │
│                         [ A? ][ K ]                           │  leaders,  │
│                                                               │  house     │
│                     ══ status hud: YOUR TURN ══                │  edge,     │
│                                                               │  chat,     │
│      ╭───────╮         ╭───────╮         ╭───────╮             │  reactions │
│      │ MILO  │         │  YOU  │         │ JUNE  │  ← 7 pods   │            │
│      │ 1,840 │         │ 2,500 │         │ 3,125 │    on an    │            │
│      │ [K][7]│         │[A?][9]│         │[10][6]│    arc      │            │
│      │  (25) │         │ (250) │         │  (100)│             │            │
│      ╰───────╯         ╰───────╯         ╰───────╯             │            │
├──────────────────────────────────────────────────────────────┤            │
│ (25)(100)(500)(1k)  bet 250   Min  Clear  ½                   │            │
│ [ HIT ][ STAND ][ DOUBLE ][ SPLIT ][ SURRENDER ]               │            │
│ coach ▸ SURRENDER · 16 against a dealer 10 loses more than     │            │
│         half the time — fold for half.                         │            │
│ Auto-rebet off · Coach on                                      │            │
└──────────────────────────────────────────────────────────────┴────────────┘
      ↑ shader field, drifting dust, grain and vignette behind all of it
```
```

The felt is a responsive composition, not a fixed image: seats sit on a computed
178°→2° arc, the aspect ratio steps `1.66 → 1.42 → 0.92` as the window narrows, and
cards deal toward an anchor rect measured from the live shoe, so the flight path is
correct at any viewport. Nothing is a bitmap — the grain, the noise and the felt
weave are inline SVG turbulence data URIs.

---

## Architecture

Three npm workspaces. The interesting decision is that **the engine is isomorphic**.

```
shared/   @velvet/shared   the game itself — no DOM, no Node, no timers
  ├── cards.ts     shoe, shuffling, hand totals, chip breakdown, redaction
  ├── actions.ts   legalActions() — the ONE source of truth for what's allowed
  ├── strategy.ts  basic-strategy charts, advice, hand pulse
  ├── bots.ts      ten house personalities
  ├── table.ts     Table: the entire round lifecycle (~1,450 lines)
  └── host.ts      TableHost: tick, coalesce, fan out snapshots
server/   one TableHost per room, one WebSocket per human, static file server
client/   React 18 · Zustand · Framer Motion · Vite
```

**`Table` never calls `setTimeout` and never reads the clock directly.** Everything it
does is a deadline (`phaseEndsAt`, `timerEndsAt`, `botActAt`, `botBetAt`,
`disconnectedAt`) or a queued step in a `script: { at, run() }[]` array that `tick()`
drains. `now()` and `rng()` are injected. That single constraint is why the same engine
can run on a Node server, in a browser tab with no server, and inside a unit test that
runs a full shoe in microseconds:

```ts
const t = new Table({ seatCount: 7, rules: FAST, now: () => clock, rng: mulberry32(1) });
t.addBot(0);
while (clock < limit) { t.tick(clock); clock += 20; }   // a whole session, synchronously
```

### The wire protocol

The server owns the truth; the client owns the presentation.

- **Snapshots.** `TableHost` ticks every 50 ms and broadcasts `{ type: 'table', state, fx }`,
  coalescing to at most one message every 25 ms regardless of how many things changed.
  `state` is a `TableView` — a redacted projection. Hidden cards arrive as
  `{ hidden: true }` with the rank stripped, so the client *cannot* cheat even if you
  open devtools; the reveal is a `hidden: true → false` transition that drives the CSS flip.
- **Effects.** One-shot events (a chip flying to the winner, a card landing, a payout
  ripple) ride along in `fx` and are consumed once, so animations never desync from state.
- **Clock.** The client pings on connect and keeps a rolling offset, so
  `serverNow() = Date.now() + clockOffset` and every countdown ring is driven by the
  server's clock, not the browser's.
- **Deals are derived, not pushed.** A card is animated when its `at` timestamp is fresh
  (<4.5 s) and the client hasn't `claimCard(id)`'d it yet — so a mid-round joiner sees a
  settled table instead of a replay of five animations.

### Shared legality

The same `legalActions(ActionContext)` function decides what the server will accept
*and* what the client will render as an enabled button. `trayDenominations(rules)` does
the same for chips: the tray only offers denominations that clear the table minimum, so
a button you can click is always a move the house will take. No optimistic UI, no
"your action was rejected" flicker.

---

## The rules engine

`DEFAULT_RULES`, overridable per room:

| | | | |
| --- | --- | --- | --- |
| 6 decks | blackjack pays 3:2 | insurance pays 2:1 | dealer stands soft 17 |
| double any two | double after split | up to 3 splits (4 hands) | split aces get one card |
| late surrender | five-card Charlie off | 25% penetration | min 10 / max 2,500 |

Round flow: `betting → dealing → (insurance → peek) → players → dealer → settle →
shuffle?`, with naturals resolved before anyone acts, a 10-upcard peeked immediately,
an ace upcard opening a 9-second insurance window, hands auto-standing when nothing
legal remains, and payouts staggered 260 ms apart so you can see who won what.

Chip accounting is asserted by test on every round: bets are reserved when placed,
deducted again on double or split, and settlement credits
`Σ hand.bet + seatNet + insurance`. Win +1×, blackjack +1.5×, push 0, surrender −0.5×.
House players auto-rebuy below four times the minimum, and the room tracks
`houseNet` — the house edge, computed, not assumed.

---

## Playing

**Mouse.** Click a seat to sit. Drop chips on the felt or click the tray. Click cards to
act. Every button has a specular highlight that follows your pointer. The table code in
the top bar is a copy button; `½` halves a wager, `Min` tops it up to the table minimum.

**Coach.** Toggle it in the top bar or the dock. When it's on, the correct basic-strategy
button glows and a line under the dock explains the call, in the engine's own words:

> `Always split a pair of 8s.`
> `16 against a dealer 10 loses more than half the time — fold for half.`
> `11 vs 5 — press the edge.`
> `20 vs a stiff hand — let the dealer break it.`

It reads the same six-deck chart the house players read (S17, DAS, late surrender), so
the coach never suggests a move the engine would reject.

**Keyboard.**

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| `H` | Hit | `1`–`6` | Drop that chip |
| `S` | Stand | `C` | Clear bet |
| `D` | Double | `B` | Rebet your last wager |
| `P` | Split | `Y` / `N` | Take / decline insurance |
| `R` | Surrender | `Tab` | Toggle the side panel |
| | | `M` | Mute |

**Sound.** Seventeen synthesised cues — no audio files, no licensing, all WebAudio:
chip clicks, card slides, the shuffle, the blackjack sting, the bust. Muted until your
first interaction, because that's what browsers require.

---

## Testing

Five layers, from pure logic to a real browser:

```bash
npm test            # 37 engine unit tests — rules, shoe, strategy, chip conservation
npm run test:render # 19 checks — React tree server-rendered against live engine data
npm run test:protocol   # 33 checks — 3 raw sockets: seats, bets, rounds, reconnect
npm run test:browser    # 37 checks — real React client in jsdom, driven by real clicks
npm run verify      # all of the above, with its own server, ~4 minutes
```

The two socket suites need a running server (`npm run dev:server`); `verify` starts one
for you and tears it down. `test:browser` accepts an origin, so it runs against the dev
proxy (`http://127.0.0.1:5173`), against the production build (`http://127.0.0.1:8787`),
or — pointed at a dead port — against the offline in-browser engine. All three pass.

The browser suite is not a mocked-out happy path. It mounts the real `<App/>`, opens a
real WebSocket, waits for a **fresh** betting window (not the last second of a stale
one), clicks real buttons, and asserts on the resulting DOM: chips in the bet slot *and*
on the seat, bankroll debited, hole card face-down, a settled round after two table
clicks, chat rendered, all four panel tabs, hotkeys dropping chips, no page errors.

It has caught real bugs — most usefully a chip tray that offered a 5 chip at a table
with a 10 minimum, which meant the very first bet a new player placed was silently
rejected.

---

## Layout

```
shared/src/     types.ts cards.ts actions.ts strategy.ts bots.ts table.ts host.ts
shared/test/    engine.test.ts
server/src/     index.ts (http + ws + static) hub.ts (rooms) room.ts
client/src/     App.tsx main.tsx
                components/  Felt Dealer Seat CardFace Chip Dock Panel TopBar
                             Overlays Lobby Avatar Suit Icons PlayingCard
                state/       store.ts (Zustand, persisted identity + settings)
                net/         connection.ts (socket + race) local.ts (in-tab engine)
                lib/         play.ts format.ts anchor.ts
                fx/          ShaderBackground Particles bus
                audio/       sound.ts
                styles/      base.css cards.css table.css ui.css
scripts/        verify.sh smoke.mjs render-smoke.tsx browser-smoke.tsx
```

TypeScript strict everywhere, including `noUncheckedIndexedAccess`. React 18.3,
Zustand 5, Framer Motion 11, Vite 6, `ws` 8 — no UI framework, no CSS-in-JS, no
Tailwind. The production bundle is ~368 kB of JS and ~44 kB of CSS with zero image
assets.

---

## Design notes

- **One hue, everywhere.** Each room publishes an `accent` hue; `App` writes `--accent-h`
  on the document root and the shader, felt, seat rings, buttons and glows all read it.
  Three rooms, three completely different moods, no duplicated styling.
- **The table has a mood.** `App` derives `epic` / `good` / `cold` / `shuffle` from the
  live snapshot and sets it as `data-mood` on the felt, which retints the rim glow and
  pops it on a big win. The room reacts to what's happening in it.
- **Custom properties as a layout language.** `--x/--y/--sc` place seats, `--cw/--ch/--i`
  size and fan cards, `--dx/--dy/--dr/--delay` drive deal flight, `--mx/--my` position
  the specular highlight, `--ratio` steps the felt aspect. The CSS is data-driven, not
  hand-placed.
- **Motion with intent.** Cards fly from the measured shoe position; chips arc into the
  bet slot; payouts ripple outward. Everything else is a 140–260 ms transition on
  `cubic-bezier(.22,.61,.36,1)` with a spring overshoot for things that land.

---

## Not a casino

This is a game. Chips have no value, cannot be bought, cannot be cashed out, and there
is no real-money path anywhere in the codebase. If you or someone you know has a problem
with gambling, in the US call or text **1-800-GAMBLER**.
