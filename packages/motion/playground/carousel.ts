import { Spring, Ticker, bindDrag, projectFling } from '@lama/motion';
import { Glass, type GlassPlane, type Media } from './glass';

/*
 * A draggable strip of cards that opens into a case study. One model drives
 * everything, every frame, and every animated number is a spring or a readout
 * of a spring:
 *
 *   offset        the strip's x. Drag sets its target, release hands over
 *                 velocity and snaps to a card; while a card is the ANCHOR
 *                 the target is that card's resting centre
 *   focus[i]      0..1 per card — grows it in place and pushes the others out
 *                 by half its extra width (symmetric, transform-only)
 *   view          0..1 — 0 is the strip, 1 is the case study. Every card has
 *                 a rect in BOTH layouts and shows mix(strip, case, view):
 *                   the hero's case rect is the big frame at the top,
 *                   the others' case rect is their slot in the bottom strip
 *                   (the hero's slot stays empty — that is where it came from),
 *                   the column planes' case rect is the column; in the strip
 *                   layout they sit a little lower, invisible
 *   tilt          degrees; target = readout of the strip's velocity
 *   scroll        the page's scroll, a spring too, so "back to top" is motion
 *                 the engine owns and the wheel can interrupt
 *
 * Nothing is tweened, nothing is cancelled. Click a bottom card while the
 * hero is still arriving, drag the strip mid-transition, flip HTML/WebGPU
 * mid-fling — the springs retarget and the layout above follows.
 */

const N = 10;              // cards in the strip
const COLUMN = 4;          // planes in the case study's column
const T = N + COLUMN;      // every plane the writers know about
const W = 320, H = 220, GAP = 24;
const RADIUS = 24, DEPTH = 20; // px at scale 1: corner radius, half thickness
const HERO_TOP = 96;       // doc px; clears the mode toggle
/* how much a card grows in place before the view carries it up */
const bigScale = () => Math.min(1.5, (innerWidth * 0.9) / W);

const ticker = new Ticker().start();
const stage = document.getElementById('stage')!;
const spacer = document.getElementById('spacer')!;

/* every other card is a short clip (playground/public/vid, same-origin and
   kept out of git); a clip that is not there falls back to a still, so the
   demo runs from a fresh clone */
const CLIPS = ['bunny', 'jellyfish', 'sintel', 'bunny720'];
const have = await Promise.all(CLIPS.map((c) => fetch(`/vid/${c}.mp4`, { method: 'HEAD' }).then((r) => r.ok, () => false)));
const SRCS = Array.from({ length: T }, (_, i) => {
  if (i >= N) return `https://picsum.photos/seed/column-${i - N}/1280/720`;
  const clip = i % 2 === 0 ? CLIPS[i / 2] : undefined;
  return clip && have[i / 2] ? `/vid/${clip}.mp4` : `https://picsum.photos/seed/carousel-${i}/960/660`;
});

const cards: HTMLElement[] = [];
/* the card's own <img> / <video>: the HTML writer shows it, the GL writer
   reads it (an upload for a still, a per-frame import for a clip) */
const media: Media[] = [];
for (let i = 0; i < T; i++) {
  const el = document.createElement('div');
  el.className = i < N ? 'card' : 'card plane';
  let m: Media;
  if (SRCS[i].endsWith('.mp4')) {
    const v = document.createElement('video');
    v.src = SRCS[i];
    v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true; v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    m = v;
  } else {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = SRCS[i];
    img.alt = '';
    img.draggable = false;
    m = img;
  }
  el.append(m);
  stage.append(el);
  cards.push(el);
  media.push(m);
}
/* muted autoplay is allowed, but be sure: the first gesture starts any clip
   the browser held back */
stage.addEventListener('pointerdown', () => { for (const m of media) if (m instanceof HTMLVideoElement && m.paused) void m.play().catch(() => {}); }, { once: true });

// --- the model -------------------------------------------------------------

/*
 * Feel, per interaction. Every spring carries its own params, and params can
 * change mid-flight without a discontinuity (the closed-form step re-derives
 * from the current value and velocity each frame), so one spring can feel
 * different per gesture while everything still runs in the one ticker and
 * feeds the one layout below.
 */
const GROW = { response: 0.42, bounce: 0.35 };          // snappy, a little overshoot
const SHRINK = { response: 0.55, dampingRatio: 0.95 };  // calmer, no bounce on the way back
const STRIP = { response: 0.6, dampingRatio: 0.8 };     // the offset at rest / after a fling
const FOLLOW = { response: 0.25, dampingRatio: 1 };     // the offset under the finger
const OPEN = { response: 0.85, dampingRatio: 0.82 };    // strip → case study
const CLOSE = { response: 0.7, dampingRatio: 0.9 };     // case study → strip
const LEAN = { response: 0.45, dampingRatio: 0.55 };    // under-damped: the lean overshoots on release
const SCROLL = { response: 0.7, dampingRatio: 1 };      // back-to-top

const MAX_LEAN = 30;        // degrees at full velocity
const LEAN_VELOCITY = 1500; // px/s that maps to MAX_LEAN
const PARALLAX = 0.12;      // crop slide (texture fraction) for a card at the viewport's edge

const focus = Array.from({ length: N }, () => new Spring(0, SHRINK));
const offset = new Spring(0, STRIP);
const view = new Spring(0, OPEN);
const tilt = new Spring(0, LEAN);
const scroll = new Spring(0, SCROLL);
for (const s of focus) ticker.add(s);
ticker.add(offset); ticker.add(view); ticker.add(tilt); ticker.add(scroll);

const focusValue = (i: number) => focus[i].value;
const anyMoving = () => !offset.sleeping || !view.sleeping || !tilt.sleeping || !scroll.sleeping || focus.some((s) => !s.sleeping);

/** index of the card the strip keeps centred; -1 while the finger owns the offset */
let anchor = 0;
/** the card that is (or is becoming) big; -1 when none */
let focused = -1;
/** the case study's subject; stays set while the view closes, cleared once it has */
let hero = -1;

const scales = new Float32Array(N);
const pushes = new Float32Array(N);
/* d/dt of the above — the springs' velocities, laid out the same way. The
   GL writer feeds these to the glass, so motion is read, never faked. */
const scaleVel = new Float32Array(N);
const pushVel = new Float32Array(N);

/** Centre of card i at rest — the grid the strip snaps to. */
const baseCentre = (i: number) => i * (W + GAP) + W / 2;

/**
 * From the CURRENT focus values: each card's scale, and how far it is shoved
 * sideways by every card that is bigger than rest. A card k with extra width
 * E pushes everything left of it by −E/2 and everything right of it by +E/2;
 * contributions from several growing cards (one shrinking while the next
 * grows) just add.
 */
function stripLayout(): void {
  const big = bigScale();
  pushes.fill(0);
  pushVel.fill(0);
  for (let k = 0; k < N; k++) {
    scales[k] = 1 + focusValue(k) * (big - 1);
    scaleVel[k] = focus[k].velocity * (big - 1);
    const half = (W * (scales[k] - 1)) / 2;
    const halfVel = (W * scaleVel[k]) / 2;
    if (half === 0 && halfVel === 0) continue;
    for (let i = 0; i < k; i++) { pushes[i] -= half; pushVel[i] -= halfVel; }
    for (let i = k + 1; i < N; i++) { pushes[i] += half; pushVel[i] += halfVel; }
  }
}

/**
 * The case study, in document px: a hero frame at the top, a column of planes
 * under it, the strip again at the bottom. Read every frame so a resize is
 * just a new target.
 */
type Case = { heroW: number; heroH: number; heroCy: number; colW: number; colH: number; colTop: number; colGap: number; stripCy: number; height: number };
function caseLayout(): Case {
  const margin = 24;
  const heroW = Math.min(innerWidth - margin * 2, 1200, ((innerHeight - HERO_TOP - 64) * W) / H);
  const heroH = (heroW * H) / W;
  const heroCy = HERO_TOP + heroH / 2;
  const colW = heroW;
  const colH = (colW * 9) / 16;
  const colGap = 32;
  const colTop = HERO_TOP + heroH + colGap;
  const colBottom = colTop + COLUMN * colH + (COLUMN - 1) * colGap;
  const stripCy = colBottom + 140 + H / 2;
  return { heroW, heroH, heroCy, colW, colH, colTop, colGap, stripCy, height: stripCy + H / 2 + 120 };
}

/** Nearest card to a resting offset. */
function nearest(off: number): number {
  const i = Math.round((-off - W / 2) / (W + GAP));
  return Math.max(0, Math.min(N - 1, i));
}

// --- interactions: only setTarget / addVelocity ------------------------------

function setFocus(i: number) {
  focused = i;
  for (let j = 0; j < N; j++) {
    const grow = j === i;
    // Retune, then retarget: value and velocity are untouched by either.
    focus[j].setParams(grow ? GROW : SHRINK).setTarget(grow ? 1 : 0);
  }
  if (i >= 0) anchor = i;
}

/** Scroll owned by the engine: snap to where the page IS, then aim. */
function scrollTo(y: number) {
  scroll.snap(window.scrollY);
  scroll.setTarget(y);
}
// The wheel wins: a user scroll parks the spring where the page is.
addEventListener('wheel', () => { if (!scroll.sleeping) scroll.snap(window.scrollY); }, { passive: true });
addEventListener('touchmove', () => { if (!scroll.sleeping) scroll.snap(window.scrollY); }, { passive: true });

function open(i: number) {
  hero = i;
  setFocus(i);
  view.setParams(OPEN).setTarget(1);
  document.documentElement.classList.add('case');
  spacer.style.height = `${caseLayout().height}px`;
  scrollTo(0);
}

function close() {
  setFocus(-1);
  if (hero >= 0) anchor = hero;   // the strip re-centres on what we were reading
  view.setParams(CLOSE).setTarget(0);
  scrollTo(0);
  // hero, the spacer and the scroll class are released once the view has closed (see write)
}

let dragged = false;

/*
 * Fling feel. A snapping strip wants a short throw: the default UIKit
 * projection (velocity × 0.5 s) reads as a slot machine here. 0.994 gives
 * velocity × 0.17 s — a firm flick carries about one card — and the release
 * may never land more than MAX_THROW cards from where the finger let go.
 * The injected velocity is capped too, or the spring overshoots the snap.
 */
const FLING_DECEL = 0.994;
const MAX_THROW = 4;
const MAX_VELOCITY = 4000;
/** px/s above which even a tiny flick advances one card. */
const FLICK_VELOCITY = 250;

/** In the case study only the bottom strip drags; elsewhere the page scrolls. */
function stripBand(): { top: number; bottom: number } | null {
  if (view.target < 0.5) return null;
  const c = caseLayout();
  const cy = c.stripCy - window.scrollY;
  return { top: cy - H, bottom: cy + H };
}

bindDrag(stage, {
  x: offset,
  bounds: { minX: -baseCentre(N - 1), maxX: -baseCentre(0) },
  rubberband: 0.35,
  maxVelocity: MAX_VELOCITY,
  dragParams: FOLLOW,
  accept(e) {
    const band = stripBand();
    return !band || (e.clientY > band.top && e.clientY < band.bottom);
  },
  onStart() {
    dragged = true;
    if (view.target < 0.5) setFocus(-1); // in the strip a grab lets go of the big one
    anchor = -1;                          // the finger owns the offset now
    stage.classList.add('dragging');
  },
  release(_axis, position, velocity) {
    const here = nearest(position);
    let thrown = nearest(position + projectFling(velocity, FLING_DECEL));
    // A small flick always turns the page: one card in the flick's direction.
    if (thrown === here && Math.abs(velocity) > FLICK_VELOCITY) thrown = here + (velocity < 0 ? 1 : -1);
    anchor = Math.max(0, Math.min(N - 1, Math.max(here - MAX_THROW, Math.min(here + MAX_THROW, thrown))));
    return -baseCentre(anchor);
  },
  onEnd() {
    stage.classList.remove('dragging');
  },
});

// One listener on the stage. Hit-test by pointer position rather than trusting
// the event target, so it works whatever element the browser hands the click.
stage.addEventListener('click', (e) => {
  if (dragged) { dragged = false; return; } // the drag's release, not a tap
  const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.card');
  if (!hit) return;
  const i = cards.indexOf(hit);
  if (i < 0 || i >= N) return;
  if (view.target < 0.5) open(i);          // strip: open the case study
  else if (i === hero) close();            // the hero: back to the strip
  else open(i);                            // a bottom card: swap the subject
});
stage.addEventListener('pointerdown', () => { dragged = false; });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && view.target > 0.5) close(); });

// --- two writers, one model ---------------------------------------------------

/*
 * HTML writes transforms to the card boxes. WebGPU writes the same numbers
 * (plus the velocities) into uniform slices and draws glass planes on the
 * canvas over the page; the boxes stay in the DOM, invisible, so hit testing
 * and the drag are untouched. The toggle switches writers, never the model —
 * flip it mid-fling and the motion carries straight on.
 */
type Mode = 'dom' | 'gl';
let mode: Mode = 'dom';
let glass: Glass | null = null;
let glReady = false;
const modeBar = document.getElementById('mode')!;
const glButton = modeBar.querySelector<HTMLButtonElement>('[data-mode="gl"]')!;
const canvas = document.getElementById('gl') as HTMLCanvasElement;

glButton.disabled = true;
glButton.textContent = 'WebGPU …';
Glass.create(canvas, media).then((g) => {
  glass = g;
  if (!g) { glButton.textContent = 'no WebGPU'; return; }
  g.ready.then(() => { glReady = true; glButton.disabled = false; glButton.textContent = 'WebGPU'; settledFrames = 0; });
});

function setMode(next: Mode) {
  if (next === 'gl' && !glReady) return;
  mode = next;
  stage.classList.toggle('gl', mode === 'gl');
  for (const b of modeBar.querySelectorAll<HTMLElement>('button')) b.classList.toggle('on', b.dataset.mode === mode);
  if (mode === 'dom') glass?.clear();
  settledFrames = 0; // force a write in the new mode
}
modeBar.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (b?.dataset.mode) setMode(b.dataset.mode as Mode);
});

const planes: GlassPlane[] = Array.from({ length: T }, () => ({ x: 0, y: 0, w: W, h: H, radius: RADIUS, vx: 0, vy: 0, vs: 0, focus: 0, alpha: 1, tiltY: 0, tiltX: 0, depth: DEPTH, parallax: 0 }));
const DEG = Math.PI / 180;
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

let settledFrames = 0;
const t0 = performance.now();
/* last frame's rects, for the velocities the glass reads */
const prevX = new Float32Array(T), prevW = new Float32Array(T);
let prevT = performance.now();

ticker.onWrite(() => {
  // The anchored card's resting centre is the strip's target. The growing
  // card never moves (it pushes outward from its own centre), so this is a
  // constant while anchored — no chasing, no asymmetry.
  if (anchor >= 0) offset.setTarget(-baseCentre(anchor));
  // The lean is a filtered readout of the strip's velocity.
  tilt.setTarget(clamp1(offset.velocity / LEAN_VELOCITY) * MAX_LEAN);
  // The engine's scroll, while it is moving.
  if (!scroll.sleeping) window.scrollTo(0, scroll.value);

  // Case study closed: release what the open held.
  if (hero >= 0 && view.target === 0 && view.sleeping) {
    hero = -1;
    document.documentElement.classList.remove('case');
    spacer.style.height = '0px';
    window.scrollTo(0, 0);
  }

  const moving = anyMoving();
  // Clips advance on their own clock: in GL mode they need a draw every frame.
  const live = mode === 'gl' && !!glass?.hasVideo;
  if (!moving && !live && settledFrames > 1) return;
  settledFrames = moving ? 0 : settledFrames + 1;

  stripLayout();
  const c = caseLayout();
  const v = view.value;
  const sy = window.scrollY;
  const cx = innerWidth / 2, cy = innerHeight / 2;
  const lean = tilt.value;
  const now = performance.now();
  const dt = Math.max(1e-3, (now - prevT) / 1000);
  prevT = now;

  for (let i = 0; i < T; i++) {
    // --- the two layouts and their blend ---
    let x: number, y: number, w: number, h: number, alpha = 1, focusAmt = 0, leanAmt = lean, nod = 0;
    if (i < N) {
      // strip
      const sx = cx + offset.value + baseCentre(i) + pushes[i];
      const sw = W * scales[i], sh = H * scales[i];
      // case
      const isHero = i === hero;
      const kx = isHero ? cx : cx + offset.value + baseCentre(i);
      const ky = isHero ? c.heroCy - sy : c.stripCy - sy;
      const kw = isHero ? c.heroW : W;
      const kh = isHero ? c.heroH : H;
      x = sx + (kx - sx) * v; y = cy + (ky - cy) * v; w = sw + (kw - sw) * v; h = sh + (kh - sh) * v;
      focusAmt = focusValue(i);
      // the hero stops leaning as it becomes the page; the bottom strip keeps leaning
      leanAmt = lean * (isHero ? 1 - v : 1);
      // a growing card nods back a touch by its own velocity — the same readout the glass bulges by
      nod = Math.max(-6, Math.min(6, scaleVel[i] * -2.5)) * (1 - v);
    } else {
      // column plane: rises into place and fades in with the view
      const j = i - N;
      const ky = c.colTop + j * (c.colH + c.colGap) + c.colH / 2 - sy;
      x = cx; y = ky + 160 * (1 - v); w = c.colW; h = c.colH;
      alpha = v;
      leanAmt = 0;
    }

    // --- readouts ---
    const parallax = clamp1((x - cx) / (innerWidth / 2)) * PARALLAX;
    const sxs = w / W, sys = h / H;
    const radius = RADIUS * Math.min(sxs, sys);
    const vx = (x - prevX[i]) / dt;
    const vs = (w - prevW[i]) / dt / W;
    prevX[i] = x; prevW[i] = w;

    // --- HTML writer: the boxes always follow — hit targets in both modes,
    //     the picture in HTML mode. Same perspective as the GL camera. ---
    const el = cards[i];
    el.style.transform =
      `perspective(1400px) translate3d(${(x - cx).toFixed(2)}px, ${(y - cy).toFixed(2)}px, 0) rotateY(${leanAmt.toFixed(3)}deg) rotateX(${nod.toFixed(3)}deg) scale(${sxs.toFixed(4)}, ${sys.toFixed(4)})`;
    el.style.borderRadius = `${(radius / sxs).toFixed(2)}px / ${(radius / sys).toFixed(2)}px`;
    el.style.zIndex = String(i === hero ? 20 : i < N ? 10 + Math.round(focusAmt * 5) : 5);
    el.style.opacity = alpha.toFixed(3);
    (media[i] as HTMLElement).style.objectPosition = `${(50 + parallax * 100).toFixed(2)}% 50%`;

    // --- GL writer ---
    const p = planes[i];
    p.x = x; p.y = y; p.w = w; p.h = h;
    p.radius = radius;
    p.depth = DEPTH * Math.min(sxs, sys);
    p.tiltY = leanAmt * DEG;
    p.tiltX = nod * DEG;
    p.parallax = parallax;
    p.vx = vx; p.vy = 0; p.vs = vs;
    p.focus = i === hero ? 1 : focusAmt;
    p.alpha = alpha;
  }
  if (mode === 'gl' && glass) glass.draw(planes, (now - t0) / 1000);
});

addEventListener('resize', () => {
  glass?.resize();
  if (view.target > 0.5) spacer.style.height = `${caseLayout().height}px`;
  settledFrames = 0;
});
// Scroll moves the case layout on screen: one more write per scroll frame.
addEventListener('scroll', () => { settledFrames = 0; }, { passive: true });

// Start with the first card centred, at rest.
offset.snap(-baseCentre(0));

(window as unknown as { pg: unknown }).pg = {
  ticker, focus, offset, tilt, view, scroll, media, setMode, open, close,
  get anchor() { return anchor; },
  get focused() { return focused; },
  get hero() { return hero; },
  get mode() { return mode; },
  get glass() { return glass; },
  get glReady() { return glReady; },
};
