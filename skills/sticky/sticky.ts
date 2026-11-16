/* @alpacka/sticky 0.2.1 · one file, no dependencies · from the sticky skill, github.com/jesperlandberg/alpacka */
/*
 * @alpacka/sticky — position: sticky with its two corners rounded off.
 *
 * Sticky moves an element on a ramp. The offset it adds is
 * clamp(scroll − engage, 0, travel): nothing until the element reaches its
 * line, then exactly the scroll, then the whole travel once the container runs
 * out. A ramp has two sharp corners, and they are what the eye reads as the
 * hard stick: scroll speed to dead still in one pixel, and back again.
 *
 * Sticky keeps doing the pinning. What this adds is the difference between
 * that ramp and one with its corners rounded off, written to `translate`. The
 * difference is zero everywhere but a short window at each corner, so outside
 * the windows the element is plain sticky, and wherever the correction does
 * not run — touch by default, reduced motion, a breakpoint that turns the
 * sticky off, a browser with nothing to run it on — it is plain sticky
 * throughout. The layout is the same either way.
 *
 * ── The windows ──
 *
 * A landing lasts `span` of scroll and follows an ease-out E. E leaves at
 * slope m = E′(0), so a landing that begins at scroll speed can only cover
 * span / m of ground: that distance is what keeps the edge of the window
 * seamless, and any other leaves a small corner of its own there. The element
 * starts slowing span / m before its line and settles (m − 1) · span / m after
 * the point sticky would have stopped it. Across the window the correction is
 * that distance times min(m·t, 1) − E(t), sticky's own progress through the
 * window minus the eased one. The take-off is the same curve mirrored.
 *
 * Too little travel for both, and the two windows shrink together until they
 * meet, so the element still touches down. One that starts nearer its line
 * than a landing's worth of scroll lands in what there is. An ease that does
 * not leave faster than scroll speed (linear, an ease-in) cannot round a
 * corner, and leaves the element plain sticky.
 *
 * ── Where it runs ──
 *
 * The correction is sampled into keyframes and run as a scroll-driven
 * animation on the parent's view timeline, so the compositor applies it from
 * the same scroll as sticky and no script runs while the page moves. Both
 * corners are keyframes of their own: the correction's kink there is what
 * cancels sticky's, and samples either side of it would leave a sliver of the
 * stop standing. The windows are offsets on the parent's timeline, so anything
 * that moves the parent (a font swapping in above it, a picture arriving)
 * moves them with it; only a resize of the element or its parent calls for a
 * new measure, and a measure that finds the numbers where they were leaves
 * the animation running as it is.
 *
 * Without scroll-driven animations (Firefox today) the same curve is written
 * from a ticker: requestAnimationFrame, unless the caller hands in its own, so
 * a page driven by a smooth scroll (Lenis) can write it in the frame that
 * scroll moves in, and only while the parent is near the viewport, so a page
 * of these does not read layout every frame for elements nobody can see. A
 * write from script lands a frame behind a threaded scroll.
 *
 * Touch is left out by default, and not only for that engine. On a phone the
 * scroll belongs to the compositor and waits for nothing, and the
 * scroll-driven animation was seen out of step with it too, on a real device
 * with the animation built once and left alone. That is the browser's to
 * mend. `media: 'all'` runs it there anyway.
 *
 * ── All of them ──
 *
 * `sticky.all()` finds the page's stickies itself. It reads the
 * stylesheets for the rules that declare `position: sticky` and takes
 * whatever their selectors match, rather than asking every element for its
 * computed style: a sticky that only exists from a breakpoint up is not
 * sticky on a narrow viewport, and would be missed for good. The rule is
 * there at any width, and each element already turns itself on and off as its
 * computed position changes.
 *
 * It is safe to run blind because of what the correction is. A sticky this
 * cannot round (a table header pinned inside its row, a site header with the
 * whole page to stick within, a `bottom` sticky) measures to nothing and stays
 * plain sticky. `data-sticky-ease="off"` leaves an element out, and the same
 * attribute names an ease for one element.
 *
 * ── Left alone ──
 *
 * `top` stickies on the block axis of the root scroller. A `bottom` or `left`
 * sticky is the same maths mirrored and is not built. A sticky inside a
 * nested scroll container pins against that box, where the landing's lead and
 * the fallback's reads would need an origin of their own, so it is left plain
 * sticky. The parent is taken to be the box the element sticks within, and a
 * grid item counts when its area is the grid's whole height. While it runs,
 * the element's `translate` belongs to this.
 */

export type Ease = (t: number) => number

/* expo, scaled to reach 1 exactly: the usual 1 − 2^(−10t) stops 2^(−10) short and
   jumps the rest at t = 1, which here would be a step at the end of a landing */
const EXPO = 1 - 2 ** -10

/** Landing curves, as ease-outs on [0, 1]. The take-off plays the same curve mirrored. */
export const eases = {
	power1: (t: number) => 1 - (1 - t) ** 2,
	power2: (t: number) => 1 - (1 - t) ** 3,
	power3: (t: number) => 1 - (1 - t) ** 4,
	expo: (t: number) => (1 - 2 ** (-10 * t)) / EXPO,
} satisfies Record<string, Ease>

export type EaseName = keyof typeof eases

/* the named curves' slopes at 0, exactly */
const SLOPES: Record<EaseName, number> = { power1: 2, power2: 3, power3: 4, expo: (10 * Math.LN2) / EXPO }

/*
 * E′(0) for an ease known only as a function. A plain forward difference reads
 * a concave curve as leaving slower than it does, which leaves the correction a
 * hair below zero at the start of the window; a second, half-width difference
 * cancels that first-order error (Richardson).
 */
const slope = (E: Ease) => {
	const d = (h: number) => (E(h) - E(0)) / h
	return 2 * d(5e-5) - d(1e-4)
}

export type Curve = {
	/** scroll the element stays stuck for, sticky's own range */
	travel: number
	/** the landing window, in scroll past the point where sticky engages */
	into: [number, number]
	/** the take-off window, likewise */
	outof: [number, number]
	/** the correction at x: positive holds the element low, negative lifts it early */
	at: (x: number) => number
	/** sticky's own offset with its corners rounded off, for a page that has no sticky */
	clamp: (x: number) => number
}

export type CurveOptions = {
	/** scroll the element stays stuck for, sticky's own range */
	travel: number
	/** scroll one landing, or one take-off, lasts */
	span: number
	/** the landing curve, a name from `eases` or any ease-out */
	ease?: EaseName | Ease
	/** scroll there is before sticky engages; a landing cannot begin above the page */
	lead?: number
}

/*
 * The correction for one sticky range, as a function of x: scroll past the
 * point where sticky engages. Pure, so it can be tested without a page, and so
 * a virtual scroll, which has no sticky to correct, can use `clamp` in its
 * place.
 */
export const curve = ({ travel, span, ease = 'power2', lead = Infinity }: CurveOptions): Curve => {
	const E = typeof ease === 'function' ? ease : eases[ease]
	const m = typeof ease === 'function' ? slope(ease) : SLOPES[ease]
	const rounds = m > 1

	let land = rounds ? Math.min(span / m, Math.max(0, lead)) : 0
	let lift = rounds ? span / m : 0

	/* how far past sticky's corner a window runs, per unit of ground covered.
	   Nothing for an ease that rounds no corner, so one that is not a curve at
	   all (a slope that comes back NaN) leaves empty windows and not NaN ones. */
	const past = rounds ? m - 1 : 0

	const need = past * (land + lift)
	if (need > travel) {
		land *= travel / need
		lift *= travel / need
	}

	const into: [number, number] = [-land, past * land]
	const outof: [number, number] = [travel - past * lift, travel + lift]

	const bump = (t: number) => Math.min(m * t, 1) - E(t)

	const at = (x: number) => {
		if (x > into[0] && x < into[1]) return land * bump((x - into[0]) / (into[1] - into[0]))
		if (x > outof[0] && x < outof[1]) return -lift * bump((outof[1] - x) / (outof[1] - outof[0]))
		return 0
	}

	return { travel, into, outof, at, clamp: (x) => Math.min(Math.max(x, 0), travel) + at(x) }
}

/* not in TypeScript's DOM lib yet */
type ViewTimelineCtor = new (options: { subject: Element; axis: 'block' }) => AnimationTimeline
type RangeOptions = KeyframeAnimationOptions & {
	timeline: AnimationTimeline
	rangeStart: string
	rangeEnd: string
}

const ViewTimeline =
	typeof window === 'undefined' ? undefined : (window as { ViewTimeline?: ViewTimelineCtor }).ViewTimeline

/** Scroll-driven animations, and the WAAPI half of them this uses. */
export const supported =
	!!ViewTimeline && CSS.supports('(animation-timeline: view()) and (animation-range: entry)')

export type StickyOptions = {
	/** scroll a landing, and a take-off, lasts, as a fraction of the viewport's height — 0.4 */
	distance?: number
	/** the landing curve: a name from `eases`, or any ease-out — 'power2' */
	ease?: EaseName | Ease
	/** where the correction runs; everywhere else the element is plain sticky — pointer devices */
	media?: string
	/** 'compositor' needs scroll-driven animations, 'main' writes from the ticker, 'auto' takes
	 *  the compositor wherever there is one — 'auto' */
	engine?: 'auto' | 'compositor' | 'main'
	/** the frame loop the main-thread engine writes on, returning its unsubscribe —
	 *  requestAnimationFrame. Subscribed only while the parent is near the viewport, so it is
	 *  called again each time the parent comes back */
	ticker?: (fn: () => void) => () => void
}

export type Sticky = {
	readonly curve: Curve | null
	/** what is applying the correction right now, if anything */
	readonly engine: 'compositor' | 'main' | null
	/** measure again, for a change neither box's size shows */
	refresh: () => void
	/** set the correction down where it stands and stop following the scroll */
	freeze: () => void
	destroy: () => void
}

/* touch scrolls on the compositor, where a correction a frame late shows as a
   wobble and plain sticky does not; seen with both engines on a phone */
const POINTER = '(hover: hover) and (pointer: fine)'

/* keyframes per window; the corners and the windows' ends are added exactly */
const SAMPLES = 48

/*
 * The correction as keyframes over [into[0], outof[1]], offsets 0 to 1. Six of
 * them are exact. Sticky's two corners, because the correction's kink there
 * is what cancels sticky's. And all four ends of the two windows, where it is
 * zero: without the inner two, the last sample of the landing and the first
 * of the take-off are joined straight across the hold, and the element spends
 * all of it a fraction of a pixel off its line and drifting.
 */
export const keyframes = ({ into, outof, travel, at }: Curve) => {
	const [a, b] = [into[0], outof[1]]
	const xs = new Set([a, 0, into[1], outof[0], travel, b])

	for (const [from, to] of [into, outof]) {
		for (let i = 1; i < SAMPLES; i++) xs.add(from + ((to - from) * i) / SAMPLES)
	}

	return [...xs]
		.filter((x) => x >= a && x <= b)
		.sort((u, v) => u - v)
		.map((x) => ({ offset: (x - a) / (b - a), translate: `0 ${at(x)}px` }))
}

const raf = (fn: () => void) => {
	let id = requestAnimationFrame(function loop() {
		id = requestAnimationFrame(loop)
		fn()
	})

	return () => cancelAnimationFrame(id)
}

/*
 * A scroll container between the element and the page. Sticky pins against
 * the nearest one, and everything here is measured against the root's. Any
 * overflow but `visible` and `clip` makes one; body's is the viewport's own
 * unless the root has an overflow of its own to keep it.
 */
const scrolls = (from: Element) => {
	const root = document.documentElement

	for (let a: Element | null = from; a && a !== root; a = a.parentElement) {
		if (a === document.body && getComputedStyle(root).overflowY === 'visible') continue

		const overflow = getComputedStyle(a).overflowY
		if (overflow !== 'visible' && overflow !== 'clip') return true
	}

	return false
}

/*
 * Round off an element's sticky corners. It keeps its own position: sticky and
 * `top`; the correction goes on `translate`.
 */
const one = (
	el: HTMLElement,
	{ distance = 0.4, ease = 'power2', media = POINTER, engine = 'auto', ticker = raf }: StickyOptions = {},
): Sticky => {
	const parent = el.parentElement
	if (!parent) throw new Error('sticky: the element has no parent to stick within')

	const gate = matchMedia(media)
	const reduced = matchMedia('(prefers-reduced-motion: reduce)')
	const timeline =
		engine !== 'main' && supported && ViewTimeline ? new ViewTimeline({ subject: parent, axis: 'block' }) : null

	let c: Curve | null = null
	let engage = 0
	let anim: Animation | null = null
	let untick: (() => void) | null = null
	let frozen = false

	/* what the engine that is running was built from: the engage point and
	   the curve's travel, span and lead */
	let built: number[] | null = null

	const stop = () => {
		anim?.cancel()
		anim = null
		untick?.()
		untick = null
		built = null
		el.style.translate = ''
	}

	/* The correction where it stands, which a rect read now would take for
	   layout. Zero everywhere but inside the two windows. */
	const offset = () => parseFloat(getComputedStyle(el).translate.split(' ')[1] ?? '') || 0

	/*
	 * Reads the box where the flow put it, with sticky out of the way: null
	 * when there is no sticky to round off (a breakpoint that turns it off, a
	 * `top` left at auto, a scroll container of its own to pin against).
	 * Positions are kept in scroll past the parent's top meeting the
	 * viewport's, the parent timeline's own terms.
	 */
	const measure = (shift: number) => {
		const s = getComputedStyle(el)
		const top = parseFloat(s.top)
		if (s.position !== 'sticky' || !Number.isFinite(top) || scrolls(parent)) return null

		const position = el.style.position
		el.style.position = 'static'
		const r = el.getBoundingClientRect()
		const p = parent.getBoundingClientRect()
		el.style.position = position

		const ps = getComputedStyle(parent)
		const floor = p.bottom - parseFloat(ps.borderBottomWidth) - parseFloat(ps.paddingBottom)

		/* the rect has the correction in it where the engine is running; the
		   flow position is the rect with that taken back out */
		const flow = { top: r.top - shift, bottom: r.bottom - shift }

		const engage = flow.top - p.top - top
		const travel = Math.max(0, floor - flow.bottom - parseFloat(s.marginBottom))
		/* the small viewport: it holds still while a phone's toolbar comes and goes */
		const span = distance * document.documentElement.clientHeight
		const lead = scrollY + flow.top - top

		return { engage, span, curve: curve({ travel, span, ease, lead }), from: [engage, travel, span, lead] }
	}

	/*
	 * Measures, and builds an engine only when the numbers moved. Most calls
	 * find them where they were: the observer's first delivery straight after
	 * the first measure, a window resize and the observer both reporting one
	 * frame, a resize that changed neither box. Those cost the read and no
	 * more, where each used to cancel the animation and make it again.
	 */
	const refresh = () => {
		if (frozen) return

		const running = !!(anim || untick)
		const runs = gate.matches && !reduced.matches

		/* with no engine running, this clears a pose an earlier stick froze
		   onto the element */
		if (!runs || !running) stop()

		/* A running engine is left on for the read, and its offset is taken
		   out of the numbers. Taking the engine off instead meant a rebuild
		   for every call that found the element inside a window, and a phone
		   makes those calls in the middle of a scroll: its toolbar sliding
		   away is a resize. The animation dropped and rebuilt under the
		   finger showed as a jump. */
		const next = runs ? measure(running ? offset() : 0) : null

		if (next && built && next.from.every((v, i) => Math.abs(v - (built?.[i] ?? NaN)) < 0.01)) return

		stop()
		c = next?.curve ?? null
		if (!next) return

		engage = next.engage

		const { into, outof, at } = next.curve
		if (into[1] - into[0] + (outof[1] - outof[0]) <= 0) return

		built = next.from

		if (timeline) {
			const options: RangeOptions = {
				timeline,
				/* as strings: the object form wants a CSSUnitValue, and Firefox has
				   scroll-driven animations without the Typed OM to make one */
				rangeStart: `exit-crossing ${engage + into[0]}px`,
				rangeEnd: `exit-crossing ${engage + outof[1]}px`,
				fill: 'none',
			}

			anim = el.animate(keyframes(next.curve), options)
			return
		}

		let last = 0

		const tick = () => {
			const y = at(-parent.getBoundingClientRect().top - engage)
			if (y === last) return

			last = y
			el.style.translate = y ? `0 ${y}px` : ''
		}

		/*
		 * On the ticker only while the parent is near the viewport. Both windows
		 * lie inside the stretch where it is, give or take a landing, and
		 * outside it the element is off screen too; a page of these otherwise
		 * reads layout once each, every frame, for as long as it is open. It
		 * starts subscribed, and written once, so a rebuild in the middle of a
		 * window does not leave the element at plain sticky for the frame or
		 * two the observer takes to report.
		 */
		let off: (() => void) | null = ticker(tick)

		const near = new IntersectionObserver(
			(entries) => {
				if (entries[entries.length - 1]?.isIntersecting) off ??= ticker(tick)
				else {
					off?.()
					off = null
				}
			},
			{ rootMargin: `${Math.ceil(next.span)}px 0px` },
		)

		near.observe(parent)
		tick()

		untick = () => {
			near.disconnect()
			off?.()
			off = null
		}
	}

	const freeze = () => {
		if (frozen) return
		frozen = true

		/* committed inline, then the animation dropped: the element holds this
		   pose whatever the scroll does next. commitStyles throws on an element
		   that is not rendered, which has no pose to hold anyway. */
		if (anim) {
			try {
				anim.commitStyles()
			} catch {}
			anim.cancel()
			anim = null
		}

		untick?.()
		untick = null
	}

	/* a resize of either box is measured before the frame paints; a viewport
	   resize catches a `top` or a distance in viewport units */
	const ro = new ResizeObserver(() => refresh())
	ro.observe(el)
	ro.observe(parent)

	addEventListener('resize', refresh)
	gate.addEventListener('change', refresh)
	reduced.addEventListener('change', refresh)

	/* made before its stylesheet applied, the element is not sticky yet and
	   there is nothing to measure: once more when the page has loaded */
	if (document.readyState !== 'complete') addEventListener('load', refresh, { once: true })

	refresh()

	return {
		get curve() {
			return c
		},
		get engine() {
			return anim ? 'compositor' : untick ? 'main' : null
		},
		refresh,
		freeze,
		destroy() {
			ro.disconnect()
			removeEventListener('load', refresh)
			removeEventListener('resize', refresh)
			gate.removeEventListener('change', refresh)
			reduced.removeEventListener('change', refresh)

			/* a frozen element keeps its pose: its page is still on screen */
			if (frozen) return
			stop()
		},
	}
}

/*
 * The selectors of every rule that declares `position: sticky`, at any depth:
 * inside a media query, a layer, a container query, an import. A rule nested
 * in another gives its own selector without its parent's, which matches more
 * than the rule does; the extra elements are not sticky, and one that is not
 * sticky is left alone. `unread` counts the sheets that would not open: one
 * from another origin, served without CORS, throws on `cssRules`.
 */
export const stickySelectors = (sheets: Iterable<{ readonly cssRules: Iterable<unknown> }>) => {
	type Rule = {
		selectorText?: string
		style?: { position?: string }
		cssRules?: Iterable<unknown>
		styleSheet?: { readonly cssRules: Iterable<unknown> } | null
	}

	const selectors: string[] = []
	let unread = 0

	const walk = (rules: Iterable<unknown>) => {
		for (const rule of rules as Iterable<Rule>) {
			if (rule.selectorText && rule.style?.position === 'sticky') selectors.push(rule.selectorText)
			if (rule.cssRules) walk(rule.cssRules)
			if (rule.styleSheet) open(rule.styleSheet)
		}
	}

	const open = (sheet: { readonly cssRules: Iterable<unknown> }) => {
		try {
			walk(sheet.cssRules)
		} catch {
			unread++
		}
	}

	for (const sheet of sheets) open(sheet)

	return { selectors, unread }
}

/**
 * The elements a page's own CSS makes sticky, at this width or any other:
 * what its stylesheets' sticky rules match, and anything made sticky inline.
 */
export const findSticky = (root: Document = document): HTMLElement[] => {
	const { selectors, unread } = stickySelectors([...root.styleSheets, ...root.adoptedStyleSheets])
	const found = new Set<HTMLElement>()

	/* one at a time: a selector this cannot query (a pseudo-element) would
	   otherwise take the rest of the list down with it */
	for (const selector of [...selectors, '[style*="sticky"]']) {
		try {
			for (const el of root.querySelectorAll<HTMLElement>(selector)) found.add(el)
		} catch {}
	}

	/* a sheet that would not open may hold sticky rules of its own: fall back
	   to asking every element, which finds what is sticky right now */
	if (unread) {
		for (const el of root.querySelectorAll<HTMLElement>('*')) {
			if (getComputedStyle(el).position === 'sticky') found.add(el)
		}
	}

	return [...found]
}

export type StickyAll = {
	/** every element taken on, and its stick */
	readonly sticks: ReadonlyMap<HTMLElement, Sticky>
	/** look again: a sticky that arrived since gets a stick, one that left the document loses its */
	scan: () => void
	/** measure every stick again */
	refresh: () => void
	/** set every correction down where it stands */
	freeze: () => void
	destroy: () => void
}

/* `data-sticky-ease="off"` leaves an element out; an ease's name there, and
   `data-sticky-distance`, are that one element's own */
const own = (el: HTMLElement, options: StickyOptions): StickyOptions | null => {
	const { stickyEase: ease, stickyDistance } = el.dataset
	if (ease === 'off') return null

	const distance = Number(stickyDistance)

	return {
		...options,
		...(ease && Object.hasOwn(eases, ease) ? { ease: ease as EaseName } : null),
		...(stickyDistance && Number.isFinite(distance) ? { distance } : null),
	}
}

/*
 * Every sticky on the page, or every match of a selector, each with a stick
 * of its own and one handle for the lot.
 */
function all(options?: StickyOptions): StickyAll
function all(selector: string, options?: StickyOptions): StickyAll
function all(first?: string | StickyOptions, second: StickyOptions = {}): StickyAll {
	const selector = typeof first === 'string' ? first : null
	const options = (typeof first === 'string' ? second : first) ?? {}

	const sticks = new Map<HTMLElement, Sticky>()
	let frozen = false

	const scan = () => {
		if (frozen) return

		for (const [el, stick] of sticks) {
			if (el.isConnected) continue

			stick.destroy()
			sticks.delete(el)
		}

		const found = selector ? document.querySelectorAll<HTMLElement>(selector) : findSticky()

		for (const el of found) {
			if (sticks.has(el) || !el.parentElement) continue

			const mine = own(el, options)
			if (mine) sticks.set(el, one(el, mine))
		}
	}

	scan()

	/*
	 * Called before the page's stylesheets are in, the search has no rules to
	 * read and finds nothing. That is not a rare order: a module script can
	 * run ahead of a stylesheet that is still loading, and WebKit was seen to
	 * do it. So it looks once more when the page has loaded.
	 */
	const loaded = () => scan()
	if (document.readyState !== 'complete') addEventListener('load', loaded, { once: true })

	return {
		sticks,
		scan,
		refresh: () => sticks.forEach((stick) => stick.refresh()),
		freeze() {
			frozen = true
			sticks.forEach((stick) => stick.freeze())
		},
		destroy() {
			removeEventListener('load', loaded)
			sticks.forEach((stick) => stick.destroy())
			sticks.clear()
		},
	}
}

/**
 * Round off an element's sticky corners. It keeps its own position: sticky and
 * `top`; the correction goes on `translate`. `sticky.all()` does it for
 * every sticky on the page.
 */
export const sticky = Object.assign(one, { all })
