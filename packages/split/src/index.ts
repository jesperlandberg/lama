/*
 * @lama/split — the lines the browser painted, one wrapper each.
 *
 * A block of text in, one `div` per line out — each inside a `div` that
 * clips it, so a line can be moved under its own mask — and a revert that
 * puts every original node back where it was. Nothing here decides where a
 * line breaks: the browser already did, and this only reads the answer back
 * off the text and cuts the DOM at those points.
 *
 * No dependencies, no framework, nothing about animation: the caller owns
 * the tween and the moment.
 *
 * ── Reads, then writes ──
 *
 * One instance takes any number of blocks, and every block is measured
 * before any is cut. Measuring is layout reads (client rects, computed
 * styles) and cutting is DOM writes; a read after a write makes the browser
 * lay the page out again, so a splitter that cuts one block and then
 * measures the next pays one layout per block. Here a page's worth costs
 * one. The measuring sits behind one method (`Reader.run`) so a cheaper
 * strategy — canvas measurement, predicted breaks — can stand in for it
 * without touching the cut or the revert.
 *
 * ── Where a line starts ──
 *
 * Words are measured one Range at a time. A word that starts LEFT of where
 * the previous word ended is the first word of a new line: boxes on one
 * line tile left to right, so nothing on the same line can step back, and a
 * new line's first word always begins left of the previous line's last
 * right edge, whatever the alignment. The test needs no line-height and is
 * immune to the trap that catches rect-overlap splitters — at a leading
 * tighter than the face's own content area (50px type on a 45px line: 63px
 * rects on a 45px pitch) the rects of two consecutive lines OVERLAP, and a
 * test that reads overlap as "same line" merges them. A raised superscript
 * or a smaller word on the same baseline steps right like everything else,
 * so it stays on its line. Vertical distance is kept as a fallback for the
 * case the geometry cannot show, a line that starts where the previous one
 * ended.
 *
 * A word the browser broke inside — a hard hyphen at the line's end — has
 * rects on two rows. The break is found by halving: the shortest prefix of
 * the word whose rects span two rows ends the first. A prefix is used rather
 * than the glyphs' own rects because the glyphs around a break report their
 * row differently in Chrome and Firefox.
 *
 * ── The slack ──
 *
 * Display type runs at a leading under 1em, so caps and descenders stand
 * outside the line box, and a mask sized to that box crops them while the
 * line moves. Each line carries `pad` of padding above and below, which
 * grows the box its mask clips to; the mask carries the same as a negative
 * margin, which hands the space back to the flow; and the block goes
 * column-flex for the split's lifetime, because as blocks two adjacent
 * masks' negative margins would collapse into one and every gap would keep
 * half the padding. Flex items never collapse, so the block keeps its
 * height to the pixel. All three go with the revert.
 *
 * ── What is left alone ──
 *
 * Only running text is cut. A block-level piece that is not a block of text
 * (a flex row, a table, an image between paragraphs) ends the run around it
 * and is not touched; an inline-level box that is not text (an inline-block
 * superscript, a replaced element) rides whole inside its line; anything
 * out of flow — absolute, fixed, floated — is neither measured nor moved,
 * and if it holds text of its own it is split inside itself, in place.
 * Hidden content is skipped. A block of text nested in the block (a heading
 * and its paragraphs in one wrapper; the spans of a flex row, which are
 * blocks by then) is split inside itself.
 *
 * ── The revert ──
 *
 * Cutting moves the original nodes into the line blocks and, where an
 * inline element or a text node straddles two lines, clones the part that
 * continues; the original always keeps the head. So the way back is to put
 * every original node's children back as they were: each original is
 * adopted out of whatever line or clone it sits in, and the wrappers and
 * clones fall away. A text node's characters are restored only where the
 * cut's own tail is still what it holds — a value written into the node in
 * the meantime is newer than the record and stays. A block that lost its
 * wrappers to someone else's `textContent =` is left as they left it.
 *
 * ── Looking the same ──
 *
 * The split must not show. Each line block holds exactly the text of one
 * painted line, at the block's own width, so it wraps nowhere; the block's
 * `text-indent` reaches the first line and is zeroed on the rest, since it
 * inherits; a justified block gets `text-align-last: justify` on every line
 * but its last, since each line is now a block's last line; an inline
 * element that straddles two lines is cloned, so its decoration continues
 * and its padding draws at the start of the first and the end of the last,
 * as the browser slices it; and under `white-space: pre-*` the segment break
 * at a cut is trimmed off the seam, since it would otherwise render as a
 * forced break at the end of a line block. Kerning is lost across a cut,
 * which is only ever a line break — where the browser had none either.
 *
 * Not handled, by choice: words and characters as units, `hyphens: auto`
 * (its hyphen is drawn, not in the text), `::first-letter` / `::first-line`,
 * floats inside the text, leading preserved spaces after a break under
 * `pre-wrap`, a glyph overhanging the block's edge (an italic's, clipped by
 * the mask like any overflow), writing modes other than horizontal
 * left-to-right, and word segmentation for scripts without spaces — a word
 * is a run of non-whitespace.
 *
 * Performance, in order: one layout for every block in a call; computed
 * styles read once per element; one Range reused for every read and one
 * for every cut; a revert that touches only what moved. The next steps if
 * a page ever needs them: a text node's own client rects give its line
 * count in one read and a halving search finds each boundary, which beats
 * a read per word on long copy; and a canvas measurer that predicts breaks
 * from cached widths, which never touches layout at all but has to
 * reproduce indent, nested sizes, kerning and the font stack to be exact.
 */

export type LamaSplitOptions = {
	/** the slack either side of each line box, in the block's own em; none by default */
	pad?: string
	/** class names for the line and mask wrappers, on top of `data-line` / `data-mask` */
	classes?: { line?: string; mask?: string }
}

export type Line = {
	/** the line block; move this */
	el: HTMLElement
	/** the clip around it — never transformed, so its box is honest while the line is parked */
	mask: HTMLElement
	/** the block the line came from */
	target: HTMLElement
	/** the line-height of the block that holds it, px — the distance between two rows */
	pitch: number
	/** the slack above the line box, px — `mask top + pad` is the line box's top at rest */
	pad: number
}

/* ── the plan ─────────────────────────────────────────────────────────── */

/* a line's first character, or the element it starts before; resolved to a
   Range start at cut time, since an element's index is only stable then */
type Boundary = { node: Text; offset: number } | { before: ChildNode }

type Run = {
	container: HTMLElement
	/** the run's first node */
	first: ChildNode
	/** the node after the run, or null for the container's end — every cut ends here */
	anchor: ChildNode | null
	/** the lines' starts after the first */
	starts: Boundary[]
}

type Block = {
	el: HTMLElement
	pitch: number
	pad: number
	indent: boolean
	justify: boolean
	/** `white-space` keeps segment breaks, so the one at a cut must go */
	pre: boolean
	runs: Run[]
	/* the block's own inline display, for the revert */
	display: string
	direction: string
	/* its first mask once cut, to tell at revert whether it is still the block's */
	mask: Element | null
}

type Plan = {
	target: HTMLElement
	blocks: Block[]
	/* the record for the revert: every element's children and every text
	   node's characters, as they were */
	children: Map<Element, ChildNode[]>
	text: Map<Text, string>
	/* what the cut left in every text node */
	after: Map<Text, string>
	lines: Line[]
	reverted: boolean
}

type Box = { left: number; right: number; top: number; bottom: number }

type Kind = 'hidden' | 'out' | 'inline' | 'atom' | 'block' | 'other'

/** display values whose inline content lays out as lines of their own */
const BLOCKS = new Set(['block', 'list-item', 'flow-root', 'table-cell', 'table-caption'])

/** elements that are one box however they are displayed */
const REPLACED = new Set(['IMG', 'VIDEO', 'CANVAS', 'SVG', 'IFRAME', 'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'OBJECT', 'EMBED'])

const WORDS = /\S+/g

const childIndex = (node: Node) => Array.prototype.indexOf.call(node.parentNode?.childNodes ?? [], node)

const centre = (b: Box) => (b.top + b.bottom) / 2

const union = (a: Box, b: Box): Box => ({
	left: Math.min(a.left, b.left),
	right: Math.max(a.right, b.right),
	top: Math.min(a.top, b.top),
	bottom: Math.max(a.bottom, b.bottom),
})

/* the rows a word's rects sit on: a rect joins a row when its centre is
   within half a pitch of the row's first — the browser splits one line's
   text into several rects at a font-fallback boundary too, and those share
   a row */
const rowsOf = (rects: DOMRectList, half: number): Box[] => {
	const rows: Box[] = []
	const keys: number[] = []

	for (const r of Array.from(rects)) {
		if (!r.width && !r.height) continue

		const c = (r.top + r.bottom) / 2
		const i = keys.findIndex((k) => Math.abs(k - c) < half)

		if (i < 0) {
			rows.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
			keys.push(c)
		} else {
			rows[i] = union(rows[i]!, r)
		}
	}

	return rows
}

/* ── read ─────────────────────────────────────────────────────────────── */

class Reader {
	private styles = new Map<Element, CSSStyleDeclaration>()
	private range = document.createRange()

	constructor(private padEm: number) {}

	done() {
		this.range.detach()
	}

	private styleOf(el: Element) {
		let s = this.styles.get(el)
		if (!s) this.styles.set(el, (s = getComputedStyle(el)))
		return s
	}

	private classify(el: Element): Kind {
		const s = this.styleOf(el)

		if (s.display === 'none') return 'hidden'
		if (s.position === 'absolute' || s.position === 'fixed' || s.float !== 'none') return 'out'
		if (REPLACED.has(el.tagName)) return 'atom'
		if (s.display === 'inline' || s.display === 'contents') return 'inline'
		if (s.display.startsWith('inline')) return 'atom'
		if (BLOCKS.has(s.display)) return 'block'

		return 'other'
	}

	plan(target: HTMLElement): Plan {
		const plan: Plan = { target, blocks: [], children: new Map(), text: new Map(), after: new Map(), lines: [], reverted: false }

		this.record(target, plan)
		this.container(target, plan)

		return plan
	}

	/* the record, whole subtree: cheap, and the revert only touches what moved */
	private record(el: Element, plan: Plan) {
		plan.children.set(el, [...el.childNodes])

		for (const child of el.childNodes) {
			if (child instanceof Text) plan.text.set(child, child.data)
			else if (child instanceof Element) this.record(child, plan)
		}
	}

	/* a container's children, in runs of inline content between its block-level
	   children; every block-level child that holds text is a container of its own */
	private container(el: HTMLElement, plan: Plan) {
		const s = this.styleOf(el)
		const size = parseFloat(s.fontSize) || 0
		const block: Block = {
			el,
			pitch: parseFloat(s.lineHeight) || size * 1.2,
			pad: size * this.padEm,
			indent: s.textIndent !== '0px',
			justify: s.textAlign === 'justify',
			pre: s.whiteSpace.startsWith('pre') || s.whiteSpace === 'break-spaces',
			runs: [],
			display: el.style.display,
			direction: el.style.flexDirection,
			mask: null,
		}

		let first: ChildNode | null = null

		const end = (anchor: ChildNode | null) => {
			if (!first) return
			const run = this.run(el, first, anchor, block)
			if (run) block.runs.push(run)
			first = null
		}

		for (const child of Array.from(el.childNodes)) {
			if (!(child instanceof Element)) {
				first ??= child
				continue
			}

			const kind = this.classify(child)

			if (kind === 'inline' || kind === 'atom') {
				first ??= child
				continue
			}

			end(child)

			/* a block of text inside, or an out-of-flow box holding one, is split
			   in place; a flex row, a table, a picture is not text and stays */
			if (kind === 'block' || kind === 'out') this.container(child as HTMLElement, plan)
		}

		end(null)

		if (block.runs.length) plan.blocks.push(block)
	}

	/* measure one run: every word and every atom in order, and where a new
	   line begins among them */
	private run(container: HTMLElement, first: ChildNode, anchor: ChildNode | null, block: Block): Run | null {
		const half = block.pitch / 2
		const starts: Boundary[] = []

		/* the last box on the current line that has any width, and the line's
		   own centre — set by its first box */
		let prev: Box | null = null
		let row: number | null = null

		const consider = (box: Box, boundary: Boundary) => {
			const c = centre(box)

			if (row === null) {
				row = c
			} else {
				/* a step back along the line, on a lower row: a new line. Or,
				   failing the geometry, a box a whole half-pitch lower */
				const back = prev !== null && box.left < prev.right - 1 && c > row + 1
				const lower = c - row >= half

				if (back || lower) {
					starts.push(boundary)
					row = c
					prev = null
				}
			}

			if (box.right - box.left > 0) prev = box
		}

		/* a word, or the rows of a word the browser broke inside */
		const word = (node: Text, start: number, end: number) => {
			const range = this.range
			range.setStart(node, start)
			range.setEnd(node, end)

			const rows = rowsOf(range.getClientRects(), half)
			if (!rows.length) return

			consider(rows[0]!, { node, offset: start })

			/* the break before each further row: the shortest prefix whose rects
			   reach that many rows ends the row before, with its last character */
			let from = start
			for (let r = 1; r < rows.length; r++) {
				let low = from + 1
				let high = end

				while (low < high) {
					const mid = (low + high) >> 1
					range.setStart(node, start)
					range.setEnd(node, mid)
					if (rowsOf(range.getClientRects(), half).length > r) high = mid
					else low = mid + 1
				}

				const at = low - 1
				if (at <= from || at >= end) break

				starts.push({ node, offset: at })
				row = centre(rows[r]!)
				prev = rows[r]!
				from = at
			}
		}

		const walk = (node: ChildNode) => {
			if (node instanceof Text) {
				for (const m of node.data.matchAll(WORDS)) word(node, m.index, m.index + m[0].length)
				return
			}

			if (!(node instanceof Element)) return

			const kind = this.classify(node)

			if (kind === 'inline') {
				for (const child of node.childNodes) walk(child)
			} else if (kind === 'atom') {
				const r = node.getBoundingClientRect()
				if (r.width || r.height) consider({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }, { before: node })
			}
			/* hidden and out-of-flow: not on the line */
		}

		for (let node: ChildNode | null = first; node && node !== anchor; node = node.nextSibling) walk(node)

		/* nothing measured — whitespace, a lone <br> — is nothing to cut */
		if (row === null) return null

		return { container, first, anchor, starts }
	}
}

/* ── write ────────────────────────────────────────────────────────────── */

/*
 * A line's start as a Range start. A boundary at the very start of an
 * inline element's text is lifted to before the element, climbing while it
 * is the first thing in its parent: cut inside, the element would be cloned
 * to carry the line and its original left behind empty on the line before —
 * nothing to see, but an empty link is a tab stop.
 */
const resolve = (b: Boundary, container: Element): { node: Node; offset: number } => {
	if (!('before' in b) && b.offset > 0) return { node: b.node, offset: b.offset }

	let node: Node = 'before' in b ? b.before : b.node
	while (node.parentNode && node.parentNode !== container && !node.previousSibling) node = node.parentNode

	return { node: node.parentNode!, offset: childIndex(node) }
}

const wrap = (css: string, cls: string | undefined) => {
	const el = document.createElement('div')
	el.style.cssText = css
	if (cls) el.className = cls
	return el
}

/* the last text node under an element, however deep */
const lastText = (el: Node): Text | null => {
	for (let node = el.lastChild; node; node = node.previousSibling) {
		if (node instanceof Text) return node
		const inner = lastText(node)
		if (inner) return inner
	}
	return null
}

/* the segment break a cut left at the end of a line, with the blanks
   around it: preserved by `white-space: pre-*`, it would break the line
   block's line once more */
const SEAM = /[ \t]*\r?\n[ \t]*$/

const cut = (plan: Plan, opts: LamaSplitOptions, range: Range) => {
	for (const block of plan.blocks) {
		const pad = `${block.pad}px`
		const lineCss = `display:block;position:relative;padding:${pad} 0`
		const maskCss = `display:block;position:relative;overflow:clip;margin:-${pad} 0`
		const made: Line[][] = []

		/* the last run first: a run's cuts never reach past its anchor, so the
		   runs before it are untouched — the order is a habit, not a need */
		for (let r = block.runs.length - 1; r >= 0; r--) {
			const run = block.runs[r]!
			const { container, anchor } = run
			const end = () => (anchor ? childIndex(anchor) : container.childNodes.length)
			const points = run.starts.map((b) => resolve(b, container))
			const fragments: DocumentFragment[] = []

			/* the last line out first, each cut running to the anchor: what a
			   later cut takes is exactly what an earlier line does not hold, and
			   an earlier boundary's node keeps its head and its place */
			for (let i = points.length - 1; i >= 0; i--) {
				range.setStart(points[i]!.node, points[i]!.offset)
				range.setEnd(container, end())
				fragments[i + 1] = range.extractContents()
			}

			range.setStart(container, childIndex(run.first))
			range.setEnd(container, end())
			fragments[0] = range.extractContents()

			/* the wrappers go in only once every fragment is out */
			made[r] = fragments.map((fragment) => {
				const line = wrap(lineCss, opts.classes?.line)
				const mask = wrap(maskCss, opts.classes?.mask)

				line.append(fragment)
				mask.append(line)
				container.insertBefore(mask, anchor)

				return { el: line, mask, target: plan.target, pitch: block.pitch, pad: block.pad }
			})
		}

		const lines = made.flat()
		if (!lines.length) continue

		lines.forEach((line, i) => {
			line.el.setAttribute('data-line', String(i))
			line.mask.setAttribute('data-mask', String(i))

			const last = i === lines.length - 1

			/* the indent belongs to the block's first line, and inherits */
			if (block.indent && i > 0) line.el.style.textIndent = '0'
			/* every line is now a block's last line, which is never justified */
			if (block.justify && !last) line.el.style.textAlignLast = 'justify'

			if (block.pre && !last) {
				const text = lastText(line.el)
				if (text && SEAM.test(text.data)) text.data = text.data.replace(SEAM, '')
			}
		})

		block.mask = lines[0]!.mask
		block.el.style.setProperty('display', 'flex')
		block.el.style.setProperty('flex-direction', 'column')

		plan.lines.push(...lines)
	}
}

/* ── revert ───────────────────────────────────────────────────────────── */

const same = (a: NodeListOf<ChildNode>, b: ChildNode[]) => {
	if (a.length !== b.length) return false
	for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) return false
	return true
}

const restore = (plan: Plan) => {
	if (plan.reverted) return
	plan.reverted = true

	const blocks = new Map<Element, Block>()
	for (const block of plan.blocks) if (block.mask) blocks.set(block.el, block)

	for (const [el, kids] of plan.children) {
		const block = blocks.get(el)

		/* a block whose wrappers someone else already removed (a framework
		   writing the block's text) has been rewritten — theirs is the newer
		   truth */
		if (block && !el.contains(block.mask!)) continue

		if (!same(el.childNodes, kids)) el.replaceChildren(...kids)

		if (block) {
			const style = (el as HTMLElement).style
			if (block.display) style.setProperty('display', block.display)
			else style.removeProperty('display')
			if (block.direction) style.setProperty('flex-direction', block.direction)
			else style.removeProperty('flex-direction')
			/* no trace: a block that had no style attribute gets none back */
			if (!style.length) el.removeAttribute('style')
		}
	}

	/* characters back where the cut's own tail is still what the node holds */
	for (const [node, data] of plan.text) {
		if (node.data !== data && node.data === plan.after.get(node)) node.data = data
	}
}

/* ── the split ────────────────────────────────────────────────────────── */

export type LamaSplitTargets = string | Element | Iterable<Element> | ArrayLike<Element>

const targetsOf = (targets: LamaSplitTargets): HTMLElement[] => {
	if (typeof targets === 'string') return [...document.querySelectorAll<HTMLElement>(targets)]
	if (targets instanceof Element) return [targets as HTMLElement]
	return Array.from(targets as ArrayLike<Element>) as HTMLElement[]
}

export class LamaSplit {
	/** the blocks, in the order given */
	readonly targets: HTMLElement[]
	/** every line of every block, document order within each block */
	readonly lines: Line[]

	private plans: Map<HTMLElement, Plan>

	/**
	 * Split every target into the lines the browser painted — all of them
	 * measured before any is cut.
	 */
	constructor(targets: LamaSplitTargets, opts: LamaSplitOptions = {}) {
		this.targets = targetsOf(targets)

		const padEm = parseFloat(opts.pad ?? '0') || 0
		const reader = new Reader(padEm)

		/* read */
		const plans = this.targets.map((target) => reader.plan(target))
		reader.done()

		/* write */
		const range = document.createRange()
		for (const plan of plans) {
			cut(plan, opts, range)
			for (const node of plan.text.keys()) plan.after.set(node, node.data)
		}
		range.detach()

		this.plans = new Map(plans.map((plan) => [plan.target, plan]))
		this.lines = plans.flatMap((plan) => plan.lines)
	}

	/** one block's lines */
	linesOf(target: Element): Line[] {
		return this.plans.get(target as HTMLElement)?.lines ?? []
	}

	/** every original node back where it was — one block's, or all */
	revert(target?: Element) {
		if (target) {
			const plan = this.plans.get(target as HTMLElement)
			if (plan) restore(plan)
			return
		}

		for (const plan of this.plans.values()) restore(plan)
	}
}
