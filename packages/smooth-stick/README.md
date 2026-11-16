# @alpacka/smooth-stick

`position: sticky` with its corners rounded off. The element slows into its
line instead of stopping dead on it, and eases away when its container runs
out instead of leaving at full scroll speed.

Sticky still does the pinning. This adds only the difference between sticky's
motion and the same motion with its corners rounded, which is zero except in a
short window at each corner, and runs it as a scroll-driven animation. The
compositor applies it from the same scroll as sticky, and no script runs while
the page moves. Wherever it does not run, the element is plain sticky.

TypeScript, ES modules, no dependencies.

## Install

```sh
npm i @alpacka/smooth-stick
```

Every version is also attached as a tarball to its GitHub release, tagged
`smooth-stick-vX.Y.Z` on [jesperlandberg/lama](https://github.com/jesperlandberg/lama/releases).

## Use

Keep the sticky you already have. The element's parent is the box it sticks
within.

```html
<section class="parent">
	<aside class="rail" style="position: sticky; top: 20px">…</aside>
</section>
```

```ts
import { smoothStick } from '@alpacka/smooth-stick'

const stick = smoothStick(document.querySelector('.rail')!)

stick.freeze()  // hold the current pose, e.g. before a page transition resets the scroll
stick.destroy() // back to plain sticky
```

It measures itself again when the element or its parent resizes, and when the
viewport does. Anything that only moves the parent, like a font swapping in or
a picture arriving above it, needs nothing, because the windows ride the
parent's own view timeline.

| option | default | |
| --- | --- | --- |
| `distance` | `0.4` | scroll a landing, and a take-off, lasts, as a fraction of the viewport's height |
| `ease` | `'power2'` | the landing curve: `'power1'`, `'power2'`, `'power3'`, `'expo'`, or any ease-out function (`gsap.parseEase('expo.out')`). The take-off plays it mirrored |
| `media` | `'(hover: hover) and (pointer: fine)'` | where it runs. Everywhere else, including touch, it is plain sticky. `'all'` runs it everywhere |
| `engine` | `'auto'` | `'compositor'` runs a scroll-driven animation, `'main'` writes the same curve from `ticker`, `'auto'` takes the compositor wherever there is one |
| `ticker` | `requestAnimationFrame` | `(fn) => unsubscribe`, the loop the main-thread engine writes on. Hand in your smooth scroll's frame (Lenis) so the write lands in the frame the page moves in. Subscribed only while the parent is near the viewport, so it is called again each time the parent comes back |

It also stays plain sticky under `prefers-reduced-motion`, and whenever the
element's computed position is not `sticky`, so a breakpoint that turns the
sticky off turns this off with it.

## Every sticky at once

```ts
const sticks = smoothStick.all()          // every sticky on the page
const rails = smoothStick.all('.rail')    // or the ones you name

sticks.scan()     // look again, after content arrived or left
sticks.freeze()
sticks.destroy()
```

With no selector it finds the stickies itself. It reads the page's stylesheets
for the rules that declare `position: sticky` and takes what their selectors
match, plus anything made sticky inline. It goes by the rules, not by computed
style, so a sticky that only exists from a breakpoint up is found at any width
and switches itself on when it becomes one. A stylesheet from another origin,
served without CORS, cannot be read; with one of those on the page it also
takes every element that is sticky right now.

Running it blind is safe because the correction is only ever an offset on top
of sticky. What it cannot round stays plain sticky: a table header pinned
inside its row, a site header with the whole page to stick within, a `bottom`
sticky, a sticky inside its own scroll container.

Both forms take the same options, and an attribute sets one element apart:

```html
<aside data-smooth-stick="off">…</aside>   <!-- leave this one alone -->
<aside data-smooth-stick="expo" data-smooth-stick-distance="0.3">…</aside>
```

`sticks.sticks` is a `Map` of each element to its own stick. `findSticky()` is
the search on its own.

## How it works

Sticky's offset is `clamp(scroll − engage, 0, travel)`, a ramp with two sharp
corners. A landing lasts `W` of scroll and follows an ease-out `E` that leaves
at slope `m = E′(0)`. For the element to enter the window at exactly scroll
speed, it can only travel `A = W / m` while it lands, and the correction across
the window is

```
landing(t)  = A · (min(m·t, 1) − E(t))    sticky's progress through the window, minus the eased one
take-off(t) = −landing(1 − t)
```

It starts slowing `A` before its line and settles `(m − 1)·A` of scroll after
the point sticky would have stopped it. The correction peaks at sticky's own
corner, at `A·(1 − E(1/m))`, about `0.3·A` for power2. With too little travel
for both windows, they shrink together until they meet.

## Without sticky

A virtual scroll has no sticky to correct. `curve` is the same maths on its
own, and `clamp` is the rounded ramp to use in place of a clamp:

```ts
import { curve } from '@alpacka/smooth-stick'

const c = curve({ travel: 1200, span: innerHeight * 0.4, ease: 'power2' })
const offset = c.clamp(scroll - engage)
```

## Support

The compositor path needs scroll-driven animations: Chrome and Edge 115+,
Safari 26+. Firefox takes the main-thread path.

Handled: `top` stickies on the block axis of the root scroller. Not yet, and
left plain sticky until then: `bottom` and `left` stickies (the same maths,
mirrored) and stickies inside nested scroll
containers. While it runs, the element's `translate` belongs to it.

## License

MIT
