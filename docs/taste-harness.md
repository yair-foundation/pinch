# The taste harness

What would make Pinch a must-have, better for design than a coding agent on its own? Trajectory's idea, applied to design: a harness that captures a person's corrections, keeps them, and checks new work against them before the person sees it. This page weighs the ways to get there, tests the open ones on made-up designers, and gives the verdict for v1. It was written on 2026-11-06, while the author was away. The author's own picks were scored the next day, and the check went into Export (D174).

## What a coding agent already does on its own

- **It has a taste of its own, and it's no longer garish.** Asked for a yoga studio's timetable with no guidance, Claude built warm off-white paper, a light serif and hairline rules. Asked to invent designers whose taste goes against a coding agent's defaults, it made up that same taste three times out of three. So Pinch adds nothing for someone whose taste matches that look, and most for someone whose taste doesn't.
- **Pointing at UI for an agent is crowded and forgets.** Agentation, React Grab, Cursor's Design Mode and Vercel's toolbar each send the agent a selector, a screenshot or a note for one fix. None found remembers a correction for the next task or checks new work against past ones. memi claims a "living taste profile" and uses it only as context. Figma's critique and the review plugins check against a design system or written guidelines, not a person.
- **A judge built from picks alone is close to a coin flip.** In DesignPref (arXiv 2511.20513), 20 designers made 12,000 picks between UI pairs, and agreed with each other only weakly. Judges predicting one designer's picks scored 54% to 60%, personalised ones included.
- **A critic looking at screenshots helps generated UI** (arXiv 2604.05839: up to 17.8% better over three rounds), and a generator asked to improve its own work without one gained 1.5%. Those critics are generic.
- **Trajectory's Continual Grading** builds a grader for each task from an expert's graded examples, and picks the grader that orders pairs as the expert does. Its learned grader reached 80% to 85% where the expert's own reached 87.8%. A plain score ranked below 60% on legal work, and the search overfits on few examples. Nothing in it covers visual work.

## The ways weighed

| Way | What it adds over an agent alone | Evidence | Verdict |
| --- | --- | --- | --- |
| Rules read from notes | Generalises the taste | Lost 5 of 6 to a plain file and 5 of 6 to pointing (D155, D156) | Stays hidden |
| Picks between two designs, learned | A preference model | 54–60% for one designer (DesignPref); costs the person judging | Not for v1 |
| Takes kept as a folder the agent reads every time | Remembers each correction | On the author, corrections came back 0 times against 15 with no notes (a test in another session, not recorded in this repository). Below, 20 of 20 cells | **The core** |
| A check against the takes before the person sees a screen | Catches what the agent repeats or misses | Below: better where taste is far from the agent's. Asked for in `notes.md`, it ran 1 time in 12; as a sub-agent file, 12 of 12 | **Add, as a sub-agent** |
| A generic design review before the person sees a screen | What a plain agent can do today | Below: worse than none | Never |
| A judge's agreement with the person as a score | A promise that can be measured | On the author's 28 picks, 70% with their notes against 32% without (below) | A test, not a feature |
| Talking over the agent's own page with no export step | Removes the handoff | One try (D167, from another session, not recorded here) | Later in v1 |

## The test, on made-up designers

`scripts/taste-harness/run.mjs`. Five made-up designers, each with 12 hidden taste points, three of them asked to be far from the agent's default (loud and chunky, soft and illustrated, dark brutalist). For each, the agent built a first screen with no guidance, and the designer corrected it as in Pinch: 8 remarks said while pointing ("This headline is way too polite…"), turned into a Pinch package: `notes.md` with each note's place, text and colours, a marked copy and dimmed close-ups. Then two new screens, built twice each, in up to six ways:

- **A** no memory.
- **B** the take as a folder the agent reads first, as Pinch exports it today.
- **C** B, then a separate check: a fresh session with only the take and the render lists where the screen repeats a correction or goes against a note, "only what my notes say", and the agent fixes those.
- **D** B, then a generic design review by a fresh session, "as a senior product designer", and the same fix.
- **E** B, with one line in `notes.md` asking the agent to run that check itself, with a sub-agent.
- **F** B, with the check as a sub-agent file in the project (`.claude/agents/pinch-check.md`, the same words as C's check) and one line in `notes.md`: "Before you show me a screen, draw it and run the pinch-check agent on the drawing, then fix what it finds."

A fresh session holding the designer's hidden taste and their 8 corrections judged each cell's renders blind, twice, in random order: the changes they'd ask for, the taste points broken, the corrections repeated, and a ranking.

**Results.** Per cell, averaged over the two judgings. A pair is decided by mean rank.

| Way | Changes | Corrections repeated | Mean rank | Cells |
| --- | ---: | ---: | ---: | ---: |
| A no memory | 12.7 | 5.9 | 3.6 of 4 | 20 |
| B the folder | 6.0 | 0.75 | 1.8 | 20 |
| C the folder and a check | 5.3 | 0.28 | 1.4 | 20 |
| D the folder and a generic review | 6.6 | 0.92 | 2.6 | 12 |

- **Memory carries a correction to new screens.** B beat A in 20 of 20 cells, with 52% fewer changes and 87% fewer corrections repeated.
- **A generic review makes it worse.** D lost to B 8 times, won once and tied 3. On the loud designer it told the agent to "cut the headline", "use one neutral time block" and "reserve colour for status": sound advice in general, and the opposite of this person.
- **The check helps where taste is far from the agent's.** On the three far designers, C beat B in 11 of 12 cells, with 19% fewer changes and repeats down from 1.0 to 0.25. A second judging, of B, C and E only, agreed: 11 of 12. On the two near designers it added nothing: 2 wins, 3 losses, 3 ties.
- **Asking for the check in `notes.md` doesn't get it run.** Of the 12 builds told to, 1 ran it. The other 11 said they hadn't, most of them in the words "I skipped the fresh-agent check". E still did a little better than B (6 wins, 5 ties, 1 loss, 10% fewer changes), likely because the line drew attention to the notes, and worse than C (5 wins, 1 tie, 6 losses). The check has to be a step that runs, not a request.
- **As a sub-agent file, it runs every time and does as well as the separate pass.** F's builds called `pinch-check` once each, 12 of 12, read from their logs. Judged blind against B and C on the three far designers: F beat B 8 times, lost 1 and tied 3, with 6.5 changes against B's 7.8, the same as C's, and 0.9 corrections repeated against B's 1.9 and C's 1.0. F against C: 6 wins, 5 losses, 1 tie.

**Can a judge from the notes stand in for the person?** `scripts/hand-vs-pinch/predict.ts` ran on the made-up picks of the first two designers (`to-pairs.mjs` turns the cells into pairs). A judge with only the 8 pointed notes agreed with the hidden-taste judge on 28 of 30 pairs and was unsure on 1, counting a pick only when both orders agree. A generic judge, asked which is the better design, agreed on 4 and was unsure on 6, 23% with unsure as half. Between the build with no memory and the folder's, it picked the one with no memory 6 times of 8 and was unsure twice.

**Limits.**

- **Nobody real.** The designers, their notes, the builds and every judge are the same family of model. A made-up taste is a list of points, which flatters anything that checks points, and the author's real takes reversed a made-up result once already (the rules, D155). So these numbers say which way to test, not how big the gain is.
- The judge saw the corrections, which may draw its eye to repeats. B against A is so large that this can't explain it; C against B is small enough that it could inflate it.
- One take of 8 notes, on one first screen. The author's takes have 65 notes on references, where carrying a note across is harder.
- F ran in Claude Code, headless, with the sub-agent file already in the project. Other agents (Cursor, Codex) read sub-agents differently or not at all, and nobody has tried a person dropping the file into a real project.
- One build in the loud set copied the studio's name from the first screen's text: the `Where` line carries content as well as place.
- The near designers' cells were few (8), so "nothing there" is a signal, not a finding.

## The author's picks, 2026-11-07

`predict.ts` on the author's 28 blind picks, from all four sittings and both rounds, with the pointing package as the notes. Each pair went to each judge twice, sides swapped, and a pick counts only when both orders agree.

| Judge | Agreed | Unsure | Disagreed | Score, unsure as half |
| --- | ---: | ---: | ---: | ---: |
| With the author's notes | 18 | 3 | 7 | 70% |
| Generic, "which is the better design" | 6 | 6 | 16 | 32% |

- **The notes carry the author's taste to a judge.** Where it decided, it agreed 18 times in 25. Judges learned from one designer's picks alone reach 54% to 60% (DesignPref).
- **A generic judge leans the other way.** It disagreed twice as often as it agreed, as it did with the made-up designers.
- **It passes the bar set before it ran** (a gap of about 15 points), at 38.
- **Limits.** 28 picks: the 70% could plausibly be anywhere from about 55% to 85%. The builds were made from the same notes, so part of what the judge finds is which build followed them, and the author mostly preferred those. On new work it should score lower. Which pairs it missed is in each folder's `predictions.json`, on the author's Mac.

## What the check costs, 2026-11-07

Three ways to spend less, each built 12 times on the three made-up designers furthest from the agent's taste, against the check as it shipped (F) and the folder with no check (B). The cost of each screen comes from its build's log (`scripts/taste-harness/cost.py`), at API prices; on a subscription it counts toward the plan's limits instead. All five were judged blind together, twice per cell.

| Way | Cost a screen | The check's part | Changes | Repeats | Mean rank of 5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| B no check | | | 6.9 | 1.75 | 3.1 |
| F the check, on the builder's model (Sonnet) | $0.41 | $0.042 | 6.6 | 1.54 | 3.2 |
| G the check on Haiku | $0.39 | $0.004 | 6.0 | 1.04 | 2.4 |
| H words first: open a close-up only when the screen has the same kind of thing | $0.41 | $0.039 | 6.1 | 1.17 | 2.5 |
| I words first, the check on Haiku, pictures at half size | $0.28 | $0.004 | 6.5 | 2.00 | 3.8 |

- **The builder is the cost, not Pinch.** Nearly all of a screen is the agent writing and fixing its page, about 20,000 tokens of output. Reading the notes again is mostly cached. The check was a tenth.
- **Haiku checks as well.** G beat F 10 times in 12 and ranked best, for a tenth of the check's cost. So the shipped check names `model: haiku` (D178).
- **Words first saved nothing at this size.** Told to open the images, builders already opened one or two of a take's ten, and the check under one. A take of 65 notes on ten screenshots is where it could matter; untested.
- **Cheapest was worst.** I cost a third less, because its builder wrote less, and brought back the most corrections. Pictures stay full size.
- **The judging is noisy.** Ranked five at a time, F didn't beat B (3 wins to 6), where the same builds judged three at a time had F winning 8 to 1. The costs are measured; read the quality as a lean.

## Criteria written for each screen, 2026-11-07

Can a system that writes rules keep up with taste if it writes them fresh for each task, as Trajectory's graders do, rather than keeping one rulebook? `predict.ts` now has a third judge, `criteria`: it reads the same notes, first writes 3 to 7 criteria for the task, each naming the notes it rests on, then judges both screens by them. The `taste` judge reads the notes and judges directly, as the check does.

The pairs were harder than before: screens for the three designers furthest from the agent's taste, all built with their take in five ways, kept only where the hidden-taste judge ranked the two the same way in both of its passes (`scripts/taste-harness/close-pairs.mjs`). 93 pairs.

| Judge | Agreed | Unsure | Disagreed | Score, unsure as half |
| --- | ---: | ---: | ---: | ---: |
| `taste`: the notes, directly | 60 | 24 | 9 | 77% |
| `criteria`: criteria for the task first | 56 | 20 | 17 | 71% |
| `generic`, on one designer's 33 pairs | 8 | 8 | 17 | 36% |

- **Writing criteria first didn't help.** Pair by pair, the direct judge did better on 17 and worse on 8, the rest the same. That leans the same way as the rules (D155, D156), though 17 to 8 could still be chance (p about 0.11).
- **What it suggests:** the notes beside the screen carry more than criteria drawn from them, even criteria written for that very task. The check stays as it is.
- **On the author's picks,** the same judge can run with nothing re-asked: `PREDICT_JUDGES=criteria` and the command below asks only its picks.
- **Limits:** made-up designers whose taste is a list of points, which should favour criteria if anything; one take of 8 notes each.

## The learning curve, 2026-11-07

Does an agent keep improving as a person's takes pile up, or does it flatten? `scripts/taste-harness/rounds.mjs`, on the three made-up designers furthest from the agent's taste. Round 1 is the agent's first screen with nothing, which the designer corrects by pointing and talking. Each take goes into the project as a real Export folder, `pinch-check.md` included, and rounds 2 to 6 build a new screen each, with every take so far. Each round also builds the same task with nothing, since tasks differ in difficulty. A session holding the hidden taste judged both screens blind, twice: the changes it would ask for, the taste points broken, and the earlier corrections repeated.

| Round | Changes, with the takes | Changes, with nothing | Taste points broken, with the takes | With nothing | Earlier corrections in the project | Repeated, with the takes | With nothing |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | | 11.7 | | 11.0 | 0 | | |
| 2 | 6.7 | 11.3 | 5.3 | 11.2 | 8 | 0.2 | 5.7 |
| 3 | 4.7 | 11.3 | 3.2 | 11.7 | 15 | 0.7 | 8.3 |
| 4 | 4.3 | 11.3 | 3.0 | 11.5 | 22 | 1.2 | 10.2 |
| 5 | 4.3 | 11.0 | 2.5 | 11.2 | 29 | 2.5 | 7.7 |
| 6 | 4.3 | 12.0 | 2.7 | 11.0 | 35 | 1.7 | 13.2 |

- **Nothing never learns.** About 11.5 changes a screen in every round, as expected.
- **With the takes it learns fast, then flattens.** Changes fall from 11.7 to 6.7 after one take, 4.7 after two, and 4.3 from the third on, 62% fewer than with nothing. The screen built with the takes ranked first in 30 judgings of 30. The taste points broken follow the same curve, 5.3 down to 2.7, and don't depend on the notes.
- **It doesn't get worse as takes pile up.** At round 6 the project held 35 corrections and the agent still did as well as at round 3. Repeats rise, 0.2 to 1.7, but out of a pile that grew from 8 to 35.
- **It doesn't keep compounding either.** One designer flattened at about 5.5 changes, another near 3. Whatever is left from round 3 on is not fixed by more takes of the same kind: it may be what notes can't carry, or the judge's own floor, which this test can't separate.
- **The cost grows a little.** A screen cost $0.31 at round 2 and $0.43 at round 6, at API prices, the builder reading more files as the takes pile up. About 4.7 to 11 images were opened.
- **The check ran in 9 of 15 builds,** though its file and line were in every take's folder, and the 6 builds that skipped it did as well, 4.4 changes against 5.2. This test can't show that the check added anything on top of the notes.

**Limits.** Three made-up designers judged by a model of the same family, five takes at most, about 7 remarks a take. The made-up designer never says a screen is done: it made 6.7 remarks a screen even at round 5, so remarks per take can't be read as progress.

**What the plateau is made of,** 2026-11-07. The judge's list of taste points still broken at rounds 4 to 6:

- **Every point had been said.** Each of the three designers' 12 taste points was named in at least some of their remarks, and the ones still broken had been named 4 to 14 times. So the leftovers aren't things nobody told the agent.
- **They are mostly measurable:** text at least 16px and never grey (designer 2), 32px between sections and 20px of padding, labels as slightly rotated stickers (designer 4), exactly one accent colour (designer 5).
- **A judge looking at a picture can't measure those,** so I measured one in the code (`font-share.cjs`). Designer 2's builds with the takes had 0 to 9% of their text under 16px, none under 13px. With nothing, 16 to 87% was under 16px. The judge had flagged that point in 5 of 6 late judgings of screens that met it.
- **So part of the plateau is the judge's floor,** not the agent's. This test can't say how much; only the 4.3 against 11.5 gap and the broken-points drop are solid.

**What it means for "living".** Memory learns quickly and stays good up to about 35 notes, but it plateaus. The next thing to build is not more memory of the same kind. It is a measure that doesn't rest on a model's eye: for what can be measured (text size, spacing, how many accent colours), a check in code on the rendered page, with the judge kept for what only an eye can see. Then contradictions between old and new notes, which this run never produced.

## A check in code, from the notes, 2026-11-07

Can a check in code, written from a person's notes, help an agent keep what can be measured? `scripts/taste-harness/measure.mjs`, on rounds 4 to 6 of the learning-curve test, for the same three designers. A session read each designer's takes so far and wrote `check.mjs`, which loads the page in Chromium and reports what the notes make measurable (sizes, spacing, colours, radius, case), each finding citing its note, with no taste of its own. The builder ran it and fixed what it found. To score the pages without a model's eye, a second script (the oracle) was written from each designer's hidden taste alone: for each of the 12 statements it says met, broken, or not measurable by code. Each round's task was built with nothing (A), with the takes twice (M, M2) and with the takes and the check twice (K, K2).

| Way | Measurable points broken | Pages |
| --- | ---: | ---: |
| Nothing | 95% | 9 |
| The takes | 79% | 18 |
| The takes and the code check | 78% | 18 |

- **The oracle sees the takes working:** 95% broken with nothing, 79% with the takes, on every designer. The check added nothing: better in 3 cells of 9, worse in 4, the same in 2.
- **The check ran:** all 18 builds ran it and ended with no findings. It had little to find: on the pages built without it it reported 0 to 12 findings, 3 on average. It checked what the notes say, and the notes seldom carry numbers.
- **The hidden taste does:** "32px between sections", "text at 16px or more", "exactly one accent colour". The designers never said those figures aloud ("make it huge", "too tiny"), so no check made from what they said can hold them, and the oracle holds the pages to all of it.
- **Limits.** The oracle is strict, a point broken by any one element, so 79% broken is not comparable with the judge's 2.7 of 12. Only the order is meaningful. The oracle was written by the same family of model from the same taste statements the designers were given.

**What it means.** A check made from what people say can't check what they didn't say, and spoken notes are short on numbers. The numbers are in the screenshots, not in the speech. Export already says, for each spot pointed at, the text there and its main colours. Measuring the marked spot, its text size, spacing, corner radius and weight, would put numbers in the notes the person never spoke. That is the thing to test next, with the same oracle.

## Measuring the spot pointed at, 2026-11-07

The code check had little to hold because spoken notes seldom carry numbers. So each note got a line of what was measured at its spot on the page, under its `Where` line: `Measured: text 13px, weight 400, Inter, colour #6b7280; box padding 16px, corners 12px, no shadow, background #ffffff.` Measured in Chromium on the page the take was made on (`measure.mjs spots`), which is the best case: on a screenshot of someone else's site, Pinch would have to estimate them from pixels. Rounds 4 to 6 were built again from these notes, twice (N, N2), and scored by the same oracle.

| Way | Measurable points broken |
| --- | ---: |
| Nothing | 95% |
| The takes | 79% |
| The takes and the code check | 78% |
| The takes, each note with its measurements | 82% |

- **The numbers didn't help.** Measured notes did better in 2 cells of 9, worse in 6, the same in 1. Designer 5 went from 73% to 81%.
- **Why, likely:** these takes correct the agent's own screens, so most measured numbers describe what was wrong. "Too tiny" beside "text 13px" gives the agent a number, and it sometimes kept it. On a reference the person likes, the numbers would be the target; that is not what this tested.
- **Limits:** the oracle's strictness, three designers, two builds a cell.

## Verdict for v1

**The promise:** stop giving your design agent the same feedback. Point at it once, say why, and your agent remembers it and checks every screen against it before you see it. A plain agent can't: it remembers nothing, and when it reviews its own work it pulls the screen back to its own taste.

**V1 is three parts, none of them a server:**

1. **Capture**, as built: add screenshots or the agent's own page, talk, point, Export.
2. **Memory**: each take goes into the project as its own folder, which the agent reads before designing. Today that's unzip and one line in `CLAUDE.md` or `AGENTS.md` (D165). Writing straight into a chosen folder (Chrome's File System Access) would remove the unzip.
3. **Check**: after the agent draws a screen, a fresh agent compares it with the takes, only what they say, and the agent fixes what it finds. In Claude Code that's one file the export adds, `.claude/agents/pinch-check.md`, and one line in `notes.md`: it ran 12 times in 12, and did as well as running the check from outside. A line alone ran once in 12. For other agents, the same words as a prompt the person pastes, untested.

**Not in v1:** rules or interpretations of notes, picks between designs, a generic critic, and a score shown to the person. Each lost or is unproven, and the check is the one place a judge belongs: inside the loop, built from the person's own pointed notes.

**What would have changed this:** a judge given the author's notes doing no better on their 28 picks than a generic one. It did better, 70% against 32%, so the check went into Export (D174).

## Next, in order

1. **Done 2026-11-07: the author's picks.** The command, for a rerun:

   ```bash
   node --import tsx scripts/hand-vs-pinch/predict.ts ~/pinch-test-2/pinch/<the pointing zip> ~/pinch-test ~/pinch-test-2 ~/pinch-test-3 ~/pinch-test-4 ~/pinch-test-2/round-1 ~/pinch-test-2/round-2
   ```

   It asks 4 judgments of each pair the author didn't call the same, about 110 sessions on the author's plan, and prints both judges' agreement. 28 picks give about ±15 points at 80%. The builds were made from these same notes, so a high score here is easier than on new work.
2. **Done 2026-11-07: the check in the export** (D174). With the file only in the take's folder, as Export gives it, a check ran in 4 builds of 4 (`scripts/taste-harness/print-check.ts` prints what Export writes). Still to try: the author's own project, and what it costs in time.
3. **The same-feedback test on five people** (D165), with the check in: corrections that come back, per screen, over a week of real work.
