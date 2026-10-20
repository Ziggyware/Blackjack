import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { TableView } from '@velvet/shared';
import { fxBus } from '../fx/bus.js';
import { useStore } from '../state/store.js';

export function Toasts({ table }: { table: TableView | null }): JSX.Element {
  return (
    <div className="toasts">
      <AnimatePresence>
        {(table?.toasts ?? []).map((t) => (
          <motion.div
            key={t.id}
            className={`toast toast--${t.tone}`}
            initial={{ opacity: 0, y: -14, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 26 }}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

interface Floater { id: number; emoji: string; x: number; y: number; scale: number }
let floaterId = 0;

/** Emoji that rise out of the table when somebody reacts. */
export function Reactions(): JSX.Element {
  const [items, setItems] = useState<Floater[]>([]);

  useEffect(() => fxBus.on((fx) => {
    if (fx.kind !== 'reaction') return;
    floaterId += 1;
    const id = floaterId;
    const el = document.querySelector<HTMLElement>(`[data-person="${fx.fromId}"]`);
    let x = window.innerWidth * (0.28 + Math.random() * 0.44);
    let y = window.innerHeight * 0.62;
    if (el) {
      const r = el.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top;
    }
    setItems((prev) => [...prev.slice(-14), { id, emoji: fx.emoji, x, y, scale: 0.8 + Math.random() * 0.7 }]);
    setTimeout(() => setItems((prev) => prev.filter((p) => p.id !== id)), 2200);
  }), []);

  return (
    <>
      {items.map((f) => (
        <span key={f.id} className="reaction" style={{ left: f.x, top: f.y, transform: `scale(${f.scale})` }}>
          {f.emoji}
        </span>
      ))}
    </>
  );
}

export function ErrorBar(): JSX.Element | null {
  const error = useStore((s) => s.error);
  if (!error) return null;
  return <div className="errbar">{error}</div>;
}
