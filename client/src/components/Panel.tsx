import { useEffect, useRef, useState } from 'react';
import type { TableView } from '@velvet/shared';
import { useStore } from '../state/store.js';
import type { PanelTab } from '../state/store.js';
import { Avatar } from './Avatar.js';
import { compact, money, signed, winRate } from '../lib/format.js';

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'table', label: 'Table' },
  { id: 'history', label: 'Hands' },
  { id: 'ranks', label: 'Ranks' },
  { id: 'rules', label: 'Rules' },
];

const QUICK = ['🔥', '💀', '🎉', '😎', '🃏', '💸'];

function Chat({ table, you }: { table: TableView; you: string | null }): JSX.Element {
  const send = useStore((s) => s.send);
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [table.messages.length]);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    send({ type: 'chat', text: t });
    setText('');
  };

  return (
    <>
      <div className="chat">
        {table.messages.length === 0 && (
          <p className="fineprint" style={{ padding: 8 }}>
            The table is quiet. Say something — the house players talk back.
          </p>
        )}
        {table.messages.map((m) => {
          const system = m.kind === 'system' || m.kind === 'deal';
          return (
            <div key={m.id} className={`msg${system ? ` msg--system ${m.tone ?? ''}` : ''}`} style={{ ['--ph' as string]: m.hue }}>
              {!system && (
                <span className="msg__av" style={{ width: 22, height: 22, fontSize: 9 }}>
                  {m.from.slice(0, 2).toUpperCase()}
                </span>
              )}
              <div className="msg__b">
                {!system && (
                  <div className="msg__h">
                    <span className="msg__n" style={m.fromId === you ? { color: 'var(--accent)' } : undefined}>{m.from}</span>
                    <span className="msg__t">{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                )}
                <div className="msg__x">{m.text}</div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <div className="composer" style={{ margin: '10px -10px -10px', position: 'sticky', bottom: 0, background: 'linear-gradient(0deg, rgba(8,6,15,.96) 70%, transparent)' }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); e.stopPropagation(); }}
          placeholder="Say something…"
          maxLength={200}
          aria-label="Chat message"
        />
        <div className="quick">
          {QUICK.map((q) => (
            <button key={q} onClick={() => send({ type: 'reaction', emoji: q })} title={`React ${q}`}>{q}</button>
          ))}
        </div>
      </div>
    </>
  );
}

function History({ table }: { table: TableView }): JSX.Element {
  if (table.history.length === 0) {
    return <p className="fineprint" style={{ padding: 8 }}>No settled rounds yet. The shoe is young.</p>;
  }
  return (
    <div>
      {table.history.map((h) => {
        const pot = h.hands.reduce((a, x) => a + x.net, 0);
        return (
          <div key={h.round} style={{ marginBottom: 12 }}>
            <div className="sect__h">
              <span className="eyebrow">Round {h.round}</span>
              <span className="hrow__cards" style={{ fontSize: 10 }}>dealer {h.dealer.join(' ')} · {h.dealerTotal}</span>
              <span className={`hrow__net ${pot > 0 ? 'pos' : pot < 0 ? 'neg' : 'zero'}`} style={{ marginLeft: 'auto', fontSize: 10.5 }}>
                {signed(-pot)} house
              </span>
            </div>
            {h.hands.filter((x) => x.cards.length > 0 || x.result === 'insurance').map((x, i) => (
              <div className="hrow" key={i} style={{ ['--ph' as string]: x.hue } as React.CSSProperties}>
                <span className="hrow__r">
                  <span style={{ color: `hsl(${x.hue} 85% 70%)` }}>{x.name.slice(0, 3)}</span>
                </span>
                <span className="hrow__cards">
                  {x.cards.length ? x.cards.join(' ') : 'insurance'}
                  <span style={{ color: 'var(--ink-3)' }}> · {compact(x.bet)}</span>
                </span>
                <span className={`hrow__net ${x.net > 0 ? 'pos' : x.net < 0 ? 'neg' : 'zero'}`}>{signed(x.net)}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Ranks({ table, you }: { table: TableView; you: string | null }): JSX.Element {
  const me = table.seats.flatMap((s) => (s.occupant ? [s.occupant] : [])).find((o) => o.id === you)
    ?? table.spectators.find((s) => s.id === you);
  const myStats = table.seats.flatMap((s) => (s.occupant ? [s.occupant] : [])).find((o) => o.id === you)?.stats;
  return (
    <div>
      <div className="sect">
        <div className="sect__h"><span className="eyebrow">Leaderboard · net</span></div>
        {table.leaderboard.length === 0 && <p className="fineprint">No results yet.</p>}
        {table.leaderboard.map((r, i) => (
          <div className={`lrow${r.id === you ? ' is-you' : ''}`} key={r.id} style={{ ['--ph' as string]: r.hue } as React.CSSProperties}>
            <span className="lrow__p">{i + 1}</span>
            <Avatar name={r.name} hue={r.hue} size={24} bot={r.bot} />
            <span className="lrow__n">{r.name}{r.bot && <span className="bot" style={{ marginLeft: 5 }}>AI</span>}</span>
            <span className={`lrow__v ${r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''}`}
              style={{ color: r.net > 0 ? 'var(--good)' : r.net < 0 ? '#ff8f9a' : 'var(--ink-3)' }}>
              {signed(r.net)}
            </span>
          </div>
        ))}
      </div>

      <div className="sect">
        <div className="sect__h"><span className="eyebrow">Your record{me ? ` · ${me.name}` : ''}</span></div>
        {myStats ? (
          <>
            <div className="kv"><span>Rounds</span><b>{myStats.rounds}</b></div>
            <div className="kv"><span>Hands</span><b>{myStats.hands}</b></div>
            <div className="kv"><span>Win rate</span><b style={{ color: 'var(--good)' }}>{winRate(myStats)}</b></div>
            <div className="kv"><span>Blackjacks</span><b style={{ color: 'var(--gold)' }}>{myStats.blackjacks}</b></div>
            <div className="kv"><span>Busts</span><b style={{ color: '#ff8f9a' }}>{myStats.busts}</b></div>
            <div className="kv"><span>Pushes</span><b>{myStats.pushes}</b></div>
            <div className="kv"><span>Biggest win</span><b style={{ color: 'var(--gold)' }}>{money(myStats.biggestWin)}</b></div>
            <div className="kv"><span>Wagered</span><b>{money(myStats.wagered)}</b></div>
            <div className="kv"><span>Net</span><b style={{ color: myStats.net >= 0 ? 'var(--good)' : '#ff8f9a' }}>{signed(myStats.net)}</b></div>
            <div className="kv"><span>Streak</span><b>{myStats.streak > 0 ? `${myStats.streak}W` : myStats.streak < 0 ? `${-myStats.streak}L` : '—'}</b></div>
            <div className="kv"><span>Best streak</span><b>{myStats.bestStreak}W</b></div>
          </>
        ) : (
          <p className="fineprint">Take a seat and the numbers start moving.</p>
        )}
      </div>

      {table.hottest && (
        <div className="sect">
          <div className="sect__h"><span className="eyebrow">On fire</span></div>
          <div className="lrow" style={{ ['--ph' as string]: table.hottest.hue } as React.CSSProperties}>
            <span className="lrow__p">🔥</span>
            <Avatar name={table.hottest.name} hue={table.hottest.hue} size={24} />
            <span className="lrow__n">{table.hottest.name}</span>
            <span className="lrow__v" style={{ color: 'var(--gold)' }}>{table.hottest.streak}W</span>
          </div>
        </div>
      )}

      <div className="sect">
        <div className="sect__h"><span className="eyebrow">At the table</span></div>
        <div className="kv"><span>Seated</span><b>{table.seats.filter((s) => s.occupant).length}/{table.seats.length}</b></div>
        <div className="kv"><span>Spectating</span><b>{table.spectators.length}</b></div>
        <div className="kv"><span>House take</span><b style={{ color: table.houseNet >= 0 ? 'var(--gold)' : 'var(--good)' }}>{signed(table.houseNet)}</b></div>
        <div className="kv"><span>Last round</span><b style={{ color: table.tableNet >= 0 ? 'var(--good)' : '#ff8f9a' }}>{signed(table.tableNet)}</b></div>
      </div>
    </div>
  );
}

function RulesPanel({ table }: { table: TableView }): JSX.Element {
  const r = table.rules;
  const lines = [
    `${r.decks}-deck shoe, continuous shuffle at ${Math.round(r.penetration * 100)}% penetration`,
    `Blackjack pays ${r.blackjackPays === 1.5 ? '3 to 2' : `${Math.round(r.blackjackPays * 100)} to 100`}`,
    `Dealer ${r.dealerStandsSoft17 ? 'stands on all 17s' : 'hits soft 17, stands on hard 17'}`,
    r.doubleAnyTwo ? 'Double down on any two cards' : 'Double down on 9, 10 and 11 only',
    r.doubleAfterSplit ? 'Doubling after a split is allowed' : 'No doubling after a split',
    `Split up to ${r.maxSplits + 1} hands${r.splitAcesOneCard ? ' — split aces receive one card each' : ''}`,
    r.surrender === 'late' ? 'Late surrender: fold for half your bet before acting' : 'Surrender is not offered',
    r.fiveCardCharlie ? 'Five card Charlie: five cards without busting wins automatically' : 'No five card Charlie',
    `Insurance pays ${r.insurancePays} to 1 (the chart says never take it)`,
    `Table limits ${money(r.minBet)} – ${money(r.maxBet)}`,
    `${r.betSeconds}s to bet, ${r.turnSeconds}s per decision — the table auto-stands if you stall`,
    'Play money only. Chips have no value and cannot be cashed out.',
  ];
  return (
    <div className="sect">
      <div className="sect__h"><span className="eyebrow">{table.name} house rules</span></div>
      <ul className="rulelist" style={{ padding: 0, margin: 0 }}>
        {lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
      <div style={{ marginTop: 18 }}>
        <div className="sect__h"><span className="eyebrow">Keyboard</span></div>
        <ul className="rulelist" style={{ padding: 0, margin: 0 }}>
          <li><b>H</b> hit · <b>S</b> stand · <b>D</b> double · <b>P</b> split · <b>R</b> fold</li>
          <li><b>1–6</b> drop a chip · <b>C</b> clear bet · <b>B</b> rebet last</li>
          <li><b>Y / N</b> take or decline insurance · <b>M</b> mute · <b>Tab</b> panel</li>
        </ul>
      </div>
    </div>
  );
}

export function Panel({ table, you }: { table: TableView; you: string | null }): JSX.Element {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const open = useStore((s) => s.panelOpen);
  return (
    <aside className={`panel${open ? '' : ' is-closed'}`} aria-hidden={!open}>
      <div className="panel__tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab${tab === t.id ? ' is-on' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="panel__body scroll">
        {tab === 'table' && <Chat table={table} you={you} />}
        {tab === 'history' && <History table={table} />}
        {tab === 'ranks' && <Ranks table={table} you={you} />}
        {tab === 'rules' && <RulesPanel table={table} />}
      </div>
    </aside>
  );
}
