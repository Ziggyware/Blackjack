import type { Fx } from '@velvet/shared';

type Listener = (fx: Fx) => void;

const listeners = new Set<Listener>();

/** Tiny pub/sub so sound, particles and reactions can all react to one stream. */
export const fxBus = {
  emit(fx: Fx) {
    for (const l of listeners) {
      try { l(fx); } catch { /* a broken listener must never break the table */ }
    }
  },
  on(listener: Listener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};
