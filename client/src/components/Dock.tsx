import type { TableView } from '@velvet/shared';
import { useStore, serverNow } from '../state/store.js';
import { Chip, ChipStack } from './Chip.js';
import { compact, money } from '../lib/format.js';
import { playState, trayDenominations } from '../lib/play.js';

function TimerDisc({ endsAt, total, label }: { endsAt: number | null; total: number; label: string }): JSX.Element {
  const now = serverNow();
  const left = endsAt ? Math.max(0, endsAt - now) : 0;
  const p = endsAt ? Math.min(1, left / total) : 0;
  const c = 2 * Math.PI * 27;
  const warn = left < 6000;
  return (
    <div className="timerdisc">
      <svg viewBox="0 0 62 62" aria-hidden="true">
        <circle className="bg" cx="31" cy="31" r="27" />
        {endsAt && (
          <circle
            className={`fg${warn ? (left < 3000 ? ' hot' : ' warn') : ''}`}
            cx="31" cy="31" r="27"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - p)}
          />
        )}
      </svg>
      <span className="timerdisc__v num">{endsAt ? Math.ceil(left / 1000) : '·'}</span>
      <span className="timerdisc__k">{label}</span>
    </div>
  );
}

export function Dock({ table, you }: { table: TableView; you: string | null }): JSX.Element {
  const send = useStore((s) => s.send);
  const coachOn = useStore((s) => s.coachOn);
  const setCoach = useStore((s) => s.setCoach);

  const {
    seatIndex, seat, seated, chips, betting, myTurn, hand, legal, advice, insuranceOpen,
  } = playState(table, you);

  const denoms = trayDenominations(table.rules);
  const bet = seat?.bet ?? 0;
  const canClear = betting && bet > 0;
  const turnName = table.turn !== null ? table.seats[table.turn.seat]?.occupant?.name : null;

  const status = (() => {
    if (!seated) return { title: 'SPECTATING', sub: 'Tap an open seat to play' };
    if (insuranceOpen) return { title: 'INSURANCE?', sub: `Dealer shows an ace — cover ${Math.floor((seat?.bet ?? 0) / 2)}?` };
    if (myTurn && hand) return { title: 'YOUR MOVE', sub: `${hand.total?.best ?? '—'}${hand.total?.soft ? ' soft' : ''} vs dealer ${table.dealer.cards[0]?.rank ?? '?'}` };
    if (betting) return bet > 0 ? { title: 'BET LOCKED', sub: money(bet) + ' on the felt' } : { title: 'PLACE YOUR BET', sub: `Limits ${table.rules.minBet}–${compact(table.rules.maxBet)}` };
    if (table.phase === 'dealer') return { title: 'DEALER', sub: 'Drawing to 17' };
    if (table.phase === 'settle') return { title: 'SETTLING', sub: 'Paying the table' };
    if (table.phase === 'shuffle') return { title: 'SHUFFLING', sub: 'Fresh shoe incoming' };
    if (table.phase === 'dealing') return { title: 'DEALING', sub: 'Cards in the air' };
    if (turnName) return { title: `${turnName.toUpperCase()}'S MOVE`, sub: seat?.inRound ? 'You are in this hand' : 'Waiting on the table' };
    return { title: 'STANDING BY', sub: `Round ${table.round}` };
  })();

  const timerEnds = myTurn ? seat?.timerEndsAt ?? null : (betting || table.phase === 'insurance' ? table.phaseEndsAt : null);
  const timerTotal = myTurn ? table.rules.turnSeconds * 1000 : table.phase === 'insurance' ? 9000 : table.rules.betSeconds * 1000;
  const hot = (a: string) => (coachOn && advice?.action === a ? ' is-hot' : '');

  return (
    <footer className="dock">
      <div
        className="dock__progress"
        style={{ width: timerEnds ? `${Math.max(0, Math.min(100, ((timerEnds - serverNow()) / timerTotal) * 100))}%` : '0%' }}
      />

      {/* ---- left: money ---- */}
      <div className="dock__zone">
        <div className="bank">
          <span className="bank__k">Bankroll</span>
          <span className={`bank__v${chips < table.rules.minBet ? ' is-low' : ''}`}>{money(chips)}</span>
        </div>

        {betting && (
          <div className="betbar">
            <div className={`betslot${bet > 0 ? ' has-bet' : ''}`}>
              <ChipStack amount={bet} size={30} max={7} />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="betslot__amt num">{bet > 0 ? money(bet) : '—'}</span>
                <span className="betslot__hint">{bet > 0 ? 'on the felt' : `min ${table.rules.minBet}`}</span>
              </div>
            </div>
            <div className="tray">
              {denoms.map((d) => (
                <Chip
                  key={d}
                  value={d}
                  size={36}
                  disabled={!betting || chips < d || bet + d > table.rules.maxBet}
                  onClick={() => send({ type: 'bet', amount: d })}
                  title={`Bet ${d}  ·  key ${denoms.indexOf(d) + 1}`}
                />
              ))}
            </div>
          </div>
        )}

        {betting && (
          <div className="actions" style={{ gap: 6 }}>
            <button
              className="btn btn--sm btn--ghost"
              disabled={!betting || chips < table.rules.minBet}
              onClick={() => send({ type: 'bet', amount: table.rules.minBet - bet })}
              title={`Bet the table minimum (${table.rules.minBet})`}
            >Min</button>
            <button className="btn btn--sm btn--ghost" disabled={!canClear} onClick={() => send({ type: 'clearBet' })}>Clear <span className="kbd">C</span></button>
            <button className="btn btn--sm btn--ghost" disabled={!canClear || bet < table.rules.minBet * 2} onClick={() => send({ type: 'bet', amount: -Math.floor(bet / 2) })}>½</button>
            <button className="btn btn--sm btn--ghost" disabled={bet * 2 > Math.min(chips + bet, table.rules.maxBet)} onClick={() => send({ type: 'bet', amount: bet })}>2×</button>
            <button className="btn btn--sm btn--ghost" disabled={chips <= 0} onClick={() => send({ type: 'bet', amount: Math.min(chips, table.rules.maxBet - bet) })}>Max</button>
          </div>
        )}

        {seated && chips < table.rules.minBet && !seat?.inRound && (
          <button className="btn btn--primary" onClick={() => send({ type: 'rebuy' })}>
            Rebuy {compact(table.rules.rebuyAmount)}
          </button>
        )}

        {coachOn && advice && myTurn && (
          <div className="coach">
            <span className="coach__badge">Coach · {advice.label}</span>
            <span className="coach__text">{advice.reason}</span>
          </div>
        )}
      </div>

      {/* ---- center: clock ---- */}
      <div className="dock__zone dock__zone--center" style={{ gap: 14 }}>
        <TimerDisc endsAt={timerEnds} total={timerTotal} label={myTurn ? 'your move' : betting ? 'betting' : 'table'} />
        <div className="dock__status">
          <b>{status.title}</b>
          <small>{status.sub}</small>
        </div>
      </div>

      {/* ---- right: actions ---- */}
      <div className="dock__zone dock__zone--right">
        {insuranceOpen ? (
          <div className="actions">
            <button className="act act--double" onClick={() => send({ type: 'insurance', take: true })}>
              <span className="kbd">Y</span><span>Insure</span>
            </button>
            <button className="act act--stand" onClick={() => send({ type: 'insurance', take: false })}>
              <span className="kbd">N</span><span>Decline</span>
            </button>
          </div>
        ) : myTurn && legal ? (
          <div className="actions">
            <button className={`act act--hit${hot('hit')}`} disabled={!legal.hit} onClick={() => send({ type: 'action', action: 'hit' })}>
              <span className="kbd">H</span><span>Hit</span>
            </button>
            <button className={`act act--stand${hot('stand')}`} disabled={!legal.stand} onClick={() => send({ type: 'action', action: 'stand' })}>
              <span className="kbd">S</span><span>Stand</span>
            </button>
            <button className={`act act--double${hot('double')}`} disabled={!legal.double} onClick={() => send({ type: 'action', action: 'double' })}>
              <span className="kbd">D</span><span>Double</span>
            </button>
            <button className={`act act--split${hot('split')}`} disabled={!legal.split} onClick={() => send({ type: 'action', action: 'split' })}>
              <span className="kbd">P</span><span>Split</span>
            </button>
            {table.rules.surrender === 'late' && (
              <button className={`act act--surrender${hot('surrender')}`} disabled={!legal.surrender} onClick={() => send({ type: 'action', action: 'surrender' })}>
                <span className="kbd">R</span><span>Fold</span>
              </button>
            )}
          </div>
        ) : (
          <div className="actions">
            {!seated && (
              <span className="betslot__hint" style={{ marginRight: 4 }}>Choose a seat to join the round</span>
            )}
            <button
              className={`btn btn--sm${seat?.occupant?.autoRebet ? ' btn--primary' : ' btn--ghost'}`}
              disabled={!seated}
              onClick={() => send({ type: 'autoRebet', on: !seat?.occupant?.autoRebet })}
              title="Automatically repeat your last wager each round"
            >
              Auto-rebet {seat?.occupant?.autoRebet ? 'on' : 'off'}
            </button>
            <button className="btn btn--sm btn--ghost" onClick={() => setCoach(!coachOn)} title="Toggle the basic-strategy coach">
              Coach {coachOn ? 'on' : 'off'}
            </button>
            <button className="btn btn--sm btn--ghost" onClick={() => send({ type: 'bots', count: 1 })} title="Seat a house player">
              + House player
            </button>
          </div>
        )}
      </div>
    </footer>
  );
}
