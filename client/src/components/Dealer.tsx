import type { DealerView } from '@velvet/shared';
import { CardRow } from './PlayingCard.js';

export function Dealer({ dealer }: { dealer: DealerView }): JSX.Element {
  const shown = dealer.holeRevealed ? dealer.total : dealer.upTotal;
  const cls = dealer.bust ? 'is-bust' : dealer.blackjack ? 'is-bj' : shown?.soft ? 'is-soft' : '';
  const label = !shown
    ? '—'
    : dealer.blackjack
      ? 'BLACKJACK'
      : dealer.bust
        ? `BUST ${shown.best}`
        : shown.soft && shown.best !== 21
          ? `${shown.best - 10}/${shown.best}`
          : String(shown.best);

  return (
    <div className="dealer">
      <div className="dealer__label">Dealer</div>
      <CardRow cards={dealer.cards} holo={dealer.blackjack} />
      {dealer.cards.length > 0 && <div className={`dealer__total ${cls}`}>{label}</div>}
    </div>
  );
}

export function Shoe({ shuffling, remaining, total }: { shuffling: boolean; remaining: number; total: number }): JSX.Element {
  return (
    <div className={`shoebox${shuffling ? ' is-shuffling' : ''}`} title={`${remaining} of ${total} cards left in the shoe`}>
      <div className="shoebox__body" />
      <div className="shoebox__cards" style={{ opacity: 0.35 + 0.65 * (remaining / Math.max(1, total)) }} />
      <div className="shoebox__lip" />
    </div>
  );
}

export function Tray({ discarded }: { discarded: number }): JSX.Element {
  return (
    <div className="tray" title={`${discarded} cards discarded`}>
      <div className="tray__stack" style={{ opacity: discarded > 0 ? 0.9 : 0.2 }} />
    </div>
  );
}
