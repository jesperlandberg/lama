# @lama/split

Splits blocks of text into the lines the browser painted — and the words and
characters in them — so each can move under its own mask, fade, or whatever the
tween is. One instance takes any number of blocks: every block is measured
before any is cut, so a page of blocks costs one layout rather than one per
block. `revert()` puts every original node back where it was — the nodes
themselves, not a copy of the markup, so references into the block stay live.

```ts
import { LamaSplit } from '@lama/split'

const split = new LamaSplit('.copy', { type: 'lines, words', mask: 'lines', pad: '.5em' })

split.lines            // { el, mask, target, line, pitch, pad }[]  — document order per block
split.words            // { el, mask, target, line }[]
split.chars            // same, when type includes chars
split.linesOf(block)   // one block's; also wordsOf / charsOf
split.revert(block)    // one block back to its markup
split.revert()         // all of them
```

## Options

| option | default | |
| --- | --- | --- |
| `type` | `'lines'` | `'lines'`, `'words'`, `'chars'`, any combination as a string or array. Words and characters sit inside line blocks, so lines always come along — that is what keeps a boxed word from moving a wrap. |
| `mask` | none | the units that get a clipping wrapper to move under — `'lines'`, `'words'`, `'chars'`, combinations. Off by default: a fade wants none. |
| `pad` | none | slack either side of each masked unit's box, in the block's own em (`'.5em'`): padding on the unit, the same negative margin on the mask, so type set tighter than its face's content area is not cropped while it moves and the block keeps its height. |
| `classes` | none | `{ lines, words, chars, mask }` class names, on top of `data-line` / `data-word` / `data-char` / `data-mask`. |

## What it does

- **Lines by geometry.** A word that starts left of where the previous word
  ended begins a line. No line-height involved, so tight leading — where the
  rects of two lines overlap and overlap-based splitters merge them — cannot
  fool it. A word the browser broke at a hyphen is cut at the break and becomes
  two word units, one per line.
- **Words and characters that move nothing.** Units are boxed before the lines
  are cut, each with the width it was painted at (a character gets the distance
  to where the next one starts, so kerning survives), and the line block does
  not wrap. An underline from an ancestor is restated on the unit, since a
  decoration does not reach into an inline-block.
- **Masks that keep the baseline.** A line's mask clips by `overflow`; a word's
  or character's by `clip-path`, because `overflow` on an inline-block moves its
  baseline to its bottom edge.
- **A revert that restores identity.** Original nodes are adopted back out of
  the wrappers and clones; a text node's characters are restored only where the
  cut's own tail is still what it holds, so a value written into the block while
  it was split stays.

The header of `src/index.ts` lists what is handled, what is left alone and why.

```sh
npm run build   # dist/ via tsc, with declarations
```
