import { useEffect, useState } from 'react';
import type { HandView, Phase, Rules, SeatView } from '@velvet/shared';
import { Avatar } from './Avatar.js';
import { ChipStack } from './Chip.js';
import { CardRow } from './PlayingCard.js';
import { compact, signed } from '../lib/format.js';

function useTick(active: boolean, ms = 100): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setN((v) => v + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return n;
}

function TurnRing({ endsAt, total, hue }: { endsAt: number; total: number; hue: number }): JSX.Element | null {
  const active = endsAt > 0;
  useTick(active, 90);
  if (!active) return null;
  const left = Math.max(0, endsAt - Date.now());
  const p = Math.min(1, Math.max(0, left / total));
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <svg className="seat__ring" viewBox="0 0 44 44" style={{ ['--ph' as string]: hue }} aria-hidden="true">
      <circle cx="22" cy="22" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - p)} transform="rotate(-90 22 22)" />
    </svg>
  );
}

function HandGroup({
  hand, active, rules, holo,
}: { hand: HandView; active: boolean; rules: Rules; holo: boolean }): JSX.Element {
  const t = hand.total;
  const cls = t?.bust ? 'is-bust' : t?.best === 21 ? 'is-21' : t?.soft ? 'is-soft' : '';
  const label = hand.result === 'blackjack' ? 'BJ' : t ? String(t.best) : '—';
  return (
    <div className={`hand${active ? ' is-active' : ''}`}>
      <CardRow cards={hand.cards} holo={holo} scale={0.94} />
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {t && <span className={`hand__total ${cls}`}>{hand.result === 'blackjack' ? 'BLACKJACK' : label}</span>}
        {hand.doubled && <span className="hand__tag">2×</span>}
        {hand.split && <span className="hand__tag">split</span>}
        {hand.surrendered && <span className="hand__tag">surr</span>}
        {hand.result === 'charlie' && <span className="hand__tag">charlie</span>}
      </div>
      {hand.cards.length === 5 && rules.fiveCardCharlie && !t?.bust && (
        <span className="hand__tag" style={{ color: 'var(--lime)' }}>5-card</span>
      )}
    </div>
  );
}

const LAST_ACTION: Record<string, string> = {
  hit: 'HIT', stand: 'STAND', double: 'DOUBLE', split: 'SPLIT',
  surrender: 'SURRENDER', insurance: 'INSURANCE', bet: 'BET', rebet: 'REBET',
};

export interface SeatProps {
  seat: SeatView;
  isYou: boolean;
  phase: Phase;
  turnSeat: number | null;
  turnHand: number | null;
  rules: Rules;
  serverNow: number;
  pos: { x: number; y: number; sc: number };
  onSit: (index: number) => void;
  onStandUp: () => void;
}

export function Seat({
  seat, isYou, phase, turnSeat, turnHand, rules, serverNow, pos, onSit, onStandUp,
}: SeatProps): JSX.Element {
  const place = {
    ['--x' as string]: `${pos.x}%`,
    ['--y' as string]: `${pos.y}%`,
    ['--sc' as string]: pos.sc,
    ['--ph' as string]: seat.occupant?.hue ?? 220,
  } as React.CSSProperties;
  const occ = seat.occupant;
  const isTurn = turnSeat === seat.index && phase === 'players';
  const hue = occ?.hue ?? 220;
  const timerTotal = isTurn ? rules.turnSeconds * 1000 : 9000;
  const timerEnds = seat.timerEndsAt ?? 0;

  const holo = seat.hands.some((h) => h.result === 'blackjack' || h.result === 'charlie');
  const netClass = (seat.roundNet ?? 0) > 0 ? 'badge--epic' : (seat.roundNet ?? 0) < 0 ? 'badge--lose' : 'badge--push';

  let statusText = '';
  let statusCls = '';
  if (phase === 'settle' && seat.roundLabel) { statusText = seat.roundLabel; statusCls = (seat.roundNet ?? 0) > 0 ? 'badge--win' : ''; }
  else if (isTurn) { statusText = occ?.thinking ? 'DECIDING' : 'TURN'; statusCls = 'seat__status--act'; }
  else if (seat.inRound && occ) { statusText = seat.status === 'done' ? 'STOOD' : 'IN HAND'; }
  else if (phase === 'betting' && occ) { statusText = seat.bet > 0 ? 'BET' : 'WAITING'; }
  else if (occ?.lastAction && serverNow - occ.lastActionAt < 2600) {
    statusText = LAST_ACTION[occ.lastAction] ?? '';
    statusCls = 'seat__status--last';
  }

  const locked =
    seat.inRound || phase === 'dealing' || phase === 'dealer' || phase === 'settle';

  if (!occ) {
    return (
      <div className="seat seat--empty" data-seat={seat.index} style={place}>
        <button
          className="seat__empty"
          onClick={() => onSit(seat.index)}
          disabled={locked}
          title={seat.inRound ? 'Wait for the round' : `Take seat ${seat.index + 1}`}
          aria-label={`Take seat ${seat.index + 1}`}
        >
          +
        </button>
      </div>
    );
  }

  return (
    <div className="seat" data-seat={seat.index} style={place}>
      {seat.hands.length > 0 && (
        <div className="seat__cards">
          {seat.hands.length === 1 ? (
            <>
              <HandGroup
                hand={seat.hands[0]!}
                active={isTurn && turnHand === 0}
                rules={rules}
                holo={holo}
              />
              {phase === 'settle' && seat.roundNet !== null && seat.roundNet !== 0 && (
                <span className={`cardrow__badge ${netClass}`}>{signed(seat.roundNet)}</span>
              )}
            </>
          ) : (
            <div className="seat__hands">
              {seat.hands.map((h, i) => (
                <HandGroup key={h.id} hand={h} active={isTurn && turnHand === i} rules={rules} holo={holo} />
              ))}
              {phase === 'settle' && seat.roundNet !== null && seat.roundNet !== 0 && (
                <span className={`cardrow__badge ${netClass}`}>{signed(seat.roundNet)}</span>
              )}
            </div>
          )}
        </div>
      )}

      <div className="seat__bet">
        {seat.bet > 0 && <ChipStack amount={seat.bet} size={22} max={6} />}
        {seat.bet > 0 && <span className="seat__betamt">{compact(seat.bet)}</span>}
        {seat.insurance > 0 && (
          <span className="hand__tag" style={{ color: 'var(--gold)' }}>ins {compact(seat.insurance)}</span>
        )}
      </div>

      <div
        className={`seat__pod${isTurn ? ' is-turn' : ''}${!occ.connected ? ' is-off' : ''}${seat.status === 'out' && phase !== 'betting' ? ' is-out' : ''}`}
        style={{ ['--ph' as string]: hue } as React.CSSProperties}
        data-person={occ.id}
        onDoubleClick={isYou ? onStandUp : undefined}
        title={
          isYou
            ? 'Double-click to stand up'
            : !occ.connected
              ? `${occ.name} stepped away — the seat is held for them`
              : occ.bot
                ? `${occ.name} is a house player`
                : undefined
        }
      >
        {isTurn && <TurnRing endsAt={timerEnds} total={timerTotal} hue={hue} />}
        <Avatar name={occ.name} hue={hue} size={30} offline={!occ.connected} bot={occ.bot} />
        <div className="seat__meta">
          <div className="seat__name">
            {isYou && <span style={{ color: 'var(--accent)' }}>▸</span>}
            {occ.name}
            {occ.bot && <span className="bot">AI</span>}
          </div>
          <div className="seat__chips">
            <b>{compact(occ.chips)}</b>{' '}
            {occ.stats.net !== 0 && (
              <span style={{ color: occ.stats.net > 0 ? 'var(--good)' : '#ff8f9a' }}>
                {signed(occ.stats.net)}
              </span>
            )}
          </div>
        </div>
        {statusText && <span className={`seat__status ${statusCls}`}>{statusText}</span>}
      </div>

      {/* A house player always yields their seat to a human — offer the move. */}
      {occ.bot && !isYou && (
        <button
          className="seat__claim"
          onClick={() => onSit(seat.index)}
          disabled={locked}
          title={locked ? 'Wait for the round' : `${occ.name} will move — take seat ${seat.index + 1}`}
          aria-label={`Take seat ${seat.index + 1} from ${occ.name}`}
        >
          take seat
        </button>
      )}
    </div>
  );
}
