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
