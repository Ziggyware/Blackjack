import { useEffect, useRef } from 'react';
import type { TableView } from '@velvet/shared';
import { shoeAnchor } from '../lib/anchor.js';
import { Dealer, Shoe, Tray } from './Dealer.js';
import { Seat } from './Seat.js';
import { compact } from '../lib/format.js';

const PHASE_LABEL: Record<string, string> = {
  idle: 'TABLE OPEN',
  shuffle: 'SHUFFLING',
  betting: 'PLACE YOUR BETS',
  dealing: 'DEALING',
  insurance: 'INSURANCE',
  players: 'PLAYER ACTION',
  dealer: 'DEALER',
  settle: 'SETTLEMENT',
};

/** Seat anchors on an elliptical arc across the bottom of the felt. */
export function seatPosition(i: number, n: number): { x: number; y: number; sc: number } {
  const t = (i + 0.5) / Math.max(1, n);
  const a = (178 - t * 176) * (Math.PI / 180);
  const rx = 42.5;
  const ry = n <= 5 ? 32 : 37;
  return {
    x: 50 + rx * Math.cos(a),
    y: Math.min(83, 41 + ry * Math.sin(a)),
    sc: 0.86 + 0.14 * Math.sin(a),
  };
}

export function Felt({
  table, you, serverNow, mood = '', onSit, onStandUp,
}: {
  table: TableView;
  you: string | null;
  mood?: string;
  serverNow: number;
  onSit: (i: number) => void;
  onStandUp: () => void;
}): JSX.Element {
  const shoeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    shoeAnchor.set(shoeRef.current);
    return () => shoeAnchor.set(null);
  }, []);

  const phaseLeft = table.phaseEndsAt ? Math.max(0, table.phaseEndsAt - serverNow) : 0;
  const pen = table.shoe.penetration;
  const cutMark = 1 - table.shoe.reshuffleAt / Math.max(1, table.shoe.total);
  const r = table.rules;

  return (
    <div className="felt" data-mood={mood || undefined}>
      <div className="felt__sweep" />
      <div className="felt__noise" />
      <div className="felt__stitch" />

      <svg className="felt__arc" viewBox="0 0 1000 602" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <path id="velvetArc" d="M 210 302 Q 500 256 790 302" fill="none" />
          <path id="velvetArc2" d="M 272 350 Q 500 312 728 350" fill="none" />
        </defs>
        <text>
          <textPath href="#velvetArc" startOffset="50%" textAnchor="middle">
            {`VELVET · BLACKJACK PAYS ${r.blackjackPays === 1.5 ? '3 TO 2' : '6 TO 5'} · DEALER MUST ${r.dealerStandsSoft17 ? 'STAND ON ALL 17S' : 'DRAW TO 16 AND STAND ON HARD 17'}`}
          </textPath>
        </text>
        <text style={{ fontSize: 8.4, opacity: 0.66 }}>
          <textPath href="#velvetArc2" startOffset="50%" textAnchor="middle">
            {`${r.fiveCardCharlie ? 'FIVE CARD CHARLIE WINS · ' : ''}${r.surrender === 'late' ? 'LATE SURRENDER · ' : ''}${r.decks} DECKS · INSURANCE ${r.insurancePays} TO 1 · LIMITS ${r.minBet}–${compact(r.maxBet)}`}
          </textPath>
        </text>
      </svg>

      <Dealer dealer={table.dealer} />

      <div ref={shoeRef} style={{ position: 'absolute', right: '5%', top: '15%', zIndex: 5 }}>
        <Shoe shuffling={table.shoe.shuffling} remaining={table.shoe.remaining} total={table.shoe.total} />
      </div>
      <Tray discarded={table.shoe.discarded} />

      <div className="centerhud">
        <div className="phasepill">
          <span className="phasepill__dot" />
          {PHASE_LABEL[table.phase] ?? table.phase}
          {table.phaseEndsAt !== null && phaseLeft > 0 && (
            <span className="num">{phaseLeft < 10000 ? (phaseLeft / 1000).toFixed(1) : Math.round(phaseLeft / 1000)}s</span>
          )}
          <span className="num" style={{ color: 'var(--ink-3)', letterSpacing: '0.08em' }}>R{table.round}</span>
        </div>
        <div className="shoemeter">
          <div className="shoemeter__bar">
            <div className="shoemeter__fill" style={{ width: `${Math.min(100, pen * 100)}%` }} />
            <div className="shoemeter__cut" style={{ left: `${Math.min(100, cutMark * 100)}%` }} />
          </div>
          <div className="eyebrow">
            {table.shoe.remaining} cards left · house {table.houseNet >= 0 ? '+' : '−'}{compact(Math.abs(table.houseNet))}
          </div>
        </div>
      </div>

      {table.seats.map((seat) => (
        <Seat
          key={seat.index}
          seat={seat}
          pos={seatPosition(seat.index, table.seats.length)}
          isYou={seat.occupant?.id === you}
          phase={table.phase}
          turnSeat={table.turn?.seat ?? null}
          turnHand={table.turn?.hand ?? null}
          rules={table.rules}
          serverNow={serverNow}
          onSit={onSit}
          onStandUp={onStandUp}
        />
      ))}
    </div>
  );
}
