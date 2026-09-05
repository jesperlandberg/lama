# @lama/split

Splits blocks of text into the lines the browser painted, so each line can move
under its own mask. One instance takes any number of blocks: every block is
measured before any is cut, so a page of blocks costs one layout rather than one
per block. `revert()` puts every original node back where it was — the nodes
themselves, not a copy of the markup, so references into the block stay live.

```ts
import { LamaSplit } from '@lama/split'

const split = new LamaSplit(document.querySelectorAll('.copy'), { pad: '.5em' })

split.lines            // every line, document order: { el, mask, target, pitch, pad }
split.linesOf(block)   // one block's
split.revert(block)    // one block back to its markup
split.revert()         // all of them
```

Each line is a `div[data-line]` inside a clipping `div[data-mask]`. Move the
line; the mask is never transformed, so its box stays honest. `pad` is the slack
either side of a line box, in the block's own em: padding on the line, the same
negative margin on the mask, and the block column-flex for the split's lifetime,
so type set tighter than its face's content area is not cropped while it moves
and the block keeps its height to the pixel.

Line starts are found by geometry, not by guessing at wrapping: a word that
starts left of where the previous word ended begins a line. That is immune to
tight leading, where the rects of two lines overlap and overlap-based
splitters merge them. A word the browser broke at a hyphen is cut at the break.

The header of `src/index.ts` lists what is handled, what is left alone and why.

```sh
npm run build   # dist/ via tsc, with declarations
```
