let shoeEl: HTMLElement | null = null;

/** Where cards physically fly from. The felt registers the shoe element here. */
export const shoeAnchor = {
  set(el: HTMLElement | null): void { shoeEl = el; },
  rect(): DOMRect | null {
    try { return shoeEl?.getBoundingClientRect() ?? null; } catch { return null; }
  },
};

const seen = new Set<string>();

/**
 * True exactly once per card id — so a re-render never replays the deal
 * animation, but a genuinely new card always does.
 */
export function claimCard(id: string): boolean {
  if (seen.size > 4000) seen.clear();
  if (seen.has(id)) return false;
  seen.add(id);
  return true;
}
