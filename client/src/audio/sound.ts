import type { SoundName } from '@velvet/shared';

type Ctx = AudioContext;

/**
 * Every sound in VELVET is synthesised at runtime — no sample packs, no
 * licensing, no loading. Short noise transients for cards and chips, FM-ish
 * bells for wins, a riffle sweep for the shuffle.
 */
class SoundEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;
  private lastAt = new Map<SoundName, number>();

  get ready(): boolean { return this.ctx !== null; }

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      // gentle bus compression so stacked chips never clip
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 22;
      comp.ratio.value = 5;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.7);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buf;
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.02);
    }
  }

  private t(): number { return this.ctx ? this.ctx.currentTime : 0; }

  private tone(opts: {
    freq: number; to?: number; dur: number; type?: OscillatorType; gain?: number;
    delay?: number; detune?: number; lp?: number;
  }): void {
    if (!this.ctx || !this.master) return;
    const start = this.t() + (opts.delay ?? 0);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, start);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), start + opts.dur);
    if (opts.detune) osc.detune.setValueAtTime(opts.detune, start);
    const peak = opts.gain ?? 0.2;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.02, opts.dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, start + opts.dur);
    let node: AudioNode = osc;
    if (opts.lp) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.lp;
      osc.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(this.master);
    osc.start(start);
    osc.stop(start + opts.dur + 0.05);
  }

  private hiss(opts: {
    dur: number; gain?: number; freq: number; q?: number; delay?: number;
    sweepTo?: number; type?: BiquadFilterType;
  }): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const start = this.t() + (opts.delay ?? 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 1;
    const f = this.ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq, start);
    if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, opts.sweepTo), start + opts.dur);
    f.Q.value = opts.q ?? 1.2;
    const g = this.ctx.createGain();
    const peak = opts.gain ?? 0.16;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, start + opts.dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(start);
    src.stop(start + opts.dur + 0.05);
  }

  play(name: SoundName, gain = 1): void {
    if (this.muted || !this.ctx) return;
    // never machine-gun the same cue
    const now = performance.now();
    const prev = this.lastAt.get(name) ?? 0;
    if (now - prev < 45 && name !== 'tick') return;
    this.lastAt.set(name, now);
    const g = (v: number) => v * gain;

    switch (name) {
      case 'deal':
        this.hiss({ dur: 0.09, freq: 2600, q: 0.9, gain: g(0.2) });
        this.hiss({ dur: 0.05, freq: 620, q: 0.7, gain: g(0.1), delay: 0.01 });
        this.tone({ freq: 190, to: 120, dur: 0.07, type: 'triangle', gain: g(0.09) });
        break;
      case 'flip':
        this.hiss({ dur: 0.16, freq: 900, sweepTo: 3200, q: 1.4, gain: g(0.14) });
        this.tone({ freq: 520, to: 780, dur: 0.1, type: 'sine', gain: g(0.05) });
        break;
      case 'chip':
        this.tone({ freq: 1750, dur: 0.07, type: 'square', gain: g(0.05), lp: 5200 });
        this.tone({ freq: 2600, dur: 0.05, type: 'triangle', gain: g(0.06), delay: 0.015 });
        this.hiss({ dur: 0.05, freq: 4200, q: 2, gain: g(0.09) });
        this.tone({ freq: 210, dur: 0.09, type: 'sine', gain: g(0.1) });
        break;
      case 'chipSoft':
        this.tone({ freq: 1500, dur: 0.05, type: 'triangle', gain: g(0.045), lp: 4000 });
        this.hiss({ dur: 0.04, freq: 3600, q: 2, gain: g(0.06) });
        break;
      case 'win':
        [0, 0.07, 0.14].forEach((d, i) => this.tone({ freq: 660 * Math.pow(1.26, i), dur: 0.34, type: 'triangle', gain: g(0.11), delay: d }));
        this.tone({ freq: 1320, dur: 0.5, type: 'sine', gain: g(0.06), delay: 0.14 });
        break;
      case 'blackjack':
        [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
          this.tone({ freq: f, dur: 0.9, type: 'triangle', gain: g(0.1), delay: i * 0.055 });
          this.tone({ freq: f * 2, dur: 0.5, type: 'sine', gain: g(0.035), delay: i * 0.055 + 0.01 });
        });
        this.hiss({ dur: 0.7, freq: 1800, sweepTo: 7000, q: 0.8, gain: g(0.06), delay: 0.05 });
        break;
      case 'charlie':
        [784, 988, 1175, 1568].forEach((f, i) => this.tone({ freq: f, dur: 0.5, type: 'sine', gain: g(0.09), delay: i * 0.06 }));
        break;
      case 'bust':
        this.tone({ freq: 220, to: 60, dur: 0.42, type: 'sawtooth', gain: g(0.11), lp: 900 });
        this.hiss({ dur: 0.24, freq: 420, sweepTo: 140, q: 0.7, gain: g(0.13) });
        break;
      case 'push':
        this.tone({ freq: 440, dur: 0.16, type: 'sine', gain: g(0.07) });
        this.tone({ freq: 415, dur: 0.2, type: 'sine', gain: g(0.05), delay: 0.09 });
        break;
      case 'shuffle':
        for (let i = 0; i < 7; i++) {
          this.hiss({ dur: 0.16, freq: 1400 + i * 260, sweepTo: 700, q: 0.8, gain: g(0.075), delay: i * 0.11 });
        }
        break;
      case 'turn':
        this.tone({ freq: 880, to: 1320, dur: 0.11, type: 'sine', gain: g(0.07) });
        break;
      case 'tick':
        this.tone({ freq: 1200, dur: 0.035, type: 'square', gain: g(0.03), lp: 3000 });
        break;
      case 'chat':
        this.tone({ freq: 620, to: 900, dur: 0.07, type: 'sine', gain: g(0.05) });
        break;
      case 'join':
        this.tone({ freq: 392, dur: 0.12, type: 'triangle', gain: g(0.08) });
        this.tone({ freq: 587, dur: 0.22, type: 'triangle', gain: g(0.07), delay: 0.09 });
        break;
      case 'split':
        this.hiss({ dur: 0.1, freq: 2200, q: 1, gain: g(0.16) });
        this.hiss({ dur: 0.1, freq: 3000, q: 1, gain: g(0.14), delay: 0.1 });
        break;
      case 'click':
        this.tone({ freq: 1000, dur: 0.035, type: 'triangle', gain: g(0.05), lp: 4000 });
        break;
      case 'deny':
        this.tone({ freq: 160, to: 110, dur: 0.18, type: 'square', gain: g(0.07), lp: 700 });
        break;
    }
  }
}

export const sound = new SoundEngine();
