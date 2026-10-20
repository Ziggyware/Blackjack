import type { CSSProperties } from 'react';
import { hashString, initials } from '../lib/format.js';

/**
 * Deterministic identity mark: a hue-orb with a geometric sigil generated from
 * the player's name, so the same name always draws the same face.
 */
export function Avatar({
  name, hue, size = 30, offline = false, bot = false,
}: { name: string; hue: number; size?: number; offline?: boolean; bot?: boolean }): JSX.Element {
  const h = hashString(name);
  const style = { ['--ph' as string]: hue, width: size, height: size } as CSSProperties;
  const rays = Array.from({ length: 6 }, (_, i) => {
    const a = ((h >> (i * 3)) & 7) * 45;
    const len = 5 + ((h >> (i * 2 + 1)) % 4) * 2.6;
    return { a, len };
  });
  return (
    <div className="avatar" style={style} title={bot ? `${name} · house player` : name}>
      <svg className="avatar__sigil" viewBox="0 0 32 32" aria-hidden="true">
        <g stroke="#0a0512" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.55">
          {rays.map((r, i) => (
            <line
              key={i}
              x1="16" y1="16"
              x2={16 + Math.cos((r.a * Math.PI) / 180) * r.len}
              y2={16 + Math.sin((r.a * Math.PI) / 180) * r.len}
            />
          ))}
          <circle cx="16" cy="16" r={5 + (h % 4)} strokeWidth="1.2" opacity="0.5" />
        </g>
      </svg>
      <span className="avatar__ini" style={{ fontSize: size * 0.4 }}>{initials(name)}</span>
      {offline && <span className="avatar__off">✕</span>}
    </div>
  );
}
