import { useEffect, useRef } from 'react';

const VERT = `attribute vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uAccent;
uniform vec3 uAccent2;
uniform vec2 uMouse;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for(int i = 0; i < 5; i++){ v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return v;
}

void main(){
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes.xy) / max(uRes.y, 1.0);
  float t = uTime * 0.05;

  vec2 q = vec2(fbm(p * 1.5 + t), fbm(p * 1.5 - t + 5.2));
  vec2 r = vec2(fbm(p * 2.1 + q * 1.5 + vec2(1.7, 9.2) + t * 1.3),
                fbm(p * 2.1 + q * 1.4 + vec2(8.3, 2.8) - t * 1.1));
  float f = fbm(p * 1.8 + r * 1.7);

  vec3 col = mix(vec3(0.014, 0.012, 0.032), uAccent * 0.5, clamp(f * f * 2.4, 0.0, 1.0));
  col = mix(col, uAccent2 * 0.46, clamp(length(q) * 0.52, 0.0, 1.0));
  col += vec3(0.85, 0.88, 1.0) * pow(clamp(r.x * 0.52, 0.0, 1.0), 7.0) * 0.12;

  // pointer spotlight — the room reacts to you
  float d = length(p - uMouse);
  col += uAccent * 0.12 * exp(-d * 2.6);

  // horizon bloom behind the table
  float band = exp(-pow((p.y + 0.12) * 2.4, 2.0));
  col += mix(uAccent, uAccent2, 0.5) * band * 0.07;

  col *= 1.0 - 0.62 * dot(p, p * 0.8);
  col = pow(max(col, 0.0), vec3(0.94));
  gl_FragColor = vec4(col, 1.0);
}`;

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(Math.min(k - 3, 9 - k), 1));
  };
  return [f(0), f(8), f(4)];
}

/**
 * Domain-warped fbm plasma, rendered at reduced resolution and scaled up —
 * it reads as a soft aurora while costing almost nothing per frame.
 */
export function ShaderBackground({ accentHue }: { accentHue: number }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const hueRef = useRef(accentHue);
  hueRef.current = accentHue;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' })
      ?? canvas.getContext('experimental-webgl') as WebGLRenderingContext | null;
    if (!gl) { canvas.classList.add('is-nogl'); return; }

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn('shader', gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { canvas.classList.add('is-nogl'); return; }
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.classList.add('is-nogl'); return; }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'uRes');
    const uTime = gl.getUniformLocation(prog, 'uTime');
    const uAccent = gl.getUniformLocation(prog, 'uAccent');
    const uAccent2 = gl.getUniformLocation(prog, 'uAccent2');
    const uMouse = gl.getUniformLocation(prog, 'uMouse');

    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e: PointerEvent) => {
      mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.ty = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    const SCALE = 0.42;
    const resize = () => {
      const w = Math.max(320, Math.floor(window.innerWidth * SCALE));
      const h = Math.max(240, Math.floor(window.innerHeight * SCALE));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    resize();
    window.addEventListener('resize', resize);

    let raf = 0;
    let running = true;
    const t0 = performance.now();
    const frame = () => {
      if (!running) return;
      resize();
      mouse.x += (mouse.tx - mouse.x) * 0.045;
      mouse.y += (mouse.ty - mouse.y) * 0.045;
      const [r1, g1, b1] = hslToRgb(hueRef.current, 0.95, 0.6);
      const [r2, g2, b2] = hslToRgb((hueRef.current + 52) % 360, 0.9, 0.58);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (performance.now() - t0) / 1000);
      gl.uniform3f(uAccent, r1, g1, b1);
      gl.uniform3f(uAccent2, r2, g2, b2);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
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
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVis);
      gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs); gl.deleteBuffer(buf);
    };
  }, []);

  return <canvas ref={ref} className="shaderbg" aria-hidden="true" />;
}
