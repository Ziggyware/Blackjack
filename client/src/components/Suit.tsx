import type { Suit } from '@velvet/shared';

/** Hand-drawn suit geometry — crisp at any size, no font dependency. */
export const SUIT_PATH: Record<Suit, string> = {
  S: 'M12 1.6c-.4 3.6-2.2 6-4.3 8.1C5.4 12 3 13.9 3 16.6 3 19 4.9 21 7.4 21c1.4 0 2.7-.6 3.6-1.6-.3 1.9-1.2 3.4-2.6 4.4h7.2c-1.4-1-2.3-2.5-2.6-4.4.9 1 2.2 1.6 3.6 1.6 2.5 0 4.4-2 4.4-4.4 0-2.7-2.4-4.6-4.7-6.9C14.2 7.6 12.4 5.2 12 1.6z',
  H: 'M12 22.4l-1.5-1.4C5.2 16.2 1.8 13.1 1.8 9.2 1.8 6 4.3 3.5 7.4 3.5c1.8 0 3.5.8 4.6 2.2 1.1-1.4 2.8-2.2 4.6-2.2 3.1 0 5.6 2.5 5.6 5.7 0 3.9-3.4 7-8.7 11.8L12 22.4z',
  D: 'M12 1.4c.9 3.9 2.6 6.3 5 8.1 1.6 1.2 3.1 1.9 5 2.5-1.9.6-3.4 1.3-5 2.5-2.4 1.8-4.1 4.2-5 8.1-.9-3.9-2.6-6.3-5-8.1-1.6-1.2-3.1-1.9-5-2.5 1.9-.6 3.4-1.3 5-2.5 2.4-1.8 4.1-4.2 5-8.1z',
  C: 'M12 1.8a4.6 4.6 0 0 0-4.2 6.5 4.7 4.7 0 1 0-1.3 9.2c1.5 0 2.9-.6 3.9-1.6-.2 2.1-1.1 3.9-2.6 5.3h8.4c-1.5-1.4-2.4-3.2-2.6-5.3 1 1 2.4 1.6 3.9 1.6a4.7 4.7 0 1 0-1.3-9.2A4.6 4.6 0 0 0 12 1.8z',
};

export function isRed(suit: Suit): boolean {
  return suit === 'H' || suit === 'D';
}

export function SuitIcon({ suit, className }: { suit: Suit; className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path d={SUIT_PATH[suit]} fill="currentColor" />
    </svg>
  );
}
