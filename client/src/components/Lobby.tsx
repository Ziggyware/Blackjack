import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { CardView, Rank, Suit } from '@velvet/shared';
import { useStore } from '../state/store.js';
import { Avatar } from './Avatar.js';
import { CardFace } from './CardFace.js';
import { compact } from '../lib/format.js';

const FAN: [Rank, Suit][] = [['A', 'S'], ['K', 'H'], ['Q', 'D'], ['J', 'C'], ['10', 'S']];

function fanCard(rank: Rank, suit: Suit, i: number): CardView {
  return { id: `fan-${i}`, seq: i, at: 0, hidden: false, rank, suit };
}

const SUGGESTIONS = ['Nyx', 'Vesper', 'Kade', 'Sable', 'Rook', 'Iris', 'Onyx', 'Vega'];
const LS_LAST_ROOM = 'velvet.lastRoom';

function readLastRoom(): string | null {
  try { return localStorage.getItem(LS_LAST_ROOM); } catch { return null; }
}
function writeLastRoom(id: string): void {
  try { localStorage.setItem(LS_LAST_ROOM, id); } catch { /* ignore */ }
}

export function Lobby(): JSX.Element {
  const rooms = useStore((s) => s.rooms);
  const status = useStore((s) => s.status);
  const name = useStore((s) => s.name);
  const hue = useStore((s) => s.hue);
  const enter = useStore((s) => s.enter);
  const send = useStore((s) => s.send);
  const setIdentity = useStore((s) => s.setIdentity);

  const [selected, setSelected] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [draft, setDraft] = useState(name);
  const [hint] = useState(() => SUGGESTIONS[Math.floor(Math.random() * SUGGESTIONS.length)]!);

  useEffect(() => {
    if (selected || !rooms.length) return;
    const last = readLastRoom();
    setSelected(rooms.some((r) => r.roomId === last) ? last : rooms[0]!.roomId);
  }, [rooms, selected]);

  const room = rooms.find((r) => r.roomId === selected) ?? null;
  const canEnter = draft.trim().length >= 2 && (status === 'open' || status === 'offline');

  const go = () => {
    if (!canEnter) return;
    const clean = draft.trim().slice(0, 18);
    setIdentity(clean, hue);
    if (room) writeLastRoom(room.roomId);
    enter({ name: clean, hue, roomId: room?.roomId ?? null });
  };

  const joinByCode = () => {
    const c = code.trim().toUpperCase();
    if (c.length < 3 || !canEnter) return;
    const clean = draft.trim().slice(0, 18);
    setIdentity(clean, hue);
    enter({ name: clean, hue, code: c });
  };

  return (
    <motion.div
      className="lobby"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.03, filter: 'blur(8px)' }}
      transition={{ duration: 0.45, ease: [0.22, 0.61, 0.36, 1] }}
    >
      <motion.div
        className="lobby__card glass"
        initial={{ y: 26, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.06, ease: [0.22, 0.61, 0.36, 1] }}
      >
        <div className="lobby__head">
          <div className="lobby__fan">
            {FAN.map(([r, s], i) => (
              <div className="card" key={i} style={{ ['--i' as string]: i }}>
                <div className="card__tilt"><div className="card__inner"><CardFace rank={r} suit={s} /></div></div>
              </div>
            ))}
          </div>
          <h1 className="lobby__title">VELVET</h1>
          <p className="lobby__sub">Multiplayer blackjack · six decks · play money</p>
        </div>

        <div className="lobby__grid">
          {/* rooms */}
          <div>
            <div className="sect__h"><span className="eyebrow">Open tables</span></div>
            <div className="rooms">
              {rooms.map((r) => (
                <button
                  key={r.roomId}
                  className={`room${selected === r.roomId ? ' is-sel' : ''}`}
                  style={{ ['--rh' as string]: r.accent } as React.CSSProperties}
                  onClick={() => setSelected(r.roomId)}
                  onDoubleClick={() => { setSelected(r.roomId); setTimeout(go, 0); }}
                >
                  <span className="room__bar" />
                  <span className="room__b">
                    <span className="room__n">
                      {r.name}
                      {r.private && <span className="badge badge--priv">private</span>}
                      {r.fiveCardCharlie && <span className="badge">charlie</span>}
                      {!r.private && <span className="badge badge--live">live</span>}
                    </span>
                    <span className="room__t">{r.tagline}</span>
                    <span className="room__m">
                      <span><i>seats</i> {r.players}/{r.seats}</span>
                      <span><i>limits</i> {r.minBet}–{compact(r.maxBet)}</span>
                      <span><i>code</i> {r.code}</span>
                    </span>
                  </span>
                  <span className="room__go">
                    <span className="btn btn--sm btn--ghost">Join</span>
                  </span>
                </button>
              ))}
              {rooms.length === 0 && (
                <p className="fineprint">
                  {status === 'connecting' ? 'Finding the floor…' : 'No tables listed — enter anyway and one will be dealt for you.'}
                </p>
              )}
            </div>
          </div>

          {/* identity */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="field">
              <label htmlFor="nick">Table name</label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <Avatar name={draft || 'you'} hue={hue} size={40} />
                <input
                  id="nick"
                  type="text"
                  value={draft}
                  maxLength={18}
                  placeholder={hint}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
                  autoFocus
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="hue">Identity hue</label>
              <div className="huerow">
                <input
                  id="hue"
                  className="hueslider"
                  type="range"
                  min={0}
                  max={359}
                  value={hue}
                  onChange={(e) => setIdentity(draft, Number(e.target.value))}
                />
                <span className="num" style={{ width: 38, textAlign: 'right', color: `hsl(${hue} 90% 70%)` }}>{hue}°</span>
              </div>
            </div>

            <div className="field">
              <label htmlFor="code">Private table code</label>
              <div className="coderow">
                <input
                  id="code"
                  type="text"
                  value={code}
                  maxLength={6}
                  placeholder="ABCD"
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => { if (e.key === 'Enter') joinByCode(); }}
                />
                <button className="btn btn--ghost" onClick={joinByCode} disabled={code.trim().length < 3}>Join</button>
              </div>
            </div>

            <button
              className="btn btn--ghost"
              style={{ justifyContent: 'flex-start' }}
              onClick={() => {
                if (draft.trim().length < 2) return;
                setIdentity(draft.trim(), hue);
                send({
                  type: 'createRoom',
                  name: `${draft.trim().slice(0, 12).toUpperCase()}'S TABLE`,
                  private: true,
                  playerName: draft.trim().slice(0, 18),
                  hue,
                });
              }}
            >
              + Host a private table
            </button>
          </div>
        </div>

        <div className="lobby__foot">
          <p className="fineprint">
            Real-time seats, live chat, six-deck shoe with a cut card, late surrender and a basic-strategy coach.
            Chips are play money — nothing here is wagering, and nothing can be cashed out.
          </p>
          <button className="btn btn--primary enterbtn" onClick={go} disabled={!canEnter}>
            {canEnter ? `Enter ${room ? room.name : 'the floor'}` : status === 'connecting' ? 'Connecting…' : 'Pick a name'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export { fanCard };
