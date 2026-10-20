import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useStore } from './state/store.js';
import { hashString } from './lib/format.js';
import { playState, trayDenominations } from './lib/play.js';
import { ShaderBackground } from './fx/ShaderBackground.js';
import { Particles } from './fx/Particles.js';
import { TopBar } from './components/TopBar.js';
import { Felt } from './components/Felt.js';
import { Panel } from './components/Panel.js';
import { Dock } from './components/Dock.js';
import { Lobby } from './components/Lobby.js';
import { ErrorBar, Reactions, Toasts } from './components/Overlays.js';

/** Coarse clock so countdown rings stay honest between server snapshots. */
function useServerClock(ms = 100): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now + useStore.getState().clockOffset;
}

export default function App(): JSX.Element {
  const boot = useStore((s) => s.boot);
  const table = useStore((s) => s.table);
  const atTable = useStore((s) => s.atTable);
  const rooms = useStore((s) => s.rooms);
  const you = useStore((s) => s.you);
  const status = useStore((s) => s.status);
  const send = useStore((s) => s.send);
  const setSound = useStore((s) => s.setSound);
  const setPanel = useStore((s) => s.setPanel);

  const localNow = useServerClock();
  const lastBet = useRef(0);

  useEffect(() => { void boot(); }, [boot]);

  const accent = useMemo(() => {
    if (!table) return 322;
    const room = rooms.find((r) => r.roomId === table.roomId);
    return room?.accent ?? hashString(table.code) % 360;
  }, [rooms, table]);

  // remember the standing wager so "rebet" works from the keyboard
  useEffect(() => {
    if (!table) return;
    const seat = table.seats.find((s) => s.occupant?.id === you);
    if (seat && seat.bet > 0) lastBet.current = seat.bet;
  }, [table, you]);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent-h', String(accent));
  }, [accent]);

  /** the rim of the felt reacts to what just happened */
  const mood = useMemo(() => {
    if (!table) return '';
    if (table.phase === 'settle') {
      if (table.seats.some((s) => s.hands.some((h) => h.result === 'blackjack' || h.result === 'charlie'))) return 'epic';
      if (table.dealer.bust) return 'good';
      if (table.seats.some((s) => s.inRound || (s.roundNet ?? 0) < 0)) return 'cold';
    }
    if (table.phase === 'shuffle') return 'shuffle';
    return '';
  }, [table]);

  const play = useMemo(() => playState(table, you), [table, you]);

  /* ---------- keyboard table talk ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const k = e.key.toLowerCase();

      if (k === 'm') { setSound(!useStore.getState().soundOn); return; }
      if (k === 'tab') { e.preventDefault(); setPanel(!useStore.getState().panelOpen); return; }
      if (!atTable || !table) return;

      const denoms = trayDenominations(table.rules);
      if (play.betting && /^[1-6]$/.test(k)) {
        const chip = denoms[Number(k) - 1];
        if (chip) send({ type: 'bet', amount: chip });
        return;
      }
      if (play.betting && k === 'c') { send({ type: 'clearBet' }); return; }
      if (play.betting && k === 'b' && lastBet.current >= table.rules.minBet) {
        send({ type: 'bet', amount: lastBet.current - (play.seat?.bet ?? 0) });
        return;
      }
      if (play.insuranceOpen) {
        if (k === 'y') send({ type: 'insurance', take: true });
        if (k === 'n') send({ type: 'insurance', take: false });
        return;
      }
      if (!play.myTurn || !play.legal) return;
      const map: Record<string, 'hit' | 'stand' | 'double' | 'split' | 'surrender'> = {
        h: 'hit', s: 'stand', d: 'double', p: 'split', r: 'surrender',
      };
      const action = map[k];
      if (action && play.legal[action]) {
        e.preventDefault();
        send({ type: 'action', action });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [atTable, table, play, send, setSound, setPanel]);

  /* ---------- specular hover on every tactile surface ---------- */
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const t = (e.target as HTMLElement | null)?.closest?.('.btn, .act, .room') as HTMLElement | null;
      if (!t) return;
      const r = t.getBoundingClientRect();
      t.style.setProperty('--mx', `${(e.clientX - r.left).toFixed(0)}px`);
      t.style.setProperty('--my', `${(e.clientY - r.top).toFixed(0)}px`);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  const showTable = atTable && table;

  return (
    <>
      <ShaderBackground accentHue={accent} />
      <div className="vignette" />
      <Particles />
      <Reactions />

      <div className="app" style={{ ['--accent-h' as string]: accent } as React.CSSProperties}>
        <TopBar table={table} />
        <div className="stage">
          <div className="tablewrap">
            {showTable ? (
              <Felt
                table={table}
                mood={mood}
                you={you}
                serverNow={localNow}
                onSit={(i) => send({ type: 'sit', seat: i })}
                onStandUp={() => send({ type: 'leaveSeat' })}
              />
            ) : (
              <div className="reconnect__b" style={{ opacity: atTable ? 1 : 0 }}>
                <div className="spinner" />
                <span className="eyebrow">Taking your seat…</span>
              </div>
            )}
          </div>
          {showTable && <Panel table={table} you={you} />}
        </div>
        {showTable && <Dock table={table} you={you} />}
      </div>

      <div className="grain" />
      <Toasts table={table} />
      <ErrorBar />

      {status === 'reconnecting' && atTable && (
        <div className="reconnect">
          <div className="reconnect__b glass" style={{ padding: '26px 34px', gap: 14 }}>
            <div className="spinner" />
            <b className="display" style={{ letterSpacing: '0.2em', fontSize: 12 }}>RECONNECTING</b>
            <span className="fineprint">Your seat and your chips are held.</span>
          </div>
        </div>
      )}

      <AnimatePresence>{!atTable && <Lobby />}</AnimatePresence>
    </>
  );
}
