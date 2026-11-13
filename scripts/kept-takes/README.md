# The kept takes

Real takes with the author's labels on every remark, and one command that scores Pinch's reading on them (D201). A change to the reading ships only if the score does not get worse.

The takes hold the author's words, so they live outside this repository, in a folder of their own. `$PINCH_KEPT_TAKES` names it.

## Label a take

1. Find the take that sits beside an export, `pinch-take-….json` (D183), and the export's folder.
2. Write it out for labelling:

   ```bash
   node --import tsx scripts/kept-takes/prepare.ts pinch-take-….json \
     --images pinch-notes-… --out "$PINCH_KEPT_TAKES/review-220"
   ```

   `--images` can be given more than once, and can be a folder of the original screenshots: a screen is matched by its name. Only screens something was said over need one.

3. Open `label.html` in that folder. Each remark comes up with its screenshot, Pinch's spots dashed in blue, and what Pinch made of it. Say what was meant:

   - **Where:** drag a box round each thing meant, or `P` to take Pinch's spots, `S` the whole screen, `N` no place, `X` not a note.
   - **What it does:** `1` objection, `2` approval, `3` mixed, `4` question, `5` other.
   - **Also:** `B` takes back the remark before, `M` misheard, `K` cut off, `E` to write what was meant.
   - `Enter` confirms and goes to the next one. `?` lists the keys.

   Work is kept in the browser as you go. **Save labels** downloads `labels.json`: put it in the take's folder.

4. Running `prepare.ts` again on the same folder picks up `labels.json`, so labelling can stop and start.

About two hours for a review of 300 remarks. Every answer starts as Pinch's reading, so the score leans towards agreeing with it where the author confirms without looking. Look before `Enter`.

## Score

```bash
node --import tsx scripts/kept-takes/score.ts --save before.json
# change the reading
node --import tsx scripts/kept-takes/score.ts --against before.json
```

One block a take and one for all of them. Each line is a rate with its counts:

| Line                                           | Out of                                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Placed as meant                                | Notes meant: marks on every spot meant and nowhere else, or on the screen, or nowhere, as meant |
| Spots meant that were marked                   | Boxes the author drew                                                                           |
| Marks on a spot meant                          | Marks Pinch made                                                                                |
| Non-notes kept out                             | Remarks that are not notes                                                                      |
| Stance right, approvals found, questions found | Notes with a stance                                                                             |
| Take-backs found                               | Notes that take back the one before                                                             |
| Misheard or cut, flagged                       | Remarks the author marked misheard or cut off                                                   |
| Flags that were right                          | Remarks the "Not sure" list names                                                               |

A mark is on a spot when a point is on the box or within 2% of it, or when at least 35% of an area lies on the box: a loose circle counts, a frame round half the screen doesn't. A label finds its remark again by its words, on its screen or the one either side, so it still scores after the reading changes how a take is cut.

`--against` exits with 1 when any line got worse. The gesture takes, where the author named each gesture aloud, are still scored by `scripts/take-strokes.ts`.
