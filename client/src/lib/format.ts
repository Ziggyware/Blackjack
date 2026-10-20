import type { PlayerStats, Rank, Suit } from '@velvet/shared';

export const nf = new Intl.NumberFormat('en-US');

export function money(n: number): string {
  const sign = n < 0 ? '−' : '';
  return `${sign}${nf.format(Math.abs(Math.round(n)))}`;
}

export function signed(n: number): string {
  if (n === 0) return '0';
  return `${n > 0 ? '+' : '−'}${nf.format(Math.abs(Math.round(n)))}`;
}

export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return nf.format(Math.round(n));
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0] ?? '?').slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function clock(msLeft: number): string {
  return Math.max(0, Math.ceil(msLeft / 1000)).toString();
}

export function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

export function winRate(stats: PlayerStats): string {
  const decided = stats.wins + stats.losses;
  if (!decided) return '—';
  return `${Math.round((stats.wins / decided) * 100)}%`;
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rankLabel(rank: Rank): string {
  return rank === 'A' ? 'ACE' : rank === 'K' ? 'KING' : rank === 'Q' ? 'QUEEN' : rank === 'J' ? 'JACK' : rank;
}

export function suitName(suit: Suit): string {
  return suit === 'S' ? 'Spades' : suit === 'H' ? 'Hearts' : suit === 'D' ? 'Diamonds' : 'Clubs';
}
