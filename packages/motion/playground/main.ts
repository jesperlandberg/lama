import {
  DomAdapter,
  Flip,
  Spring,
  Ticker,
  applyFlipToDom,
  bindDrag,
  bindStates,
} from '@lama/motion';

/*
 * Playground: a field of images the user re-lays out (grid, row, masonry,
 * featured, list, stack) plus a fake "detail page" reached by clicking a
 * card. Every change goes through the Flip registry:
 *
 * - layout switch  → flip.mutate(): CSS does the new layout, play() flies
 *                    every card from its previous-frame rect to the new one
 * - card → detail  → hold(id), tear the field down, mount the detail view,
 *                    register() the hero under the same id: the handoff
 * - detail → back  → the mirror: hold the hero, mount the field, the card
 *                    claims it and flies home
 * - chaos          → retargets every 400ms so flights interrupt flights
 *
 * Nothing is ever cancelled. Hover scale lives on the inner <img> through
 * the DOM adapter, so it composes with the flip transform on the card.
 */

const ticker = new Ticker().start();
const flip = new Flip();
ticker.add(flip);
applyFlipToDom(flip, ticker);
const dom = new DomAdapter(ticker);

const IMAGES = Array.from({ length: 12 }, (_, i) => ({
  id: `img-${i}`,
  src: `https://picsum.photos/seed/motion-${i}/800/800`,
  title: ['Terrane', 'Dune', 'Harbor', 'Basalt', 'Meadow', 'Arc', 'Slate', 'Tide', 'Pine', 'Fold', 'Quarry', 'Drift'][i],
}));

let order = IMAGES.map((m) => m.id);
let layout = 'grid';
const page = document.getElementById('page')!;
const hud = document.getElementById('hud')!;

const byId = (id: string) => IMAGES.find((m) => m.id === id)!;

// --- cards -----------------------------------------------------------------

const hoverSprings = new WeakMap<HTMLElement, Spring>();
const cleanups = new WeakMap<HTMLElement, () => void>();

function card(id: string, extraClass = ''): HTMLElement {
  const m = byId(id);
  const el = document.createElement('div');
  el.className = `card ${extraClass}`.trim();
  el.dataset.id = id;
  el.innerHTML = `<img src="${m.src}" alt="" draggable="false" /><span class="tag">${m.title}</span>`;

  // Hover / press on the image, composed with the card's flip transform.
  const img = el.querySelector('img')!;
  const scale = new Spring(1, { response: 0.4, dampingRatio: 0.7 });
  const offTick = ticker.add(scale);
  const offStyle = dom.transform(img, { scale });
  const offPointer = bindStates(el, scale, { rest: 1, hover: 1.06, press: 0.97 });
  hoverSprings.set(el, scale);
  cleanups.set(el, () => { offTick(); offStyle(); offPointer(); });

  // Register with the flip; the same id on the detail page claims it.
  flip.register(id, el, { offer: true });
  return el;
}

// --- views -----------------------------------------------------------------

function mountField() {
  const field = document.createElement('div');
  field.className = 'field';
  field.dataset.layout = layout;
  order.forEach((id, i) => {
    const el = card(id);
    el.style.setProperty('--index', String(i));
    el.addEventListener('click', () => openDetail(id));
    field.append(el);
  });
  page.replaceChildren(field);
}

function mountDetail(id: string) {
  const m = byId(id);
  const view = document.createElement('div');
  view.className = 'detail';

  const hero = card(id, 'hero');
  hero.addEventListener('click', () => closeDetail(id));

  const copy = document.createElement('div');
  copy.className = 'copy';
  copy.innerHTML = `<h1>${m.title}</h1><p>The hero is the SAME flip entry as the card you clicked. Click it to fly back — or click a thumbnail to swap heroes mid-flight.</p>`;
  const thumbs = document.createElement('div');
  thumbs.className = 'thumbs';
  for (const other of order.filter((o) => o !== id).slice(0, 8)) {
    const t = card(other);
    t.addEventListener('click', () => swapDetail(other));
    thumbs.append(t);
  }
  copy.append(thumbs);
  view.append(hero, copy);
  page.replaceChildren(view);
}

/** Hold everything currently on the page, then let the caller mount the next view. */
function holdAll() {
  for (const el of page.querySelectorAll<HTMLElement>('.card')) {
    flip.hold(el.dataset.id!);
    cleanups.get(el)?.();
  }
}

let detail: string | null = null;

function openDetail(id: string) {
  holdAll();
  detail = id;
  mountDetail(id);
  // Anything held that the detail did not claim retires after a beat.
  setTimeout(() => flip.expireHolds(), 300);
}

function closeDetail(_id: string) {
  holdAll();
  detail = null;
  mountField();
  setTimeout(() => flip.expireHolds(), 300);
}

function swapDetail(id: string) {
  holdAll();
  detail = id;
  mountDetail(id);
  setTimeout(() => flip.expireHolds(), 300);
}

// --- in-page layout changes -----------------------------------------------

function setLayout(next: string) {
  layout = next;
  for (const b of document.querySelectorAll<HTMLElement>('#layouts button')) b.classList.toggle('on', b.dataset.layout === next);
  if (detail) return;
  const field = page.querySelector<HTMLElement>('.field');
  if (!field) return;
  flip.mutate(() => { field.dataset.layout = next; });
}

function shuffle() {
  order = [...order].sort(() => Math.random() - 0.5);
  if (detail) return;
  const field = page.querySelector<HTMLElement>('.field')!;
  flip.mutate(() => {
    const byKey = new Map([...field.children].map((c) => [(c as HTMLElement).dataset.id!, c as HTMLElement]));
    order.forEach((id, i) => {
      const el = byKey.get(id);
      if (!el) return;
      el.style.setProperty('--index', String(i));
      field.append(el); // re-append in new order
    });
  });
}

function dropOne() {
  if (detail || order.length <= 1) return;
  const field = page.querySelector<HTMLElement>('.field')!;
  const id = order[Math.floor(Math.random() * order.length)];
  order = order.filter((o) => o !== id);
  flip.mutate(() => {
    const el = field.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (el) { cleanups.get(el)?.(); el.remove(); }
  });
}

function addOne() {
  if (detail) return;
  const missing = IMAGES.map((m) => m.id).filter((id) => !order.includes(id));
  if (!missing.length) return;
  const id = missing[0];
  const field = page.querySelector<HTMLElement>('.field')!;
  const at = Math.floor(Math.random() * (order.length + 1));
  order.splice(at, 0, id);
  flip.mutate(() => {
    const el = card(id);
    el.addEventListener('click', () => openDetail(id));
    field.insertBefore(el, field.children[at] ?? null);
    // A newborn has no previous pose: give it one so it flies in from the centre.
    const e = flip.get(id)!;
    const r = field.getBoundingClientRect();
    e.pose = { left: r.left + r.width / 2 - 20, top: r.top + r.height / 2 - 20, width: 40, height: 40 };
    e.lastRect = e.pose;
  });
}

// --- wiring ---------------------------------------------------------------

document.getElementById('layouts')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (b?.dataset.layout) setLayout(b.dataset.layout);
});
document.getElementById('shuffle')!.addEventListener('click', shuffle);
document.getElementById('drop')!.addEventListener('click', dropOne);
document.getElementById('add')!.addEventListener('click', addOne);

const LAYOUTS = ['grid', 'row', 'masonry', 'featured', 'list', 'stack'];
let chaos = 0;
document.getElementById('chaos')!.addEventListener('change', (e) => {
  clearInterval(chaos);
  if ((e.target as HTMLInputElement).checked) {
    chaos = window.setInterval(() => {
      const next = LAYOUTS[Math.floor(Math.random() * LAYOUTS.length)];
      if (Math.random() < 0.3) shuffle();
      setLayout(next);
    }, 400);
  }
});

// Tuning: params on a Flip apply to flights started after the change.
const response = document.getElementById('response') as HTMLInputElement;
const damping = document.getElementById('damping') as HTMLInputElement;
const tune = () => {
  (document.getElementById('responseOut') as HTMLOutputElement).value = response.value;
  (document.getElementById('dampingOut') as HTMLOutputElement).value = damping.value;
  flip.setParams({ response: +response.value, dampingRatio: +damping.value });
};
response.addEventListener('input', tune);
damping.addEventListener('input', tune);

// Resize: CSS re-lays out; the flights' targets are live so nothing to do.
// Settled cards mirror layout each frame. Nothing here on purpose.

ticker.onWrite(() => {
  hud.textContent = `flying ${flip.flying}`;
});

mountField();

// --- drag demo ------------------------------------------------------------

const knob = document.getElementById('knob')!;
const track = document.getElementById('track')!;
const kx = new Spring(0, { response: 0.5, dampingRatio: 0.75 });
ticker.add(kx);
dom.transform(knob, { x: kx });
const maxX = () => track.clientWidth - knob.offsetWidth - 8;
bindDrag(knob, {
  x: kx,
  bounds: { minX: 0, maxX: maxX() },
  rubberband: 0.4,
  dragParams: { response: 0.18, dampingRatio: 1 }, // tight follow while held
});
window.addEventListener('resize', () => kx.setTarget(Math.min(kx.target, maxX())));

// Debug handle for the console.
(window as unknown as { pg: unknown }).pg = { ticker, flip, dom, kx };
