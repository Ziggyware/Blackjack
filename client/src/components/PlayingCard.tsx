import { useLayoutEffect, useRef } from 'react';
import type { CardView } from '@velvet/shared';
import { claimCard, shoeAnchor } from '../lib/anchor.js';
import { CardBack, CardFace } from './CardFace.js';

interface Props {
  card: CardView;
  index: number;
  /** animate the deal-in only if the card is genuinely fresh */
  animate?: boolean;
  holo?: boolean;
  scale?: number;
}

export function PlayingCard({ card, index, animate = true, holo = false, scale = 1 }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !animate) return;
    if (!claimCard(card.id)) return;
    const fresh = Date.now() - card.at < 4500;
    if (!fresh) return;
    const shoe = shoeAnchor.rect();
    const r = el.getBoundingClientRect();
    if (shoe) {
      const dx = shoe.left + shoe.width / 2 - (r.left + r.width / 2);
      const dy = shoe.top + shoe.height / 2 - (r.top + r.height / 2);
      el.style.setProperty('--dx', `${dx.toFixed(1)}px`);
      el.style.setProperty('--dy', `${dy.toFixed(1)}px`);
      el.style.setProperty('--dr', `${((index % 3) - 1) * 12 - 8}deg`);
    }
    el.style.setProperty('--delay', `${Math.min(index * 34, 220)}ms`);
    el.classList.add('is-dealing');
    const done = () => el.classList.remove('is-dealing');
    el.addEventListener('animationend', done, { once: true });
    return () => el.removeEventListener('animationend', done);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  return (
    <div
      ref={ref}
      className={`card${card.hidden ? ' is-hidden' : ''}${holo ? ' card--holo' : ''}`}
      style={{ ['--i' as string]: index, transform: scale === 1 ? undefined : `scale(${scale})` }}
      data-card={card.id}
    >
      <div className="card__tilt">
        <div className="card__inner">
          {card.hidden || !card.rank || !card.suit
            ? <CardBack />
            : <CardFace rank={card.rank} suit={card.suit} />}
        </div>
      </div>
    </div>
  );
}

export function CardRow({
  cards, holo, animate = true, scale = 1,
}: { cards: CardView[]; holo?: boolean; animate?: boolean; scale?: number }): JSX.Element {
  return (
    <div className="cardrow">
      {cards.map((c, i) => (
        <PlayingCard key={c.id} card={c} index={i} animate={animate} holo={holo} scale={scale} />
      ))}
    </div>
  );
}
