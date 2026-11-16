# @alpacka/sticky

`position: sticky` that eases in and out. The element slows down as it reaches
its line, and speeds up gradually when its container ends.

The browser still pins the element. This library adds one offset on top, on
`translate`, as a scroll-driven animation. The offset is zero except in a short
stretch of scroll at each end of the pin. Where it does not run, the element is
plain sticky and the layout is the same.

TypeScript, ES modules, no dependencies.

Demo: [sticky.jesperlandberg.com](https://sticky.jesperlandberg.com)

Up to 0.1.0 this package was `@alpacka/smooth-stick`. `smoothStick` is now
`sticky`, and the types are `Sticky`, `StickyOptions` and `StickyAll`.

## Install

```sh
npm i @alpacka/sticky
```

Each version is also attached as a tarball to its GitHub release, tagged
`sticky-vX.Y.Z` on [jesperlandberg/lama](https://github.com/jesperlandberg/lama/releases).

## Use

Keep your existing `position: sticky` and `top`. The element's parent must be
the box it sticks within.

```html
<section class="parent">
	<aside class="rail" style="position: sticky; top: 20px">…</aside>
</section>
```

```ts
import { sticky } from '@alpacka/sticky'

const stick = sticky(document.querySelector('.rail')!)

stick.refresh() // measure again
stick.freeze()  // keep the current offset and stop following the scroll
stick.destroy() // back to plain sticky
```

It measures again when the element, its parent or the viewport resizes. It does
not need to when something only moves the parent, such as a font loading or an
image arriving above it. Call `refresh()` for a change that resizes neither box.

Use `freeze()` before a page transition that resets the scroll while the old
page is still on screen.

## Options

| option | default | |
| --- | --- | --- |
| `distance` | `0.4` | How much scroll the ease in, and the ease out, takes. A fraction of the viewport height. |
| `ease` | `'power2'` | The curve: `'power1'`, `'power2'`, `'power3'`, `'expo'`, or any ease-out function, for example `gsap.parseEase('expo.out')`. The ease out is the same curve mirrored. |
| `media` | `'(hover: hover) and (pointer: fine)'` | Media query for where it runs. Elsewhere, including touch, the element is plain sticky. `'all'` runs it everywhere. |
| `engine` | `'auto'` | `'compositor'` uses a scroll-driven animation. `'main'` writes the same offset from script. `'auto'` picks the compositor where it is supported. |
| `ticker` | `requestAnimationFrame` | `(fn) => unsubscribe`. The frame loop the main engine uses. Pass your smooth scroll's loop (Lenis) so the write happens in the frame the page moves in. It is subscribed only while the parent is near the viewport, so it can be called more than once. |

The element is also plain sticky under `prefers-reduced-motion`, and whenever
its computed position is not `sticky`. A breakpoint that turns sticky off turns
this off too.

## Touch

Off by default. On a phone the offset can run out of step with the scroll,
depending on the browser, so touch devices get plain sticky. To run it
everywhere anyway:

```ts
sticky.all({ media: 'all' })
```

Try that on a real phone before you ship it.

## Every sticky at once

```ts
const sticks = sticky.all()          // every sticky on the page
const rails = sticky.all('.rail')    // or only the ones you name

sticks.scan()     // look again after content was added or removed
sticks.refresh()
sticks.freeze()
sticks.destroy()
```

With no selector, `all()` finds the elements itself. It reads the page's
stylesheets for rules that set `position: sticky` and takes what their
selectors match, plus elements made sticky with an inline style. Because it
reads the rules and not the computed style, a sticky that only applies from a
breakpoint up is found at any width and turns on when the rule applies.

A stylesheet from another origin served without CORS cannot be read. If the
page has one, `all()` also takes every element that is sticky at that moment.

It is safe to run on every sticky. These stay plain sticky:

- a table header
- a site header whose container is the whole page
- a `bottom` sticky
- a sticky inside its own scroll container

Both forms take the options above. An attribute sets them per element:

```html
<aside data-sticky-ease="off">…</aside>   <!-- skip this one -->
<aside data-sticky-ease="expo" data-sticky-distance="0.3">…</aside>
```

`sticks.sticks` is a `Map` from each element to its own `Sticky`.
`findSticky()` runs the search alone and returns the elements.

## How it works

Sticky's own offset is `clamp(scroll − engage, 0, travel)`: zero, then equal to
the scroll, then constant. Its speed changes instantly at both ends.

The ease in takes `W` of scroll (`distance` × viewport height) and follows an
ease-out `E` whose slope at the start is `m = E′(0)`. To start at exactly
scroll speed, the element can cover only `A = W / m` of ground while it eases.
With `t` from 0 to 1 across those `W` of scroll, the offset is:

```
ease in(t)  = A · (min(m·t, 1) − E(t))
ease out(t) = −ease in(1 − t)
```

The ease in starts `A` of scroll before the element reaches its line and ends
`(m − 1)·A` after it. The offset is largest where sticky engages:
`A·(1 − E(1/m))`, about `0.3·A` for power2. If the container is too short for
both eases, both are shortened to fit.

The compositor engine samples this into keyframes and runs it on the parent's
view timeline, so no script runs while the page scrolls.

## Without sticky

A virtual scroll has no `position: sticky`. `curve` gives the same maths on its
own. Use `clamp` where you would clamp the offset:

```ts
import { curve } from '@alpacka/sticky'

const c = curve({ travel: 1200, span: innerHeight * 0.4, ease: 'power2' })
const offset = c.clamp(scroll - engage)
```

## Support

The compositor engine needs scroll-driven animations: Chrome and Edge 115+,
Safari 26+. Other browsers, including Firefox, use the main engine.

Supported: `top` stickies on the block axis of the root scroller.

Not supported yet, and left plain sticky: `bottom` and `left` stickies, and
stickies inside a nested scroll container.

While it runs, the library owns the element's `translate`.

## License

MIT
