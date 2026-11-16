import { describe, expect, it } from 'vitest'
import { curve, eases, keyframes, stickySelectors } from './index.js'

/* a central difference, well inside a window */
const slope = (f: (x: number) => number, x: number, h = 1e-3) => (f(x + h) - f(x - h)) / (2 * h)

const sticky = (travel: number) => (x: number) => Math.min(Math.max(x, 0), travel)

describe('curve', () => {
	/* power2 leaves at slope 3: a 360 window lands over 120 of ground */
	const c = curve({ travel: 1000, span: 360, ease: 'power2' })

	it('places the windows around sticky’s corners', () => {
		expect(c.into[0]).toBeCloseTo(-120, 3)
		expect(c.into[1]).toBeCloseTo(240, 3)
		expect(c.outof[0]).toBeCloseTo(760, 3)
		expect(c.outof[1]).toBeCloseTo(1120, 3)
	})

	it('is sticky itself outside the windows', () => {
		for (const x of [-500, -121, 241, 500, 759, 1121, 1600]) {
			expect(c.at(x)).toBe(0)
			expect(c.clamp(x)).toBe(sticky(1000)(x))
		}
	})

	it('meets each window at the speed sticky has there, so no edge is a corner', () => {
		const e = 1e-2
		expect(slope(c.clamp, c.into[0] + e)).toBeCloseTo(0, 1)
		expect(slope(c.clamp, c.into[1] - e)).toBeCloseTo(1, 1)
		expect(slope(c.clamp, c.outof[0] + e)).toBeCloseTo(1, 1)
		expect(slope(c.clamp, c.outof[1] - e)).toBeCloseTo(0, 1)
	})

	it('has no jump anywhere', () => {
		for (const x of [c.into[0], 0, c.into[1], c.outof[0], 1000, c.outof[1]]) {
			expect(Math.abs(c.clamp(x + 1e-6) - c.clamp(x - 1e-6))).toBeLessThan(1e-3)
		}
	})

	it('never runs backwards and never leaves sticky’s range', () => {
		let prev = -Infinity
		for (let x = -300; x <= 1300; x += 0.5) {
			const y = c.clamp(x)
			expect(y).toBeGreaterThanOrEqual(prev - 1e-9)
			expect(y).toBeGreaterThanOrEqual(-1e-9)
			expect(y).toBeLessThanOrEqual(1000 + 1e-9)
			prev = y
		}
	})

	it('holds the element lowest at sticky’s own corner', () => {
		/* 120 · (1 − E(1/3)) = 120 · 8/27 */
		expect(c.at(0)).toBeCloseTo((120 * 8) / 27, 6)
		for (const x of [-60, 60, 120]) expect(c.at(x)).toBeLessThan(c.at(0))
	})

	it('takes off on the landing mirrored', () => {
		for (const d of [1, 30, 90, 150, 300, 359]) {
			expect(c.at(c.outof[1] - d)).toBeCloseTo(-c.at(c.into[0] + d), 9)
		}
	})

	it('shrinks both windows to meet when the travel is short', () => {
		const s = curve({ travel: 200, span: 360 })
		expect(s.into[1]).toBeCloseTo(s.outof[0], 9)
		expect(s.into[1]).toBeCloseTo(100, 9)

		let prev = -Infinity
		for (let x = -200; x <= 400; x += 0.5) {
			const y = s.clamp(x)
			expect(y).toBeGreaterThanOrEqual(prev - 1e-9)
			expect(y).toBeLessThanOrEqual(200 + 1e-9)
			prev = y
		}
	})

	it('lands in what there is when the page starts near the line', () => {
		const s = curve({ travel: 1000, span: 360, lead: 50 })
		expect(s.into[0]).toBeCloseTo(-50, 9)
		expect(slope(s.clamp, s.into[0] + 1e-2)).toBeCloseTo(0, 1)
		expect(slope(s.clamp, s.into[1] - 1e-2)).toBeCloseTo(1, 1)
	})

	it('takes any ease-out, and keeps the window it was given', () => {
		const out = (t: number) => Math.sin((t * Math.PI) / 2)
		const s = curve({ travel: 1000, span: 360, ease: out })
		expect(s.into[1] - s.into[0]).toBeCloseTo(360, 3)
		expect(slope(s.clamp, s.into[0] + 1e-2)).toBeCloseTo(0, 1)

		const x = curve({ travel: 1000, span: 360, ease: 'expo' })
		expect(x.into[1] - x.into[0]).toBeCloseTo(360, 3)
		expect(-x.into[0]).toBeCloseTo((360 * (1 - 2 ** -10)) / (10 * Math.LN2), 6)
	})

	it('leaves the element plain sticky for an ease that cannot round a corner', () => {
		for (const ease of [(t: number) => t, (t: number) => t * t]) {
			const s = curve({ travel: 1000, span: 360, ease })
			for (const x of [-100, 0, 100, 500, 1000, 1100]) {
				expect(s.at(x)).toBe(0)
				expect(s.clamp(x)).toBe(sticky(1000)(x))
			}
		}
	})

	it('names only ease-outs', () => {
		for (const E of Object.values(eases)) {
			expect(E(0)).toBe(0)
			expect(E(1)).toBe(1)
			expect((E(1e-6) - E(0)) / 1e-6).toBeGreaterThan(1)
			for (let t = 0; t < 1; t += 1 / 64) expect(E(t + 1 / 64)).toBeGreaterThan(E(t))
		}
	})
})

describe('curve, handed something that is not an ease', () => {
	it('leaves empty windows and plain sticky, never NaN', () => {
		for (const ease of [() => NaN, () => 1, (t: number) => 1 - t]) {
			const s = curve({ travel: 1000, span: 360, ease })
			expect(s.into).toEqual([-0, 0])
			expect(s.outof).toEqual([1000, 1000])
			for (const x of [-100, 0, 500, 1000, 1100]) expect(s.clamp(x)).toBe(sticky(1000)(x))
		}
	})
})

describe('keyframes', () => {
	const y = (frame: { translate: string }) => parseFloat(frame.translate.split(' ')[1] ?? '')

	/* the frame at a scroll position, if one sits exactly there */
	const frameAt = (c: ReturnType<typeof curve>, x: number) => {
		const offset = (x - c.into[0]) / (c.outof[1] - c.into[0])
		return keyframes(c).find((frame) => Math.abs(frame.offset - offset) < 1e-12)
	}

	for (const ease of ['power1', 'power2', 'power3', 'expo'] as const) {
		const c = curve({ travel: 1000, span: 360, ease })
		const frames = keyframes(c)

		it(`${ease}: runs from 0 to 1 and never steps back`, () => {
			expect(frames[0]?.offset).toBe(0)
			expect(frames.at(-1)?.offset).toBe(1)
			for (let i = 1; i < frames.length; i++) expect(frames[i]!.offset).toBeGreaterThan(frames[i - 1]!.offset)
		})

		it(`${ease}: has sticky's two corners as frames of their own, at the curve's own value`, () => {
			expect(y(frameAt(c, 0)!)).toBeCloseTo(c.at(0), 9)
			expect(y(frameAt(c, 1000)!)).toBeCloseTo(c.at(1000), 9)
			expect(y(frameAt(c, 0)!)).toBeGreaterThan(0)
			expect(y(frameAt(c, 1000)!)).toBeLessThan(0)
		})

		/* the regression: with no frame at the inner ends, the last sample of
		   the landing ran straight to the first of the take-off, and the hold
		   sat up to 0.08px off the line (power1), drifting the whole way */
		it(`${ease}: is exactly zero at all four ends of the windows, so the hold is`, () => {
			for (const x of [c.into[0], c.into[1], c.outof[0], c.outof[1]]) expect(y(frameAt(c, x)!)).toBe(0)

			const offset = (x: number) => (x - c.into[0]) / (c.outof[1] - c.into[0])
			const held = frames.filter((f) => f.offset >= offset(c.into[1]) && f.offset <= offset(c.outof[0]))
			expect(held.length).toBe(2)
			for (const frame of held) expect(y(frame)).toBe(0)
		})
	}

	it('keeps its frames in order when the windows shrink to meet', () => {
		const frames = keyframes(curve({ travel: 200, span: 360 }))
		for (let i = 1; i < frames.length; i++) expect(frames[i]!.offset).toBeGreaterThan(frames[i - 1]!.offset)
		for (const frame of frames) expect(Number.isFinite(y(frame))).toBe(true)
	})

	it('has no landing to sample when the page starts on the line', () => {
		const frames = keyframes(curve({ travel: 1000, span: 360, lead: 0 }))
		expect(frames[0]).toEqual({ offset: 0, translate: '0 0px' })
		expect(y(frames[1]!)).toBe(0)
	})
})

/* rules as the CSSOM hands them over, down to the three fields that are read */
const rule = (selectorText: string, position?: string, cssRules?: unknown[]) => ({
	selectorText,
	style: { position },
	...(cssRules ? { cssRules } : null),
})

const group = (...cssRules: unknown[]) => ({ cssRules })

describe('stickySelectors', () => {
	it('takes the rules that declare sticky and no others', () => {
		const sheet = group(rule('.rail', 'sticky'), rule('.box', 'relative'), rule('.plain'))
		expect(stickySelectors([sheet])).toEqual({ selectors: ['.rail'], unread: 0 })
	})

	it('finds them at any depth: a media query, a layer inside it', () => {
		const sheet = group(rule('.a', 'sticky'), group(rule('.b', 'sticky'), group(rule('.c', 'sticky'))))
		expect(stickySelectors([sheet]).selectors).toEqual(['.a', '.b', '.c'])
	})

	it('reads a rule nested in another, and keeps the outer one when it is sticky too', () => {
		const sheet = group(rule('.card', 'sticky', [rule('& .head', 'sticky'), rule('& .body', 'static')]))
		expect(stickySelectors([sheet]).selectors).toEqual(['.card', '& .head'])
	})

	it('follows an import into its sheet', () => {
		const sheet = group({ styleSheet: group(rule('.imported', 'sticky')) }, rule('.own', 'sticky'))
		expect(stickySelectors([sheet]).selectors).toEqual(['.imported', '.own'])
	})

	it('counts a sheet that will not open, and reads the rest', () => {
		const closed = {
			get cssRules(): unknown[] {
				throw new Error('SecurityError')
			},
		}

		expect(stickySelectors([closed, group(rule('.rail', 'sticky'))])).toEqual({ selectors: ['.rail'], unread: 1 })
		expect(stickySelectors([group({ styleSheet: closed })]).unread).toBe(1)
	})

	it('has nothing to say about a page with no sheets', () => {
		expect(stickySelectors([])).toEqual({ selectors: [], unread: 0 })
	})
})
