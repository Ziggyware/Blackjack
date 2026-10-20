import type { CSSProperties } from 'react';
import { CHIP_COLORS, chipBreakdown } from '@velvet/shared';
import { compact } from '../lib/format.js';

function palette(value: number) {
  return CHIP_COLORS[value] ?? { body: '#8b5cf6', edge: '#e2d5ff', ink: '#170a2e' };
}

export function Chip({
  value, size = 34, onClick, disabled, title,
}: {
  value: number; size?: number; onClick?: () => void; disabled?: boolean; title?: string;
}): JSX.Element {
  const p = palette(value);
  const style = {
    ['--size' as string]: `${size}px`,
    ['--body' as string]: p.body,
    ['--edge' as string]: p.edge,
    ['--ink' as string]: p.ink,
  } as CSSProperties;
  const label = value >= 1000 ? `${value / 1000}k` : String(value);
  if (!onClick) {
    return <div className="chip" style={style} title={title ?? label}><span className="chip__v">{label}</span></div>;
  }
  return (
    <button className="chip chip--btn" style={style} onClick={onClick} disabled={disabled} title={title ?? `Add ${value}`}>
      <span className="chip__v">{label}</span>
    </button>
  );
}

/** A physical stack of chips representing a wager. */
export function ChipStack({ amount, size = 26, max = 8 }: { amount: number; size?: number; max?: number }): JSX.Element | null {
  if (amount <= 0) return null;
  const chips = chipBreakdown(amount);
  const shown = chips.slice(0, max);
  const extra = chips.length - shown.length;
  const lift = Math.max(2.4, size * 0.13);
  return (
    <div className="chipstack" style={{ width: size, height: size + shown.length * lift }}>
      {shown.map((v, i) => {
        const p = palette(v);
        return (
          <div
            key={`${v}-${i}`}
            className="chip"
            style={{
              ['--size' as string]: `${size}px`,
              ['--body' as string]: p.body,
              ['--edge' as string]: p.edge,
              ['--ink' as string]: p.ink,
              ['--i' as string]: i,
              ['--lift' as string]: `${-lift}px`,
              ['--tilt' as string]: `${((i * 37) % 9) - 4}deg`,
            } as CSSProperties}
          >
            {i === shown.length - 1 && size >= 24 && (
              <span className="chip__v">{v >= 1000 ? `${v / 1000}k` : v}</span>
            )}
          </div>
        );
      })}
      {extra > 0 && (
        <span
          className="num"
          style={{
            position: 'absolute', left: size + 5, bottom: 1, fontSize: 9.5,
            color: 'var(--ink-3)', whiteSpace: 'nowrap',
          }}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}

export function BetLabel({ amount }: { amount: number }): JSX.Element {
  return <span className="seat__betamt">{compact(amount)}</span>;
}
