import { useState } from 'react';
import type { TableView } from '@velvet/shared';
import { useStore } from '../state/store.js';
import { IconCoach, IconCopy, IconExit, IconPanel, IconSound, Spade } from './Icons.js';
import { compact, signed } from '../lib/format.js';

export function TopBar({ table }: { table: TableView | null }): JSX.Element {
  const kind = useStore((s) => s.kind);
  const status = useStore((s) => s.status);
  const latency = useStore((s) => s.latency);
  const soundOn = useStore((s) => s.soundOn);
  const setSound = useStore((s) => s.setSound);
  const coachOn = useStore((s) => s.coachOn);
  const setCoach = useStore((s) => s.setCoach);
  const panelOpen = useStore((s) => s.panelOpen);
  const setPanel = useStore((s) => s.setPanel);
  const leaveTable = useStore((s) => s.leaveTable);
  const [copied, setCopied] = useState(false);

  const connDot = status === 'open' ? '' : status === 'reconnecting' || status === 'connecting' ? ' warn' : ' bad';
  const connLabel = kind === 'local'
    ? 'LOCAL ENGINE'
    : status === 'open'
      ? `${latency ?? 0}ms`
      : status === 'reconnecting' ? 'RECONNECTING' : status.toUpperCase();

  const copyCode = async () => {
    if (!table) return;
    try {
      await navigator.clipboard.writeText(table.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard blocked */ }
  };

  return (
    <header className="top">
      <div className="brand">
        <span className="brand__mark"><Spade /></span>
        <span className="brand__name">VELVET</span>
      </div>

      {table && (
        <div className="top__room">
          <span className="top__roomname">{table.name}</span>
          <button className="codechip" onClick={copyCode} title="Copy the table code">
            {copied ? 'COPIED' : table.code} <IconCopy />
          </button>
          {table.private && <span className="badge badge--priv">private</span>}
          {table.rules.fiveCardCharlie && <span className="badge">charlie</span>}
        </div>
      )}

      <div className="top__spacer" />

      {table && (
        <div className="top__stats">
          <div className="stat">
            <span className="stat__k">Round</span>
            <span className="stat__v">{table.round}</span>
          </div>
          <div className="stat">
            <span className="stat__k">House</span>
            <span className={`stat__v ${table.houseNet > 0 ? 'neg' : table.houseNet < 0 ? 'pos' : ''}`}>
              {signed(-table.houseNet)}
            </span>
          </div>
          <div className="stat">
            <span className="stat__k">Shoe</span>
            <span className="stat__v gold">{compact(table.shoe.remaining)}</span>
          </div>
          <div className="stat">
            <span className="stat__k">Seats</span>
            <span className="stat__v">
              {table.seats.filter((s) => s.occupant).length}/{table.seats.length}
            </span>
          </div>
        </div>
      )}

      <div className="top__tools">
        <span className="conn" title={kind === 'local' ? 'Running the engine in this tab' : 'Room server connection'}>
          <span className={`conn__dot${connDot}`} />
          {connLabel}
        </span>
        <button className="btn btn--icon btn--ghost" onClick={() => setSound(!soundOn)} title={soundOn ? 'Mute (M)' : 'Unmute (M)'} aria-label="Toggle sound">
          <IconSound on={soundOn} />
        </button>
        <button className={`btn btn--icon ${coachOn ? '' : 'btn--ghost'}`} onClick={() => setCoach(!coachOn)} title="Basic-strategy coach" aria-label="Toggle coach">
          <IconCoach />
        </button>
        <button className="btn btn--icon btn--ghost" onClick={() => setPanel(!panelOpen)} title="Side panel (Tab)" aria-label="Toggle panel">
          <IconPanel />
        </button>
        {table && (
          <button className="btn btn--icon btn--ghost" onClick={leaveTable} title="Back to the lobby" aria-label="Leave table">
            <IconExit />
          </button>
        )}
      </div>
    </header>
  );
}
