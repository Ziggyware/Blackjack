export type BotStyle = 'shark' | 'tourist' | 'maniac' | 'ice' | 'counter';

export interface BotProfile {
  name: string;
  hue: number;
  style: BotStyle;
  /** multiple of the table minimum */
  baseBet: number;
  /** 0..1 randomness of the wager */
  variance: number;
  /** 0..1 — how reliably they follow the chart */
  discipline: number;
  chips: number;
  winningsPress: number;
  lossChase: number;
}

/**
 * House personalities. They fill seats so the table is never dead, play real
 * basic strategy (with human-ish deviation), and pressure or chase their bets.
 */
export const BOT_PROFILES: BotProfile[] = [
  { name: 'Nyx',     hue: 288, style: 'ice',     baseBet: 4,  variance: 0.35, discipline: 0.96, chips: 18000, winningsPress: 1.25, lossChase: 0.85 },
  { name: 'Vesper',  hue: 330, style: 'shark',   baseBet: 6,  variance: 0.45, discipline: 0.9,  chips: 24000, winningsPress: 1.5,  lossChase: 1.15 },
  { name: 'Kade',    hue: 18,  style: 'maniac',  baseBet: 8,  variance: 0.8,  discipline: 0.55, chips: 12000, winningsPress: 1.9,  lossChase: 1.6 },
  { name: 'Onyx',    hue: 210, style: 'counter', baseBet: 3,  variance: 0.25, discipline: 0.99, chips: 32000, winningsPress: 1.8,  lossChase: 0.6 },
  { name: 'Zephyr',  hue: 160, style: 'tourist', baseBet: 2,  variance: 0.6,  discipline: 0.62, chips: 6000,  winningsPress: 1.1,  lossChase: 1.3 },
  { name: 'Lux',     hue: 48,  style: 'shark',   baseBet: 5,  variance: 0.5,  discipline: 0.88, chips: 15000, winningsPress: 1.4,  lossChase: 1.1 },
  { name: 'Rook',    hue: 260, style: 'ice',     baseBet: 3,  variance: 0.3,  discipline: 0.94, chips: 20000, winningsPress: 1.2,  lossChase: 0.9 },
  { name: 'Sable',   hue: 0,   style: 'maniac',  baseBet: 6,  variance: 0.9,  discipline: 0.5,  chips: 9000,  winningsPress: 2.0,  lossChase: 1.8 },
  { name: 'Vega',    hue: 190, style: 'counter', baseBet: 4,  variance: 0.2,  discipline: 0.98, chips: 28000, winningsPress: 1.7,  lossChase: 0.5 },
  { name: 'Iris',    hue: 305, style: 'tourist', baseBet: 2,  variance: 0.7,  discipline: 0.68, chips: 5000,  winningsPress: 1.15, lossChase: 1.2 },
];

export const STYLE_LABEL: Record<BotStyle, string> = {
  shark: 'Shark',
  tourist: 'Tourist',
  maniac: 'Maniac',
  ice: 'Ice',
  counter: 'Counter',
};
