/*
 * @alpacka/smooth-stick — position: sticky with its two corners rounded off.
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
 * new measure.
 *
 * Without scroll-driven animations (Firefox today) the same curve is written
 * from a ticker: requestAnimationFrame, unless the caller hands in its own, so
 * a page driven by a smooth scroll (Lenis) can write it in the frame that
 * scroll moves in. A write from script lands a frame behind a threaded scroll,
 * which is also why touch is left out by default: on a phone the compositor
 * owns the scroll.
 *
 * ── Left alone ──
 *
 * `top` stickies on the block axis of the root scroller. A `bottom` or `left`
 * sticky is the same maths mirrored and is not built; a nested scroll
 * container would need its own origin for the landing's lead and for the
 * fallback's reads. The parent is taken to be the box the element sticks
 * within, and a grid item counts when its area is the grid's whole height.
 * While it runs, the element's `translate` belongs to this.
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

	const need = (m - 1) * (land + lift)
	if (rounds && need > travel) {
		land *= travel / need
		lift *= travel / need
	}

	const into: [number, number] = [-land, (m - 1) * land]
	const outof: [number, number] = [travel - (m - 1) * lift, travel + lift]

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
type RangeOffset = { rangeName: string; offset: CSSUnitValue }
type RangeOptions = KeyframeAnimationOptions & {
	timeline: AnimationTimeline
	rangeStart: RangeOffset
	rangeEnd: RangeOffset
}

const ViewTimeline =
	typeof window === 'undefined' ? undefined : (window as { ViewTimeline?: ViewTimelineCtor }).ViewTimeline

/** Scroll-driven animations, and the WAAPI half of them this uses. */
export const supported =
	!!ViewTimeline && CSS.supports('(animation-timeline: view()) and (animation-range: entry)')

export type SmoothStickOptions = {
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
	 *  requestAnimationFrame */
	ticker?: (fn: () => void) => () => void
}

export type SmoothStick = {
	readonly curve: Curve | null
	/** what is applying the correction right now, if anything */
	readonly engine: 'compositor' | 'main' | null
	/** measure again, for a change neither box's size shows */
	refresh: () => void
	/** set the correction down where it stands and stop following the scroll */
	freeze: () => void
	destroy: () => void
}

/* touch scrolls on the compositor, where a correction written a frame late
   shows as a wobble and plain sticky does not */
const POINTER = '(hover: hover) and (pointer: fine)'

/* keyframes per window; the corners themselves are added exactly */
const SAMPLES = 48

const raf = (fn: () => void) => {
	let id = requestAnimationFrame(function loop() {
		id = requestAnimationFrame(loop)
		fn()
	})

	return () => cancelAnimationFrame(id)
}

/*
 * Round off an element's sticky corners. It keeps its own position: sticky and
 * `top`; the correction goes on `translate`.
 */
export const smoothStick = (
	el: HTMLElement,
	{ distance = 0.4, ease = 'power2', media = POINTER, engine = 'auto', ticker = raf }: SmoothStickOptions = {},
): SmoothStick => {
	const parent = el.parentElement
	if (!parent) throw new Error('smoothStick: the element has no parent to stick within')

	const gate = matchMedia(media)
	const reduced = matchMedia('(prefers-reduced-motion: reduce)')
	const timeline =
		engine !== 'main' && supported && ViewTimeline ? new ViewTimeline({ subject: parent, axis: 'block' }) : null

	let c: Curve | null = null
	let engage = 0
	let anim: Animation | null = null
	let untick: (() => void) | null = null
	let frozen = false

	const stop = () => {
		anim?.cancel()
		anim = null
		untick?.()
		untick = null
		el.style.translate = ''
	}

	/*
	 * Reads the box where the flow put it, with sticky out of the way: false
	 * when there is no sticky to round off (a breakpoint that turns it off, a
	 * `top` left at auto). Positions are kept in scroll past the parent's top
	 * meeting the viewport's, the parent timeline's own terms.
	 */
	const measure = () => {
		const s = getComputedStyle(el)
		const top = parseFloat(s.top)
		if (s.position !== 'sticky' || !Number.isFinite(top)) return false

		const position = el.style.position
		el.style.position = 'static'
		const r = el.getBoundingClientRect()
		const p = parent.getBoundingClientRect()
		el.style.position = position

		const ps = getComputedStyle(parent)
		const floor = p.bottom - parseFloat(ps.borderBottomWidth) - parseFloat(ps.paddingBottom)

		engage = r.top - p.top - top
		c = curve({
			travel: Math.max(0, floor - r.bottom - parseFloat(s.marginBottom)),
			/* the small viewport: it holds still while a phone's toolbar comes and goes */
			span: distance * document.documentElement.clientHeight,
			ease,
			lead: scrollY + r.top - top,
		})

		return true
	}

	const keyframes = ({ into, outof, travel, at }: Curve) => {
		const [a, b] = [into[0], outof[1]]
		const xs = new Set([a, 0, travel, b])

		for (const [from, to] of [into, outof]) {
			for (let i = 1; i < SAMPLES; i++) xs.add(from + ((to - from) * i) / SAMPLES)
		}

		return [...xs]
			.filter((x) => x >= a && x <= b)
			.sort((u, v) => u - v)
			.map((x) => ({ offset: (x - a) / (b - a), translate: `0 ${at(x)}px` }))
	}

	const refresh = () => {
		if (frozen) return
		stop()
		if (!gate.matches || reduced.matches || !measure() || !c) return

		const { into, outof, at } = c
		if (into[1] - into[0] + (outof[1] - outof[0]) <= 0) return

		if (timeline) {
			const options: RangeOptions = {
				timeline,
				rangeStart: { rangeName: 'exit-crossing', offset: CSS.px(engage + into[0]) },
				rangeEnd: { rangeName: 'exit-crossing', offset: CSS.px(engage + outof[1]) },
				fill: 'none',
			}

			anim = el.animate(keyframes(c), options)
			return
		}

		let last = 0

		untick = ticker(() => {
			const y = at(-parent.getBoundingClientRect().top - engage)
			if (y === last) return

			last = y
			el.style.translate = y ? `0 ${y}px` : ''
		})
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
			removeEventListener('resize', refresh)
			gate.removeEventListener('change', refresh)
			reduced.removeEventListener('change', refresh)

			/* a frozen element keeps its pose: its page is still on screen */
			if (frozen) return
			stop()
		},
	}
}
