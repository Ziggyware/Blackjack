export function Spade({ size = 24 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id="spadeG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff3ea5" />
          <stop offset="0.5" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <path
        fill="url(#spadeG)"
        d="M12 1.6c-.4 3.6-2.2 6-4.3 8.1C5.4 12 3 13.9 3 16.6 3 19 4.9 21 7.4 21c1.4 0 2.7-.6 3.6-1.6-.3 1.9-1.2 3.4-2.6 4.4h7.2c-1.4-1-2.3-2.5-2.6-4.4.9 1 2.2 1.6 3.6 1.6 2.5 0 4.4-2 4.4-4.4 0-2.7-2.4-4.6-4.7-6.9C14.2 7.6 12.4 5.2 12 1.6z"
      />
    </svg>
  );
}

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function IconSound({ on }: { on: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" {...S}>
      <path d="M4 9.5h3L12 5v14l-5-4.5H4z" fill="currentColor" stroke="none" />
      {on
        ? <><path d="M15.8 9a4.2 4.2 0 0 1 0 6" /><path d="M18.3 6.5a7.8 7.8 0 0 1 0 11" /></>
        : <><path d="M16.5 9.5l5 5" /><path d="M21.5 9.5l-5 5" /></>}
    </svg>
  );
}

export function IconCoach(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" {...S}>
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5.9 1.1 1 1.7l.1.5h5l.1-.5c.1-.6.4-1.2 1-1.7A6 6 0 0 0 12 3z" />
      <path d="M9.8 19h4.4M10.5 21.2h3" />
    </svg>
  );
}

export function IconPanel(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" {...S}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M14.5 4.5v15" />
    </svg>
  );
}

export function IconExit(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" {...S}>
      <path d="M14 4.5h4.5A1.5 1.5 0 0 1 20 6v12a1.5 1.5 0 0 1-1.5 1.5H14" />
      <path d="M10 8l-4 4 4 4M6 12h9" />
    </svg>
  );
}

export function IconSeat(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" {...S}>
      <path d="M6 19v-4a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v4" />
      <circle cx="12" cy="7" r="3" />
    </svg>
  );
}

export function IconCopy(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" {...S}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5A1.5 1.5 0 0 0 5.5 15" />
    </svg>
  );
}
