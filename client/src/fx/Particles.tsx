import { useEffect, useRef } from 'react';
import type { Fx } from '@velvet/shared';
import { fxBus } from './bus.js';

type Kind = 'chip' | 'spark' | 'shard' | 'ring' | 'confetti';

interface P {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number; color: string;
  kind: Kind; rot: number; vr: number; grav: number; drag: number;
}

const PALETTES: Record<string, string[]> = {
  win: ['#24e08b', '#cbff4d', '#f6d99a', '#ffffff'],
  blackjack: ['#f6d99a', '#ff3ea5', '#ffffff', '#22d3ee', '#cbff4d'],
  charlie: ['#cbff4d', '#22d3ee', '#ffffff', '#8b5cf6'],
  bust: ['#ff4d5e', '#ff8f9a', '#7a1524'],
  push: ['#9a93b5', '#cfc9e2'],
  chips: ['#f6d99a', '#ff3ea5', '#22d3ee', '#8b5cf6', '#24e08b'],
};

function seatPoint(seat?: number): { x: number; y: number } {
  const fallback = { x: window.innerWidth / 2, y: window.innerHeight * 0.45 };
  if (seat === undefined || seat === null) return fallback;
  const el = document.querySelector<HTMLElement>(`[data-seat="${seat}"]`);
  if (!el) return fallback;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height * 0.36 };
}

export function Particles(): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
    };
    resize();
    window.addEventListener('resize', resize);

    const parts: P[] = [];
    const MAX = 620;

    const spawn = (fx: Extract<Fx, { kind: 'burst' }>) => {
      const { x, y } = seatPoint(fx.seat);
      const pal = PALETTES[fx.tone] ?? ['#24e08b', '#f6d99a', '#ffffff'];
      const big = fx.tone === 'blackjack' || fx.tone === 'charlie';
      const n = big ? 74 : fx.tone === 'win' ? 40 : fx.tone === 'bust' ? 26 : 16;
      for (let i = 0; i < n && parts.length < MAX; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (big ? 3.4 : 2.2) * (0.35 + Math.random());
        const kind: Kind = fx.tone === 'bust'
          ? (Math.random() < 0.7 ? 'shard' : 'spark')
          : big
            ? (Math.random() < 0.55 ? 'confetti' : Math.random() < 0.5 ? 'chip' : 'spark')
            : (Math.random() < 0.4 ? 'chip' : 'spark');
        parts.push({
          x: x + (Math.random() - 0.5) * 26,
          y: y + (Math.random() - 0.5) * 18,
          vx: Math.cos(a) * sp * (0.6 + Math.random()),
          vy: Math.sin(a) * sp - (big ? 2.6 : 1.7) - Math.random() * 1.4,
          life: 0,
          max: 60 + Math.random() * (big ? 70 : 40),
          size: (kind === 'chip' ? 7 : kind === 'confetti' ? 5.5 : 3) * (0.6 + Math.random() * 0.9),
          color: pal[Math.floor(Math.random() * pal.length)]!,
          kind,
          rot: Math.random() * Math.PI * 2,
          vr: (Math.random() - 0.5) * 0.32,
          grav: kind === 'shard' ? 0.16 : 0.085,
          drag: 0.985,
        });
      }
      if (big || fx.tone === 'win') {
        parts.push({
          x, y, vx: 0, vy: 0, life: 0, max: 34, size: 12,
          color: pal[0]!, kind: 'ring', rot: 0, vr: 0, grav: 0, drag: 1,
        });
      }
    };

    const off = fxBus.on((fx) => { if (fx.kind === 'burst') spawn(fx); });

    let raf = 0;
    let running = true;
    const frame = () => {
      if (!running) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.globalCompositeOperation = 'lighter';

      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]!;
        p.life++;
        if (p.life > p.max) { parts.splice(i, 1); continue; }
        const t = p.life / p.max;
        const alpha = t < 0.12 ? t / 0.12 : 1 - Math.pow((t - 0.12) / 0.88, 1.6);

        if (p.kind === 'ring') {
          const r = p.size + t * 190;
          ctx.beginPath();
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = (1 - t) * 0.5;
          ctx.lineWidth = 2.5 * (1 - t) + 0.4;
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
          continue;
        }

        p.vy += p.grav;
        p.vx *= p.drag;
        p.vy *= p.drag;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;

        ctx.globalAlpha = Math.max(0, alpha);
        ctx.fillStyle = p.color;
        ctx.strokeStyle = p.color;

        if (p.kind === 'spark') {
          ctx.lineWidth = Math.max(0.7, p.size * 0.4);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 3.2, p.y - p.vy * 3.2);
          ctx.stroke();
        } else if (p.kind === 'chip') {
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.size, p.size * (0.42 + 0.5 * Math.abs(Math.cos(p.rot))), p.rot, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = Math.max(0, alpha) * 0.5;
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.size * 0.42, p.size * 0.2, p.rot, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.kind === 'shard') {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.beginPath();
          ctx.moveTo(0, -p.size);
          ctx.lineTo(p.size * 0.7, p.size * 0.8);
          ctx.lineTo(-p.size * 0.7, p.size * 0.6);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        } else {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          const w = p.size * 1.5;
          const h = p.size * (0.5 + 0.6 * Math.abs(Math.sin(p.rot * 1.4)));
          ctx.fillRect(-w / 2, -h / 2, w, h);
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onVis = () => {
      if (document.hidden) { running = false; cancelAnimationFrame(raf); }
      else if (!running) { running = true; raf = requestAnimationFrame(frame); }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      off();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return <canvas ref={ref} className="particles" aria-hidden="true" />;
}
