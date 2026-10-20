import type { Rank, Suit } from '@velvet/shared';
import { SUIT_PATH, SuitIcon, isRed } from './Suit.js';

/** Pip placements as [x%, y%, rotation] on the card face. */
const PIPS: Record<string, [number, number, number][]> = {
  '2': [[50, 16, 0], [50, 84, 180]],
  '3': [[50, 16, 0], [50, 50, 0], [50, 84, 180]],
  '4': [[29, 16, 0], [71, 16, 0], [29, 84, 180], [71, 84, 180]],
  '5': [[29, 16, 0], [71, 16, 0], [50, 50, 0], [29, 84, 180], [71, 84, 180]],
  '6': [[29, 16, 0], [71, 16, 0], [29, 50, 0], [71, 50, 0], [29, 84, 180], [71, 84, 180]],
  '7': [[29, 16, 0], [71, 16, 0], [50, 33, 0], [29, 50, 0], [71, 50, 0], [29, 84, 180], [71, 84, 180]],
  '8': [[29, 16, 0], [71, 16, 0], [50, 33, 0], [29, 50, 0], [71, 50, 0], [50, 67, 180], [29, 84, 180], [71, 84, 180]],
  '9': [[29, 14, 0], [71, 14, 0], [29, 38, 0], [71, 38, 0], [50, 50, 0], [29, 62, 180], [71, 62, 180], [29, 86, 180], [71, 86, 180]],
  '10': [[29, 14, 0], [71, 14, 0], [50, 26, 0], [29, 38, 0], [71, 38, 0], [29, 62, 180], [71, 62, 180], [50, 74, 180], [29, 86, 180], [71, 86, 180]],
};

const COURT_TINT: Record<string, [string, string]> = {
  S: ['#2b2740', '#7d76bd'],
  H: ['#3d1526', '#d1587f'],
  D: ['#3d2415', '#d18b58'],
  C: ['#152f2a', '#54ab93'],
};

/**
 * Geometric court cards: rotational symmetry, a halo of rays, a crown of
 * chevrons, and the rank as the portrait. Traditional filigree, rebuilt as
 * a diagram.
 */
function Court({ rank, suit }: { rank: Rank; suit: Suit }): JSX.Element {
  const [dark, tint] = COURT_TINT[suit] ?? COURT_TINT.S!;
  const gid = `cg${rank}${suit}`;
  const half = (flip: boolean) => (
    <g transform={flip ? 'rotate(180 50 70)' : undefined}>
      {[-34, -22, -11, 0, 11, 22, 34].map((a) => (
        <line
          key={a}
          x1="50" y1="46" x2="50" y2="17"
          stroke="currentColor" strokeWidth="1.5" opacity="0.3"
          transform={`rotate(${a} 50 46)`} strokeLinecap="round"
        />
      ))}
      <path d="M30 41 L38 28 L44 36 L50 23 L56 36 L62 28 L70 41 Z" fill="currentColor" opacity="0.85" />
      <path d="M25 45 H75" stroke="currentColor" strokeWidth="2" opacity="0.45" strokeLinecap="round" />
      <path d="M22 98 Q50 75 78 98" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.4" />
      <path d="M28 107 Q50 88 72 107" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.28" />
      <circle cx="50" cy="63" r="16" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.4" />
    </g>
  );
  return (
    <svg viewBox="0 0 100 140" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor={tint} stopOpacity="0.95" />
          <stop offset="1" stopColor={dark} stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <rect x="13" y="9" width="74" height="122" rx="7" fill={`url(#${gid})`} opacity="0.18" />
      <rect x="13" y="9" width="74" height="122" rx="7" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.45" />
      {half(false)}
      {half(true)}
      <text
        x="50" y="70"
        textAnchor="middle" dominantBaseline="middle"
        fill="currentColor"
        style={{ fontFamily: "'Unbounded', sans-serif", fontSize: 26, fontWeight: 700 }}
      >
        {rank}
      </text>
      <g opacity="0.85">
        <g transform="translate(19 14) scale(0.5)"><path d={SUIT_PATH[suit]} fill="currentColor" /></g>
        <g transform="translate(81 126) scale(0.5) rotate(180)"><path d={SUIT_PATH[suit]} fill="currentColor" /></g>
      </g>
    </svg>
  );
}

export function CardFace({ rank, suit }: { rank: Rank; suit: Suit }): JSX.Element {
  const red = isRed(suit);
  const pips = PIPS[rank];
  return (
    <div className={`card__face card__face--front ${red ? 'red' : 'black'}`}>
      <div className="card__index">
        <span>{rank}</span>
        <SuitIcon suit={suit} />
      </div>
      <div className="card__index card__index--br">
        <span>{rank}</span>
        <SuitIcon suit={suit} />
      </div>
      <div className="card__body">
        {rank === 'A' ? (
          <div className="pip pip--ace" style={{ left: '50%', top: '50%' }}>
            <SuitIcon suit={suit} />
          </div>
        ) : pips ? (
          pips.map(([x, y, rot], i) => (
            <div key={i} className="pip" style={{ left: `${x}%`, top: `${y}%` }}>
              <div style={{ transform: `rotate(${rot}deg)`, width: '100%', height: '100%' }}>
                <SuitIcon suit={suit} />
              </div>
            </div>
          ))
        ) : (
          <div className="court">
            <Court rank={rank} suit={suit} />
          </div>
        )}
      </div>
    </div>
  );
}

export function CardBack(): JSX.Element {
  return (
    <div className="card__face card__face--back">
      <div className="card__mark" />
    </div>
  );
}
