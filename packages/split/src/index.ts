/*
 * @lama/split — the lines the browser painted, and the words and characters
 * in them, one wrapper each.
 *
 * A block of text in, one `div` per line out — and, asked for, a `span` per
 * word and per character inside those lines — with a revert that puts every
 * original node back where it was. Nothing here decides where a line
 * breaks: the browser already did, and this only reads the answer back off
 * the text and cuts the DOM at those points.
 *
 * No dependencies, no framework, nothing about animation: the caller owns
 * the tween and the moment. Masks are opt-in per unit, since a fade wants
 * none.
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
 * row differently in Chrome and Firefox. Such a word becomes two word units,
 * one per line.
 *
 * ── Words and characters ──
 *
 * A word or character unit is an inline-block, and an inline-block is a box
 * where there was a run of text: boxing a word could move a wrap, and
 * boxing a character throws away the kerning between it and the next. So
 * units are wrapped BEFORE the lines are cut, every unit is given the width
 * it was painted at — a word its rect's, a character the distance to where
 * the next one starts, which is where the kerned pen went — and the line
 * block is set not to wrap, so the boxes tile exactly where the glyphs were
 * and nothing moves. A unit's own first line is never indented: `text-indent`
 * inherits, and a box would otherwise indent its word inside itself by a
 * share of its own width. The whitespace between two boxes is boxed as well,
 * at the distance the browser left between the words: laid out between two
 * inline-blocks a space comes out a shade wider than inside a run, and a
 * line's worth of shades is a couple of pixels. A decoration (an underline)
 * does not reach into an
 * inline-block, so the nearest decorated ancestor's is restated on the unit.
 * An inline box that is not text (an inline-block superscript, a picture)
 * counts as one word and is never wrapped.
 *
 * ── Masks ──
 *
 * `mask` names the units that get a clipping wrapper to move under. A line's
 * is a block that clips by `overflow`; a word's or character's is an
 * inline-block that clips by `clip-path`, because `overflow` on an
 * inline-block moves its baseline to its bottom edge and would drop the word
 * off the line.
 *
 * Display type runs at a leading under 1em, so caps and descenders stand
 * outside the line box, and a mask sized to that box crops them while the
 * unit moves. `pad` is the slack: padding on the unit above and below, which
 * grows the box its mask clips to, and the same as a negative margin on the
 * mask, which hands the space back so the block keeps its height. A block
 * whose lines are masked goes column-flex for the split's lifetime, because
 * as blocks two adjacent masks' negative margins would collapse into one;
 * inline-block margins never collapse, so words and characters need nothing
 * more. A unit parked at its own height then sits a full pad past its mask's
 * edge, nothing peeks. All of it goes with the revert.
 *
 * ── What is left alone ──
 *
 * Only running text is cut. A block-level piece that is not a block of text
 * (a flex row, a table, an image between paragraphs) ends the run around it
 * and is not touched; anything out of flow — absolute, fixed, floated — is
 * neither measured nor moved, and if it holds text of its own it is split
 * inside itself, in place. Hidden content is skipped. A block of text
 * nested in the block (a heading and its paragraphs in one wrapper; the
 * spans of a flex row, which are blocks by then) is split inside itself.
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
 * forced break at the end of a line block. Kerning is lost across a line
 * cut, where the browser had none either, and kept across character boxes
 * by the widths they carry.
 *
 * ── The revert ──
 *
 * Cutting moves the original nodes into the wrappers and, where an inline
 * element or a text node straddles two lines, clones the part that
 * continues; the original always keeps the head. So the way back is to put
 * every original node's children back as they were: each original is
 * adopted out of whatever wrapper or clone it sits in, and the wrappers and
 * clones fall away. A text node's characters are restored only where the
 * cut's own tail is still what it holds — a value written into the node in
 * the meantime is newer than the record and stays. A block that lost its
 * wrappers to someone else's `textContent =` is left as they left it.
 *
 * Not handled, by choice: `hyphens: auto` (its hyphen is drawn, not in the
 * text), `::first-letter` / `::first-line`, floats inside the text, leading
 * preserved spaces after a break under `pre-wrap`, a glyph overhanging a
 * mask's edge (an italic's, clipped like any overflow), writing modes other
 * than horizontal left-to-right, and word segmentation for scripts without
 * spaces — a word is a run of non-whitespace; a character is a grapheme.
 *
 * Performance, in order: one layout for every block in a call; computed
 * styles read once per element; one Range reused for every read and one
 * for every cut; characters measured only when asked for; a revert that
 * touches only what moved.
 */

export type Level = 'lines' | 'words' | 'chars'

export type LamaSplitOptions = {
	/** the units to make — `'lines'`, `'words, chars'`, `['chars']`. Words and characters sit inside lines, so lines always come */
	type?: string | Level[]
	/** the units that get a clipping wrapper to move under, the same way; none by default */
	mask?: string | Level[]
	/** the slack either side of each masked unit's box, in the block's own em; none by default */
	pad?: string
	/** class names for the units and masks, on top of `data-line` / `data-word` / `data-char` / `data-mask` (the whitespace boxes between words carry `data-gap`) */
	classes?: Partial<Record<Level | 'mask', string>>
}

export type Unit = {
	/** the unit; move this */
	el: HTMLElement
	/** the clip around it if masked — never transformed, so its box is honest while the unit is parked */
	mask: HTMLElement | null
	/** the block the unit came from */
	target: HTMLElement
	/** the index of the line it sits on, within its block */
	line: number
}

export type Line = Unit & {
	/** the line-height of the block that holds it, px — the distance between two rows */
	pitch: number
	/** the slack above the line's box, px — `mask top + pad` is the line box's top at rest */
	pad: number
}

/* ── the plan ─────────────────────────────────────────────────────────── */

/* a line's first character, or the element it starts before; resolved to a
   Range start at cut time, since an element's index is only stable then */
type Boundary = { node: Text; offset: number } | { before: ChildNode }

/** a word as measured: where it is in its text node, and each piece the
    browser painted it in — one, or one per line where it broke — with the
    width the piece painted at and where its row ends */
type Piece = { start: number; end: number; left: number; right: number; width: number; y: number }

type Word = {
	node: Text
	pieces: Piece[]
	/** where each grapheme starts along the line, chars mode only */
	glyphs: { start: number; end: number; x: number }[] | null
}

type Run = {
	container: HTMLElement
	/** the run's first node */
	first: ChildNode
	/** the node after the run, or null for the container's end — every cut ends here */
	anchor: ChildNode | null
	/** the lines' starts after the first */
	starts: Boundary[]
	/** the words, in order, with the atoms that count as one */
	words: (Word | { atom: HTMLElement; left: number; right: number; y: number })[]
}

type Block = {
	el: HTMLElement
	pitch: number
	pad: number
	/** the block's computed `text-indent`, '' when none */
	indent: string
	justify: boolean
	/** `white-space` keeps segment breaks, so the one at a cut must go */
	pre: boolean
	runs: Run[]
	/* the block's own inline display, for the revert */
	display: string
	direction: string
	/* its first line mask once cut, to tell at revert whether it is still the block's */
	mask: Element | null
}

type Plan = {
	target: HTMLElement
	blocks: Block[]
	/* the decoration to restate on a unit, keyed by the text node's parent */
	deco: Map<Element, string>
	/* the record for the revert: every element's children and every text
	   node's characters, as they were */
	children: Map<Element, ChildNode[]>
	text: Map<Text, string>
	/* what the cut left in every text node */
	after: Map<Text, string>
	/* the inline `text-indent` every atom had before the split restated the block's on it */
	restyled: Map<HTMLElement, string>
	lines: Line[]
	words: Unit[]
	chars: Unit[]
	reverted: boolean
}

type Box = { left: number; right: number; top: number; bottom: number }

type Kind = 'hidden' | 'out' | 'inline' | 'atom' | 'block' | 'other'

type Settings = {
	words: boolean
	chars: boolean
	mask: Set<Level>
	padEm: number
	classes: Partial<Record<Level | 'mask', string>>
}

/** display values whose inline content lays out as lines of their own */
const BLOCKS = new Set(['block', 'list-item', 'flow-root', 'table-cell', 'table-caption'])

/** elements that are one box however they are displayed */
const REPLACED = new Set(['IMG', 'VIDEO', 'CANVAS', 'SVG', 'IFRAME', 'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'OBJECT', 'EMBED'])

/** what a decoration is made of, restated on a unit that would not draw its ancestor's */
const DECORATION = ['text-decoration-line', 'text-decoration-style', 'text-decoration-color', 'text-decoration-thickness', 'text-underline-offset', 'text-underline-position'] as const

const WORDS = /\S+/g

const graphemes: (text: string) => { index: number; length: number }[] = (() => {
	const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

	return (text) => {
		if (seg) return [...seg.segment(text)].map((s) => ({ index: s.index, length: s.segment.length }))

		let index = 0
		return Array.from(text).map((ch) => {
			const g = { index, length: ch.length }
			index += ch.length
			return g
		})
	}
})()

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

	constructor(private settings: Settings) {}

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
		const plan: Plan = {
			target,
			blocks: [],
			deco: new Map(),
			children: new Map(),
			text: new Map(),
			after: new Map(),
			restyled: new Map(),
			lines: [],
			words: [],
			chars: [],
			reverted: false,
		}

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

	/* the decoration a unit under this element has to restate: its nearest
	   decorated ancestor's, up to the block — none if nothing draws one */
	private decoration(el: Element, target: Element, plan: Plan) {
		const known = plan.deco.get(el)
		if (known !== undefined) return known

		let out = ''
		for (let node: Element | null = el; node; node = node === target ? null : node.parentElement) {
			const s = this.styleOf(node)
			if (s.textDecorationLine && s.textDecorationLine !== 'none') {
				out = DECORATION.map((p) => `${p}:${s.getPropertyValue(p)}`).join(';')
				break
			}
		}

		plan.deco.set(el, out)
		return out
	}

	/* a container's children, in runs of inline content between its block-level
	   children; every block-level child that holds text is a container of its own */
	private container(el: HTMLElement, plan: Plan) {
		const s = this.styleOf(el)
		const size = parseFloat(s.fontSize) || 0
		const block: Block = {
			el,
			pitch: parseFloat(s.lineHeight) || size * 1.2,
			pad: size * this.settings.padEm,
			indent: s.textIndent === '0px' ? '' : s.textIndent,
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
			const run = this.run(el, first, anchor, block, plan)
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

	/* measure one run: every word and every atom in order, where a new line
	   begins among them, and — asked for — where every character starts */
	private run(container: HTMLElement, first: ChildNode, anchor: ChildNode | null, block: Block, plan: Plan): Run | null {
		const half = block.pitch / 2
		const starts: Boundary[] = []
		const words: Run['words'] = []
		const { chars } = this.settings

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

			const edges = [start]

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
				edges.push(at)
				row = centre(rows[r]!)
				prev = rows[r]!
				from = at
			}

			edges.push(end)

			const entry: Word = {
				node,
				pieces: edges.slice(0, -1).map((s, i) => {
					const r = rows[Math.min(i, rows.length - 1)]!
					return { start: s, end: edges[i + 1]!, left: r.left, right: r.right, width: r.right - r.left, y: centre(r) }
				}),
				glyphs: null,
			}

			/* where each grapheme starts: engines round a lone glyph's width but
			   its position is exact, so boxes sized start to start tile the word */
			if (chars) {
				entry.glyphs = graphemes(node.data.slice(start, end)).map((g) => {
					range.setStart(node, start + g.index)
					range.setEnd(node, start + g.index + g.length)
					const r = range.getClientRects()[0]
					return { start: start + g.index, end: start + g.index + g.length, x: r ? r.left : Number.NaN }
				})
			}

			words.push(entry)
		}

		const walk = (node: ChildNode) => {
			if (node instanceof Text) {
				if (this.settings.words && node.parentElement) this.decoration(node.parentElement, plan.target, plan)
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

				/* where the flow put it: a relative offset moves the box, not
				   the text around it */
				const st = this.styleOf(node)
				const dx = st.position === 'relative' ? (st.left !== 'auto' ? parseFloat(st.left) || 0 : -(parseFloat(st.right) || 0)) : 0
				const dy = st.position === 'relative' ? (st.top !== 'auto' ? parseFloat(st.top) || 0 : -(parseFloat(st.bottom) || 0)) : 0
				words.push({ atom: node as HTMLElement, left: r.left - dx, right: r.right - dx, y: (r.top + r.bottom) / 2 - dy })
			}
			/* hidden and out-of-flow: not on the line */
		}

		for (let node: ChildNode | null = first; node && node !== anchor; node = node.nextSibling) walk(node)

		/* nothing measured — whitespace, a lone <br> — is nothing to cut */
		if (row === null) return null

		return { container, first, anchor, starts, words }
	}
}

/* ── write ────────────────────────────────────────────────────────────── */

const wrap = (tag: 'div' | 'span', css: string, cls: string | undefined) => {
	const el = document.createElement(tag)
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

/* a unit's clip: padding on the unit, the same negative margin on the mask
   — see the header */
const slack = (pad: number) => ({ unit: pad ? `;padding:${pad}px 0` : '', mask: pad ? `;margin:-${pad}px 0` : '' })

/*
 * Box the words of one run, and their characters, in place — before the
 * lines are cut, so the cuts land between boxes. A word the browser broke
 * is two boxes, one per line; `boxes` records where each box starts, so a
 * line boundary that was a character offset can become "before this box".
 */
const box = (run: Run, block: Block, plan: Plan, settings: Settings, boxes: Map<Text, Map<number, HTMLElement>>) => {
	const pad = settings.mask.has('words') ? block.pad : 0
	const charPad = settings.mask.has('chars') ? block.pad : 0

	/* a text node's cursor across its words: the head stays in the original
	   node, each piece and the tail after it are new nodes, so `at` is where
	   the tail now starts in the original's offsets */
	const cursors = new Map<Text, { rest: Text; at: number }>()

	/* the box before this one on the line, whatever node it was in: the
	   whitespace between two boxes is boxed too, at the width the browser
	   left between the words — laid out between boxes it comes out wider */
	let prev: { right: number; y: number } | null = null
	const half = block.pitch / 2

	const gap = (ws: Text, next: { left: number; y: number }) => {
		if (!prev || !ws.length || !/^\s+$/.test(ws.data) || Math.abs(next.y - prev.y) >= half) return
		const el = wrap('span', `display:inline-block;text-indent:0;inline-size:${Math.max(0, next.left - prev.right)}px`, undefined)
		el.setAttribute('data-gap', '')
		ws.replaceWith(el)
		el.append(ws)
	}

	for (const entry of run.words) {
		if ('atom' in entry) {
			plan.words.push({ el: entry.atom, mask: null, target: plan.target, line: -1 })

			/* the whitespace before it, if the word before left it as a node of
			   its own: an atom is not boxed, but the space beside a box is */
			const ws = entry.atom.previousSibling
			if (ws instanceof Text) gap(ws, entry)

			prev = { right: entry.right, y: entry.y }
			continue
		}

		const { node } = entry
		const deco = plan.deco.get(node.parentElement!) ?? ''
		let starts = boxes.get(node)
		if (!starts) boxes.set(node, (starts = new Map()))

		let cursor = cursors.get(node)
		if (!cursor) cursors.set(node, (cursor = { rest: node, at: 0 }))

		for (const piece of entry.pieces) {
			const text = cursor.rest.splitText(piece.start - cursor.at)
			const tail = text.splitText(piece.end - piece.start)

			/* what the split left in `rest` is the whitespace before the piece */
			gap(cursor.rest, piece)
			cursor.at = piece.end

			const unit = wrap('span', `display:inline-block;position:relative;text-indent:0;inline-size:${piece.width}px${slack(pad).unit}${deco && ';' + deco}`, settings.classes.words)
			unit.setAttribute('data-word', '')
			text.replaceWith(unit)
			unit.append(text)

			if (settings.chars && entry.glyphs) glyphs(entry, piece, text, charPad, deco, settings, plan)

			let outer: HTMLElement = unit
			let mask: HTMLElement | null = null

			if (settings.mask.has('words')) {
				mask = wrap('span', `display:inline-block;position:relative;text-indent:0;clip-path:inset(0)${slack(pad).mask}`, settings.classes.mask)
				mask.setAttribute('data-mask', '')
				unit.replaceWith(mask)
				mask.append(unit)
				outer = mask
			}

			plan.words.push({ el: unit, mask, target: plan.target, line: -1 })
			starts.set(piece.start, outer)
			prev = { right: piece.right, y: piece.y }
			cursor.rest = tail
		}
	}
}

/* the characters of one word piece, each as wide as the distance to where
   the next starts — the kerned advance — and the last to the row's end */
const glyphs = (entry: Word, piece: Piece, text: Text, pad: number, deco: string, settings: Settings, plan: Plan) => {
	const list = entry.glyphs!.filter((g) => g.start >= piece.start && g.end <= piece.end && Number.isFinite(g.x))
	let rest: Text = text
	let consumed = piece.start

	list.forEach((g, i) => {
		const next = list[i + 1]
		const width = Math.max(0, (next ? next.x : piece.right) - g.x)
		const ch = rest.splitText(g.start - consumed)
		const tail = ch.splitText(g.end - g.start)
		consumed = g.end

		const unit = wrap('span', `display:inline-block;position:relative;text-indent:0;inline-size:${width}px${slack(pad).unit}${deco && ';' + deco}`, settings.classes.chars)
		unit.setAttribute('data-char', '')
		ch.replaceWith(unit)
		unit.append(ch)

		let mask: HTMLElement | null = null
		if (settings.mask.has('chars')) {
			mask = wrap('span', `display:inline-block;position:relative;text-indent:0;clip-path:inset(0)${slack(pad).mask}`, settings.classes.mask)
			mask.setAttribute('data-mask', '')
			unit.replaceWith(mask)
			mask.append(unit)
		}

		plan.chars.push({ el: unit, mask, target: plan.target, line: -1 })
		rest = tail
	})
}

const cut = (plan: Plan, settings: Settings, range: Range) => {
	const lineMask = settings.mask.has('lines')

	for (const block of plan.blocks) {
		const pad = lineMask ? block.pad : 0
		const nowrap = settings.words ? ';white-space:nowrap' : ''
		const lineCss = `display:block;position:relative${nowrap}${slack(pad).unit}`
		const maskCss = `display:block;position:relative;overflow:clip${slack(pad).mask}`
		const made: Line[][] = []
		const boxes = new Map<Text, Map<number, HTMLElement>>()

		/* the last run first: a run's cuts never reach past its anchor, so the
		   runs before it are untouched — the order is a habit, not a need */
		for (let r = block.runs.length - 1; r >= 0; r--) {
			const run = block.runs[r]!
			const { container, anchor } = run

			if (settings.words) box(run, block, plan, settings, boxes)

			const end = () => (anchor ? childIndex(anchor) : container.childNodes.length)

			/* a boundary at a character that is now a box's first is the box */
			const points = run.starts.map((b) => {
				const el = 'before' in b ? null : boxes.get(b.node)?.get(b.offset)
				return resolve(el ? { before: el } : b, container)
			})

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
				const line = wrap('div', lineCss, settings.classes.lines)
				line.append(fragment)

				let mask: HTMLElement | null = null
				if (lineMask) {
					mask = wrap('div', maskCss, settings.classes.mask)
					mask.append(line)
				}

				container.insertBefore(mask ?? line, anchor)

				return { el: line, mask, target: plan.target, line: -1, pitch: block.pitch, pad }
			})
		}

		const lines = made.flat()
		if (!lines.length) continue

		lines.forEach((line, i) => {
			line.line = i
			line.el.setAttribute('data-line', String(i))
			line.mask?.setAttribute('data-mask', String(i))

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

		if (lineMask) {
			block.mask = lines[0]!.mask
			block.el.style.setProperty('display', 'flex')
			block.el.style.setProperty('flex-direction', 'column')
		}

		/* an inline-block inside the block inherits its indent and applies it
		   to its own first line — a zero-width superscript's glyph sits 2px in
		   on this site. A later line's block zeroes the indent for the line,
		   which would move the glyph; the block's value is restated on every
		   atom so it keeps its quirk */
		if (block.indent) {
			for (const run of block.runs) {
				for (const entry of run.words) {
					if (!('atom' in entry)) continue
					plan.restyled.set(entry.atom, entry.atom.style.getPropertyValue('text-indent'))
					entry.atom.style.textIndent = block.indent
				}
			}
		}

		plan.lines.push(...lines)
	}

	/* which line every word and character landed on */
	if (settings.words) {
		const index = new Map<Element, number>()
		for (const line of plan.lines) index.set(line.el, line.line)
		const lineOf = (el: Element) => {
			for (let node: Element | null = el; node; node = node.parentElement) {
				const i = index.get(node)
				if (i !== undefined) return i
			}
			return -1
		}
		for (const unit of plan.words) unit.line = lineOf(unit.el)
		for (const unit of plan.chars) unit.line = lineOf(unit.el)
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
	for (const block of plan.blocks) blocks.set(block.el, block)

	for (const [el, kids] of plan.children) {
		const block = blocks.get(el)

		/* a block whose wrappers someone else already removed (a framework
		   writing the block's text) has been rewritten — theirs is the newer
		   truth */
		if (block?.mask && !el.contains(block.mask)) continue

		if (!same(el.childNodes, kids)) el.replaceChildren(...kids)

		if (block?.mask) {
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

	for (const [el, indent] of plan.restyled) {
		if (indent) el.style.textIndent = indent
		else el.style.removeProperty('text-indent')
		if (!el.style.length) el.removeAttribute('style')
	}
}

/* ── the split ────────────────────────────────────────────────────────── */

export type LamaSplitTargets = string | Element | Iterable<Element> | ArrayLike<Element>

const targetsOf = (targets: LamaSplitTargets): HTMLElement[] => {
	if (typeof targets === 'string') return [...document.querySelectorAll<HTMLElement>(targets)]
	if (targets instanceof Element) return [targets as HTMLElement]
	return Array.from(targets as ArrayLike<Element>) as HTMLElement[]
}

const list = (v: string | Level[] | undefined): Level[] =>
	(!v ? [] : Array.isArray(v) ? v : v.split(/[\s,]+/)).filter(Boolean) as Level[]

export class LamaSplit {
	/** the blocks, in the order given */
	readonly targets: HTMLElement[]
	/** every line of every block, document order within each block */
	readonly lines: Line[]
	/** every word, if asked for (`type` includes words or chars) */
	readonly words: Unit[]
	/** every character, if asked for */
	readonly chars: Unit[]

	private plans: Map<HTMLElement, Plan>

	/**
	 * Split every target into the lines the browser painted — and their words
	 * and characters, asked for — all of them measured before any is cut.
	 */
	constructor(targets: LamaSplitTargets, opts: LamaSplitOptions = {}) {
		this.targets = targetsOf(targets)

		const type = new Set(list(opts.type))
		const settings: Settings = {
			chars: type.has('chars'),
			words: type.has('words') || type.has('chars'),
			mask: new Set(list(opts.mask)),
			padEm: parseFloat(opts.pad ?? '0') || 0,
			classes: opts.classes ?? {},
		}

		const reader = new Reader(settings)

		/* read */
		const plans = this.targets.map((target) => reader.plan(target))
		reader.done()

		/* write */
		const range = document.createRange()
		for (const plan of plans) {
			cut(plan, settings, range)
			for (const node of plan.text.keys()) plan.after.set(node, node.data)
		}
		range.detach()

		this.plans = new Map(plans.map((plan) => [plan.target, plan]))
		this.lines = plans.flatMap((plan) => plan.lines)
		this.words = plans.flatMap((plan) => plan.words)
		this.chars = plans.flatMap((plan) => plan.chars)
	}

	/** one block's lines */
	linesOf(target: Element): Line[] {
		return this.plans.get(target as HTMLElement)?.lines ?? []
	}

	/** one block's words */
	wordsOf(target: Element): Unit[] {
		return this.plans.get(target as HTMLElement)?.words ?? []
	}

	/** one block's characters */
	charsOf(target: Element): Unit[] {
		return this.plans.get(target as HTMLElement)?.chars ?? []
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
