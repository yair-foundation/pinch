import { useEffect, useRef } from 'react';
import {
  cardPoint,
  coverScale,
  frontAngle,
  introAngle,
  introTurn,
  introVelocity,
  lens,
  type Mat4,
  modelMatrix,
  multiply,
  perspective,
  pictureFor,
  pose,
  RING_DEFAULTS,
  type RingOptions,
  ringGeometry,
  translate,
} from '@/lib/pin/ring-motion';
import { cn } from '@/lib/utils';

/*
 * The landing's ring of pictures (D133), after a reference clip: it grows out of a speck while
 * spinning hard with motion blur, settles on the first picture, then drifts, and can be dragged
 * and flicked. WebGL2, drawn on a transparent canvas over whatever is behind it. The geometry and
 * timing are pure, in `src/lib/pin/ring-motion.ts`.
 */

/** What a demo can do with the ring (D135): hold a card in front, turn it, and find places on it. */
export type RingControl = {
  /** Stops the drift and settles the nearest card in front; again, re-settles on the nearest. */
  hold(): void;
  /** Turns the held ring this many cards from the one it settled on; negative turns left. */
  turn(cards: number): void;
  /** Lets it drift again. */
  release(): void;
  /**
   * Where a point of a card lies on the canvas, in CSS pixels: `u` across and `v` down, 0 to 1,
   * on the card held in front, or `cards` along from it. Null before the first frame.
   */
  point(u: number, v: number, cards?: number): [number, number] | null;
  /** The canvas's size in CSS pixels. */
  size(): [number, number];
  /** Which picture (its place in the list) is on the card held in front, or `cards` along. */
  picture(cards?: number): number;
  /** Calls `fn` after each frame is drawn, with the seconds since the ring started. */
  subscribe(fn: (t: number) => void): () => void;
  /** When the visitor last touched the ring, in the same seconds as `subscribe`; null if never. */
  touchedAt(): number | null;
  /** Whether the visitor is holding the ring now. */
  dragging(): boolean;
};

/** Decorative: the pictures say nothing the page needs, so the ring is hidden from readers. */
export function RingGallery({
  pictures,
  className,
  options,
  onStart,
  onControl,
}: {
  pictures: string[];
  className?: string;
  options?: Partial<RingOptions>;
  /** When the ring starts to spin in: its pictures are in (or it can't draw at all). */
  onStart?: () => void;
  /** The ring's controls once it can draw, and null when it goes. */
  onControl?: (control: RingControl | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const started = useRef(onStart);
  started.current = onStart;
  const controlled = useRef(onControl);
  controlled.current = onControl;
  // The ring is built once; a new list of the same pictures doesn't restart it.
  const key = pictures.join('\n');
  // biome-ignore lint/correctness/useExhaustiveDependencies: the ring follows the pictures' URLs, not the array
  useEffect(() => {
    if (!canvas.current) return;
    const ring = startRing(canvas.current, pictures, { ...RING_DEFAULTS, ...options }, () =>
      started.current?.(),
    );
    controlled.current?.(ring.control);
    return () => {
      controlled.current?.(null);
      ring.stop();
    };
  }, [key]);
  return (
    <canvas
      ref={canvas}
      aria-hidden
      className={cn('block touch-pan-y cursor-grab active:cursor-grabbing', className)}
    />
  );
}

const VERT = `#version 300 es
in vec2 aUV;
uniform mat4 uProj, uView, uModel;
uniform float uAngle, uArc, uRadius;
uniform vec3 uCamera;
out vec2 vUV;
out float vFacing;
void main() {
  float a = uAngle + (aUV.x - 0.5) * uArc;
  vec4 world = uModel * vec4(sin(a) * uRadius, aUV.y - 0.5, cos(a) * uRadius, 1.0);
  vec3 normal = normalize(mat3(uModel) * vec3(sin(a), 0.0, cos(a)));
  vFacing = dot(normal, normalize(uCamera - world.xyz));
  vUV = aUV;
  gl_Position = uProj * uView * world;
}`;

// Cards turning away darken; the weight shares each frame between the blur's copies.
const FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
in float vFacing;
uniform sampler2D uTex;
uniform vec2 uCover;
uniform float uLoaded, uWeight, uAspect, uCorner;
out vec4 outColor;
void main() {
  vec4 c = uLoaded > 0.5 ? texture(uTex, (vUV - 0.5) * uCover + 0.5) : vec4(vec3(0.16), 1.0);
  float shade = mix(0.28, 1.0, smoothstep(0.0, 0.75, vFacing));
  // Rounded corners: the distance to a rounded rectangle as wide as the card is, one tall.
  vec2 extent = vec2(uAspect, 1.0) * 0.5;
  vec2 p = (vUV - 0.5) * vec2(uAspect, 1.0);
  float d = length(max(abs(p) - extent + uCorner, 0.0)) - uCorner;
  float edge = 1.0 - smoothstep(-fwidth(d), fwidth(d), d);
  outColor = vec4(c.rgb * shade, c.a) * (uWeight * edge);
}`;

/** Columns across a card, enough for its curve to look round. */
const SEGMENTS = 40;
const MAX_SAMPLES = 32;
const MAX_PIXEL_RATIO = 2;
const MAX_PICTURE = 1600;

type Slide = { texture: WebGLTexture; aspect: number };

/** Draws the ring on the canvas until `stop`; `control` is null without WebGL2. */
function startRing(
  canvas: HTMLCanvasElement,
  pictures: string[],
  o: RingOptions,
  onStart: () => void,
): { control: RingControl | null; stop: () => void } {
  const context = canvas.getContext('webgl2', {
    antialias: true,
    premultipliedAlpha: true,
    alpha: true,
  });
  // Without WebGL2 the ring just isn't there; the landing reads the same.
  if (!context) {
    onStart();
    return { control: null, stop: () => {} };
  }
  const gl: WebGL2RenderingContext = context;

  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const program = link(gl, VERT, FRAG);
  const u = Object.fromEntries(
    [
      'uProj',
      'uView',
      'uModel',
      'uAngle',
      'uArc',
      'uRadius',
      'uCamera',
      'uTex',
      'uCover',
      'uAspect',
      'uCorner',
      'uLoaded',
      'uWeight',
    ].map((n) => [n, gl.getUniformLocation(program, n)]),
  );

  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, cardMesh(), gl.STATIC_DRAW);
  const aUV = gl.getAttribLocation(program, 'aUV');
  gl.enableVertexAttribArray(aUV);
  gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 0, 0);

  let slides: Slide[] = [];
  let g = ringGeometry(pictures.length, o);
  // Nothing shows until the pictures are in, so the intro never spins grey cards.
  let ready = false;
  let stopped = false;
  let mode: 'intro' | 'live' = still ? 'live' : 'intro';
  let start = 0;
  let last = performance.now();
  let angle = 0;
  let velocity = 0;
  let direction = Math.sign(o.autoSpeed) || -1;
  let drag: { x: number; time: number } | null = null;
  let visible = true;
  let frame = 0;
  // A demo's hold: the angle with a card in front it settled on, and how far it's turned from it.
  let held: { base: number; turn: number } | null = null;
  let touchedAt: number | null = null;
  const touch = () => {
    touchedAt = (performance.now() - start) / 1000;
  };
  const listeners = new Set<(t: number) => void>();
  // The last frame's whole projection and size, for `point`.
  let seen: { m: Mat4; w: number; h: number } | null = null;

  const drift = () => (still ? 0 : Math.abs(o.autoSpeed) * direction);
  const turn = () => introTurn(o, g, direction);

  Promise.all(pictures.map((src) => load(src).catch(() => null))).then((loaded) => {
    if (stopped) return;
    slides = loaded
      .filter((p) => p !== null)
      .map((p) => ({ texture: upload(gl, p), aspect: p.width / p.height }));
    g = ringGeometry(slides.length, o);
    ready = true;
    start = last = performance.now();
    onStart();
    if (!still) velocity = introVelocity(0, turn(), drift(), o.introDuration);
  });

  function draw(now: number) {
    frame = requestAnimationFrame(draw);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (ready && visible) render((now - start) / 1000, dt);
  }

  function render(t: number, dt: number) {
    if (mode === 'intro') {
      angle = introAngle(t, turn(), drift(), o.introDuration);
      velocity = introVelocity(t, turn(), drift(), o.introDuration);
      if (t >= o.introDuration) mode = 'live';
    } else if (held && !drag) {
      // Eased towards where the demo wants it, quickly, so a drag reads as a hand moving it.
      const target = held.base + held.turn * g.step;
      const next = angle + (target - angle) * (1 - Math.exp(-dt / 0.12));
      velocity = dt > 0 ? (next - angle) / dt : 0;
      angle = next;
    } else if (!drag) {
      velocity += (drift() - velocity) * (1 - Math.exp(-dt / 0.7));
      angle += velocity * dt;
    }

    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const w = Math.round(canvas.clientWidth * ratio);
    const h = Math.round(canvas.clientHeight * ratio);
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const aspect = w / h;
    const { distance, tanY } = lens(aspect, g.radius);

    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.enable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    const proj = perspective(tanY, aspect, 0.05, 50);
    const view = translate(0, 0, -distance);
    seen = {
      m: multiply(multiply(proj, view), modelMatrix(pose(t, o, still), g.radius)),
      w: canvas.clientWidth,
      h: canvas.clientHeight,
    };
    gl.uniformMatrix4fv(u.uProj, false, proj);
    gl.uniformMatrix4fv(u.uView, false, view);
    gl.uniform3f(u.uCamera, 0, 0, distance);
    gl.uniform1f(u.uRadius, g.radius);
    gl.uniform1f(u.uArc, g.arc);
    gl.uniform1f(u.uAspect, o.cardAspect);
    gl.uniform1f(u.uCorner, o.corner);
    gl.uniform1i(u.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);

    // Motion blur: the ring at several moments across the shutter, added up; one copy when slow.
    const samples = Math.max(
      1,
      Math.min(MAX_SAMPLES, Math.ceil((Math.abs(velocity) * o.shutter) / 0.006)),
    );
    for (let k = 0; k < samples; k++) {
      const back = samples === 1 ? 0 : (o.shutter * k) / (samples - 1);
      const a =
        mode === 'intro'
          ? introAngle(t - back, turn(), drift(), o.introDuration)
          : angle - velocity * back;
      gl.uniformMatrix4fv(u.uModel, false, modelMatrix(pose(t - back, o, still), g.radius));
      gl.uniform1f(u.uWeight, 1 / samples);
      for (let i = 0; i < g.count; i++) {
        const slide = slides[pictureFor(i, slides.length, g.count)];
        if (slide) {
          gl.bindTexture(gl.TEXTURE_2D, slide.texture);
          gl.uniform2f(u.uCover, ...coverScale(slide.aspect, o.cardAspect));
        }
        gl.uniform1f(u.uLoaded, slide ? 1 : 0);
        gl.uniform1f(u.uAngle, a + i * g.step);
        gl.drawArrays(gl.TRIANGLES, 0, SEGMENTS * 6);
      }
    }
    for (const fn of listeners) fn(t);
  }

  // Drag to spin; a flick carries on and eases back into the drift.
  const onDown = (e: PointerEvent) => {
    if (!ready) return;
    mode = 'live';
    touch();
    held = null;
    drag = { x: e.clientX, time: e.timeStamp };
    velocity = 0;
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    touch();
    const d = ((e.clientX - drag.x) / canvas.clientWidth) * Math.PI * 0.9;
    const dt = Math.max((e.timeStamp - drag.time) / 1000, 1 / 240);
    angle += d;
    velocity += (d / dt - velocity) * 0.6;
    drag = { x: e.clientX, time: e.timeStamp };
  };
  const onUp = (e: PointerEvent) => {
    if (!drag) return;
    touch();
    if (e.timeStamp - drag.time > 80) velocity = 0;
    if (Math.abs(velocity) > 0.05) direction = Math.sign(velocity);
    drag = null;
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  // Off screen, it stops drawing.
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
  });
  observer.observe(canvas);
  frame = requestAnimationFrame(draw);

  const control: RingControl = {
    hold() {
      if (drag) return;
      mode = 'live';
      held = { base: frontAngle(angle, g), turn: 0 };
    },
    turn(cards) {
      if (held) held.turn = cards;
    },
    release() {
      held = null;
    },
    point(u, v, cards = 0) {
      if (!seen) return null;
      const base = held?.base ?? frontAngle(angle, g);
      const [x, y] = cardPoint(seen.m, g, angle - base + cards * g.step, u, v);
      return [((x + 1) / 2) * seen.w, ((1 - y) / 2) * seen.h];
    },
    size: () => [canvas.clientWidth, canvas.clientHeight],
    picture(cards = 0) {
      // The card at angle 0 is the one whose own angle cancels the ring's.
      const base = held?.base ?? frontAngle(angle, g);
      const card = (((Math.round(-base / g.step) + cards) % g.count) + g.count) % g.count;
      return pictureFor(card, slides.length || pictures.length, g.count);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    touchedAt: () => touchedAt,
    dragging: () => drag !== null,
  };

  const stop = () => {
    stopped = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    // Freed one by one rather than losing the context: React's Strict Mode mounts twice, and the
    // canvas hands the same context back.
    for (const s of slides) gl.deleteTexture(s.texture);
    gl.deleteBuffer(buffer);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
    listeners.clear();
  };
  return { control, stop };
}

/** A card is a strip of quads, u from 0 to 1 across and v up, wound to face outwards. */
function cardMesh(): Float32Array {
  const out: number[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const a = i / SEGMENTS;
    const b = (i + 1) / SEGMENTS;
    out.push(a, 0, b, 0, b, 1, a, 0, b, 1, a, 1);
  }
  return new Float32Array(out);
}

/** A picture by URL, scaled down when it is larger than a card ever needs. */
async function load(src: string): Promise<HTMLImageElement | HTMLCanvasElement> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = src;
  await image.decode();
  const scale = Math.min(1, MAX_PICTURE / Math.max(image.naturalWidth, image.naturalHeight));
  if (scale === 1) return image;
  const c = document.createElement('canvas');
  c.width = Math.round(image.naturalWidth * scale);
  c.height = Math.round(image.naturalHeight * scale);
  c.getContext('2d')?.drawImage(image, 0, 0, c.width, c.height);
  return c;
}

function upload(gl: WebGL2RenderingContext, source: TexImageSource): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
  return texture;
}

function link(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vert],
    [gl.FRAGMENT_SHADER, frag],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Could not create a shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program) ?? 'program');
  return program;
}
