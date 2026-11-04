# Hand vs Pinch

Is an agent's work from Pinch's package closer to your taste, for less of your time, than from the same screenshots noted by hand for Claude (D145)? The script is `scripts/hand-vs-pinch/run.ts`.

## The two ways

| | By hand | Pinch |
| --- | --- | --- |
| What you do | Write what you'd tell Claude about each screenshot in `hand/notes.md`. Crop or mark images too, if that's what you'd do. | Add the screenshots, talk them through, Add to your rules, read them into rules, answer Pinch's questions, Export. |
| What the agent gets | The screenshots and your notes. | Pinch's package: the rules, the notes, the marked copies, the close-ups and the review sheets. |
| Your minutes | From the first screenshot to the last note. | From adding the screenshots to the export. Leave out time spent waiting on a reading. |

## Steps

1. Make the folder, outside this repository, since it holds your screenshots:

   ```bash
   node --import tsx scripts/hand-vs-pinch/run.ts init ~/pinch-test
   ```

2. Put 8–12 screenshots in `screens/`: references for one product you're designing, each with something you'd say about it.
3. Write two to four tasks in `test.json`, before making either input. Each is a screen you'd really ask an agent for, in that product ("The pricing page for …, with three plans").
4. **Pinch first.** On your local Pinch, start from empty rules: if Your rules has any, Export them to keep, then Reset rules. Time yourself. Put the export's zip in `pinch/`.
5. **By hand, the next day.** Write `hand/notes.md` the way you'd really write it for Claude, in the time you'd really spend. Time yourself.
6. Put both minutes in `test.json`.
7. Build. Each task is built twice from each input, in your own Claude Code: 12 builds for three tasks, three at a time. It uses your Claude plan, not the API.

   ```bash
   node --import tsx scripts/hand-vs-pinch/run.ts build ~/pinch-test
   ```

8. Judge, without opening `key.json` or `logs/` first. For each pair, pick which build is closer to your taste, and count the changes you'd ask for on each before it's yours.

   ```bash
   node --import tsx scripts/hand-vs-pinch/run.ts judge ~/pinch-test
   ```

   Then open http://localhost:3130. Each verdict saves as you give it.

9. Score. The verdict goes into `results.md`.

   ```bash
   node --import tsx scripts/hand-vs-pinch/run.ts score ~/pinch-test
   ```

## The verdict, set before the test

A tie counts as half a win.

- **Dramatically better**, either way:
  - Pinch's builds win at least 3 in 4 pairs and need at least 40% fewer changes, in no more than 1.25 times your minutes by hand.
  - They win at least half the pairs, in half your minutes or less.
- **Better:** Pinch's builds win more than half the pairs and need no more changes, in no more than 1.5 times your minutes.
- **Not better:** anything else.

## Why it's built this way

- **Pinch goes first.** Whichever way goes second gains from having thought the screenshots through once. So the hand way gets that head start, and a Pinch win holds despite it.
- **Only the input differs.** Both ways get the same prompt (`buildPrompt` in `plan.ts`), model and tools. Each build runs in a folder of its own, outside the test folder, holding only its input. It has no MCP servers (Pinch's included), no skills and no slash commands, and only Read, Write, Glob and Grep.
- **Judged blind.** Builds are named by random ids, sides are random and the pairs are shuffled. The page never says which way made a build.
- **Two builds a task.** One build can be lucky.
- **Changes you'd ask for.** This is the rules benchmark's measure of work: the edits before you'd hand it over. Here you count them yourself, on the rendered page.

## Limits

- One author and a few tasks: a signal, not proof.
- You made both inputs, so you may recognise your own notes' effect in a build.
- The hand way is what you'd really do. If you'd usually put more care into it, do: it's timed.
- Claude Code's default model can change between runs. Set `model` in `test.json` to pin it.

## Privacy

The screenshots stay in the test folder on your machine. The builds send them to Anthropic through your own Claude Code, as any session of yours does. `init` refuses a folder inside this repository.

## Running it without the author

`scripts/hand-vs-pinch/simulate/` runs the test with a made-up designer in the author's place. It can't measure minutes or the author's own eye, only whether Pinch's package carries a known taste further than the same notes beside whole screenshots.

1. A Claude Code session, holding only the screenshots, invents the designer, their hidden taste, their notes and the element each note is about (`simulate/designer-prompt.md`). Check the tasks it writes: they must say what each screen holds, not how it looks.
   Then check its notes against its hidden taste: `simulate/check-notes.ts` has a fresh session find each note whose words go against a taste point and rewrite it without that part, so the judge never marks a build down for following the designer's own words.
2. `simulate/take.ts` says the notes as a take, with the pointer circling each element, so Pinch's own code makes the notes and their marks. Load the session into a local Pinch, open Your rules, have an agent read the notes over the local MCP server, answer any question from the hidden taste, and Export.
3. The hand input is the same notes, word for word, grouped by screenshot in `hand/notes.md`. Then `build` as usual.
4. `simulate/judge.ts` renders each build and judges each pair twice, sides swapped, with a fresh session that holds only the hidden taste. Then `score`.

## Results

### A run with a made-up designer, 2026-11-02

This answers half the question: Claude judged in the author's place, and no minutes were measured.

**Set-up.**
- A session holding only the landing page's 15 screenshots invented a designer, their hidden taste in 14 points, and 34 notes. The designer, Noor, is building Tidewater, a school of craft courses. The tasks it wrote described the look itself, so they were replaced with briefs that say only what each screen holds.
- Pinch's own code made 66 notes from the 34 said, splitting at each full stop, and drew 34 circled areas and 32 dots. An agent read them into 28 rules over the local MCP server. That took three rounds; see the first finding below. Its one question was answered from the hidden taste, with two of its three answers. The package came out at 114 files.
- The hand input had the same 15 screenshots and the same 34 notes, word for word.
- There were three tasks, built twice from each input. Each pair was judged twice, with the sides swapped.

**Results.**

| | By hand | Pinch |
| --- | --- | --- |
| Pairs won (a tie counts half) | 25% | 75% |
| Changes the designer would ask for | 17 | 14.5 |
| Taste points followed, of 14 (mean per judgment) | 9.6 | 10.6 |
| Taste points broken (mean per judgment) | 2.6 | 2.0 |

Pinch won 4 pairs, lost 1 and tied 1. The judge picked the same build both ways round in 5 of the 6 pairs.

By the verdict set in advance, that is **better, not dramatically better**, provided the Pinch way takes no more than 1.5 times the minutes. Pinch won 75% of the pairs, which is enough, but needed only 15% fewer changes, short of the 40% needed.

**Where the package helped.** It carried what is hard to put into words. Each figure below counts the judgments in which a build broke that point, by hand first, then with Pinch:

- a black panel holding glowing artwork beside a light one: 8, then 1;
- thin icons in one colour: 8, then 4;
- the headline at the top of a column, with the paragraph and button pinned to its foot: 6, then 2;
- small grey body text: 4, then 1.

**Where it hurt.** Flat colour blocks running edge to edge were broken 7 times with Pinch and once by hand. One note praised colour blocks overlapping behind a panel. The reading made that a general rule ("overlapping behind pale panels"), and the builds followed the rule over the notes that showed blocks touching edge to edge. A rule widens one note into an instruction, for good and for ill.

**Found in Pinch on the way.**

- **The agent can't finish a reading.** `get_notes_to_read` handed an agent the same 30 notes until Your rules was opened in the browser, though `submit_reading` told it to call again. With 66 notes the reading took three rounds, with the page opened between each. Fixed in D146.
- **Works or doesn't is often wrong.** Guessed from the words, it was wrong on 26 of the 66 sentences. Praise such as "it doesn't shout" was read as a fault, and a plain description before a complaint was read as praise. A person would have to switch two notes in five on the end card.
- **A sentence can lose its subject.** Each sentence becomes its own note. So a second sentence such as "That's calm and readable and I'd keep it" stands alone, with "that" for its subject and a dot for its place.

### The same run again, after D147, 2026-11-02

The same made-up designer, notes, hand notes and tasks. Pinch now makes one note per thing pointed at, reads works or doesn't across the note, weighs rules by how many notes share them, and tells the agent to render and check its work before showing it. Both versions' builds could render their page this time.

- Pinch's own code made 34 notes from the 34 said, not 66. The designer switched 1 on the end card (2 came out mixed), against 26.
- An agent read them into 17 rules in one session, against 28 from 66 notes in three.

| | By hand | Pinch |
| --- | --- | --- |
| Pairs won (a tie counts half) | 8% | 92% |
| Changes the designer would ask for | 17.5 | 7 |
| Taste points followed, of 14 (mean per judgment) | 9.3 | 11.6 |
| Taste points broken (mean per judgment) | 2.9 | 0.8 |

Pinch won 5 pairs and tied 1, and its builds needed 60% fewer changes. On quality, that meets the bar for **dramatically better** set in advance; the verdict still needs the minutes, which only the author can give. The hand builds did no better than in the first run (2.9 taste points broken, against 2.6), so being able to render didn't help them: nothing told them what to check a render against.

**A caveat.** The reading's new guidance on weighing notes was written after the first run lost on this designer's colour blocks. Until it was removed after this run, it used that case as its example. Flat blocks running edge to edge were broken 7 times with Pinch in the first run and 2 in this one. Leaving that point out, Pinch's builds broke the other taste points 17 times in the first run and 8 in this one, so most of the gain doesn't rest on it. A run with a designer none of this was tuned on is the honest check.

**Works or doesn't, on a designer none of this was tuned on.** A second session invented a more critical designer, with 36 notes, 20 of them complaints.

- The words alone filed 15 notes the wrong way round; the old per-sentence reading got 40 of 76 sentences wrong.
- An agent reading them as said aloud (D147) turned 14 of the 15, and turned 2 that were right, leaving 3 of 36 on the wrong side.

### The author's screenshots, a new made-up designer, 2026-11-02

The author gave 25 screenshots: 19 product screens (Asana, Braintrust, Cake Equity, Contra, Deel, Descript, ElevenLabs, Gumroad, Quicken, StackAI, Uxcel, Vimeo, Visitors, hilos) and 6 other references. A new session invented the designer: Noor, designing Setwise, a training log for strength athletes and their coaches, with 15 points of hidden taste and 63 notes. Nothing in Pinch was tuned on this designer. The microphone played no part: the notes went in with their sides as the designer meant them, as typing would give them.

- Pinch's own code made 65 notes. Read from the words alone, it filed 30 of them on the wrong side; the notes were set right before reading.
- An agent read them into 32 rules in one session. With these large screenshots, each answer of 30 close-ups ran past what Claude Code takes, so the agent read many notes from their words alone. That is fixed since (D147: as many as fit in one answer), but this run was read before the fix.

| | By hand | Pinch |
| --- | --- | --- |
| Pairs won (a tie counts half) | 42% | 58% |
| Changes the designer would ask for | 19.5 | 16.5 |
| Taste points followed, of 15 (mean per judgment) | 11.3 | 12.2 |
| Taste points broken (mean per judgment) | 3.0 | 2.3 |

**Better, not dramatically.** Pinch won 3 pairs, lost 2 and tied 1, with 15% fewer changes.

- **Where it helped:** one accent colour, the primary button, one filled button a card, and empty states. Builds by hand broke those 19 times in all, Pinch's 7.
- **Where it hurt:** "key numbers in a light or regular sans", broken 8 times by Pinch's builds and never by hand. One note, "I like the mono numerals in UNREAD / ON YOUR PLATE…", became rule R17, "Set stat figures in monospaced numerals". Listed like any other rule, it was applied to every key figure. The note itself goes against the designer's hidden taste, so part of this is the made-up designer's own inconsistency, but a rule from one note shouldn't steer a whole screen.
- **What neither carried:** a column of about 1,100px with 48px between sections, broken 12 and 10 times. The notes hardly speak of it.

**What it says.** Pinch's gain is largest where taste is hard to put into words: the first designer's glowing artwork panels and pinned columns. Where the notes already say it plainly ("one filled button", "no donuts", "hairline rules"), plain notes carry nearly as much, and a rule widened from one note can cost more than the close-ups give.

**Limits.**

- One made-up designer, whose notes name each element clearly. That is generous to the hand version.
- The judge comes from the same model family as the builders.
- Six pairs, judged on renders cut at 2,400px.
- No minutes were measured.

The test on the author's own screenshots, judged by eye, still decides.

### The author's screenshots again, rules from one note as examples, 2026-11-03

The same designer, the same 65 notes and marks, and the same hand builds: the six pages built by hand are run 3's, unchanged, so only Pinch's side was built again. Two things changed on Pinch's side. A rule from one note is now an example, given after the rules and below them (D148). And the close-ups now reach the agent: it got as many notes as fit in each answer (D147).

- An agent read the 65 notes in four rounds (12, 20, 19 and 14 notes) into 40 rules, 21 of them from one note, so 19 rules and 21 examples. It turned the 2 notes said aloud that were filed the wrong way round, both rightly. Pinch asked no questions.
- "Set stat figures in monospaced numerals" came out again from the same note, now as an example (R31).

| | By hand | Pinch |
| --- | --- | --- |
| Pairs won (a tie counts half) | 25% | 75% |
| Changes the designer would ask for | 21 | 15 |
| Taste points followed, of 15 (mean per judgment) | 11.2 | 12.6 |
| Taste points broken (mean per judgment) | 2.9 | 2.0 |

**Better, closer to dramatically.** Pinch won 4 pairs, lost 1 and tied 1, against 3, 2 and 1 in run 3, and needed 29% fewer changes, against 15%. Dramatically better needs 40%.

- **Mono numerals, down, not gone.** "Key numbers in a light or regular sans" was broken in 5 of 12 judgments by Pinch's builds, against 8, and in none by hand. All 5 came from the weekly overview and the session log. The example says to follow it only where a screen has the same element in the same role as its note, and a stat tile is that element.
- **The accent colour** was broken 2 times by Pinch's builds, against 5.
- **Empty states got worse:** broken 6 times by Pinch's builds, against 2, by a second action or a second sentence. One rule from four notes says to leave the space empty with one sentence; the example from one note says to offer one thing to click.
- **The column** of about 1,100px was still broken by both, 10 times by hand and 8 by Pinch.

**Limits.**

- Two changes at once, the examples and the close-ups, and this run can't tell their effects apart. Reading in smaller rounds also left more rules resting on one note: 21 of 40, against 14 of 32.
- The judge varies. The hand pages were the same as in run 3, yet they needed 21 changes, against 19.5.
- Six pairs and one made-up designer, as before.

### Close-ups said in words, and a tidy, 2026-11-03

The same designer, notes, marks and hand builds again. Two things changed on Pinch's side (D149). Each rule says what its close-ups show of the thing it is about. And once every note is read, the agent tidies the rules: it folds rules about the same thing into the one more notes share, and drops a rule from one note that goes against one from more notes.

- The agent read the 65 notes in four rounds into 35 rules, 31 of them with what their close-ups show, and the key-figures rule from seven notes now says its close-ups show "large sans-serif in regular or thin weight".
- Its first tidy folded the two empty-state rules into one and kept the mono rule, judging that it didn't go against the key-figures rule. The tidy's drop line was then sharpened to compare what the close-ups show, and a second tidy dropped it. That change was made after seeing this designer.
- The package had 33 rules: 29 say what their close-ups show, and some are examples.

| | By hand | Pinch |
| --- | --- | --- |
| Pairs won (a tie counts half) | 42% | 58% |
| Changes the designer would ask for | 18 | 16.5 |
| Taste points broken (mean per judgment) | 2.8 | 2.5 |

**Worse than the last run** (75% and 29% fewer changes). Pinch won both weekly-overview pairs, won and tied the session log, and lost both client rosters.

| Taste point broken by Pinch's builds, of 12 judgments | Run 3 | Run 4 | This run |
| --- | --- | --- | --- |
| Key numbers in a light or regular sans | 8 | 5 | 1 |
| Hairline rules between list and table rows | 0 | 1 | 7 |
| An off-white page, content on white panels | 1 | 1 | 5 |

- **The tidy did what it was for.** Mono key figures all but went.
- **The close-up detail was followed literally.** The table rule said its close-up showed "rows with no borders or dividers", which the designer hadn't judged, and Pinch's rosters left out the row lines the designer wants. The off-white page had been a rule; this time it was only detail under another rule.
- **Limits.** The same hand pages needed 18 changes this time, against 19.5 and 21 before, so at six pairs a run moves by a pair or more on noise alone. The tidy was tuned on this designer.

### Twelve pairs, the notes checked, close-up detail kept from builders, 2026-11-03

The same designer and screenshots, with three changes:

- **The notes were checked against the hidden taste** (`simulate/check-notes.ts`). One note went against it, the praise of "the mono numerals" beside a complaint about colour, so it was cut to the complaint. Both inputs got the checked notes.
- **Builders no longer get what the close-ups show** (D149). The reading and the tidy still use it.
- **Twelve pairs:** each of the three tasks built four times from each input. All 24 pages were built fresh.

The agent read the 65 notes in four rounds into 36 rules, and its tidy folded 3 into others, leaving 33. Nothing was dropped: with the note checked, no rule went against the rest.

| | By hand | Pinch |
| --- | --- | --- |
| Pairs won (a tie counts half) | 8% | 92% |
| Changes the designer would ask for | 39 | 24.5 |
| Taste points followed, of 15 (mean per judgment) | 11.8 | 12.8 |
| Taste points broken (mean per judgment) | 2.8 | 1.7 |

**Pinch won 10 pairs, tied 2 and lost none,** with 37% fewer changes. The judge picked the same page both ways round in 10 of the 12 pairs. By the verdict set in advance, that is better and close to dramatically better: the pairs are there (92%, against 75% needed), the changes just short (37%, against 40%). The minutes are still the author's to give.

- **Where Pinch's builds did better:** the primary button (broken 2 times, against 8 by hand), one filled button a card (2, against 8), one accent colour (6, against 11), empty states (4, against 8) and small labels in mono or spaced caps (0, against 3).
- **Where they did worse:** the off-white page with content on white panels, broken 10 times, against 7. The notes say it only by contrast, and the rules didn't carry it.
- **What neither carried:** the column of about 1,100px with 48px between sections, broken 17 times by hand and 14 by Pinch.

**Against the runs before.** A pair of hand pages needed about 3.25 changes in every run (3.25, 3.5, 3.0 and now 3.25), so the judge holds steady on them. A pair of Pinch's needed 2.75, 2.5 and 2.75, and now 2.0.

**Limits.**

- The check took out a note that had cost Pinch, not the hand builds, in every earlier run. That is the check doing its job, since the note went against the taste the judge holds, but it is most of why the mono figures are gone.
- The tidy's line on dropping was sharpened after seeing this designer. In this run it dropped nothing.
- One made-up designer, judged by the same model family that builds, and no minutes.

### A fresh designer on new screenshots, 2026-11-03

The check of whether the last run's gain is Pinch's or the tuning's. The author gave 30 new screenshots, full pages from Airbnb, Asana, Brilliant, Circle, Cloudflare, Contra, Duolingo, Etsy, Fey, GitBook, Headspace, Kajabi, Loom, Luma, Notion, OpenSea, Origin, PandaDoc, Patreon, Peerlist, Shopify, Substack, SuperHi, Tines, Uxcel and Wise. A new session invented the designer: Ines Varga, designing Tally, a money app for freelancers, with 15 points of hidden taste and 66 notes. Nothing in Pinch was tuned on them.

- The check found no note against the hidden taste.
- Pinch's own code made 67 notes; read from the words alone it filed 25 on the wrong side, and the designer set them right on the end card.
- The agent read them in four rounds into 37 rules. Its tidy folded 2 into others and dropped 1, an eyebrow label in bold sans from one note, against three notes whose close-ups show such labels in mono. That left 34.
- Twelve pairs, as in the last run: three tasks, each built four times from each input.

| | By hand | Pinch |
| --- | --- | --- |
| Pairs won (a tie counts half) | 42% | 58% |
| Changes the designer would ask for | 23 | 19 |
| Taste points followed, of 15 (mean per judgment) | 12.6 | 12.8 |
| Taste points broken (mean per judgment) | 1.3 | 1.0 |

**Better, not dramatically.** Pinch won 6 pairs, lost 4 and tied 2, with 17% fewer changes. The 92% of the last run didn't carry over.

- **Both did well.** This designer's notes name its taste plainly ("the backdrop needs to be paper", "just a small grey dot and a word on each row, and the rows are only split by thin rules"), and builds from the notes alone broke little more than one taste point a judgment. The judge was choosing between two nearly right pages, on small things.
- **Where Pinch's builds did better:** cards with a hairline border and no shadow (broken 2 times, against 8 by hand), rows inside one container (0, against 3), the one accent colour (1, against 3) and the off-white page (0, against 2).
- **Where they did worse:** serif only for page titles (3, against 1), as a rule about serif headlines was carried to section headings; and small labels (5, against 2), set below 11px or out of mono. Both missed the status dot and the empty states 4 times each.

**What the runs say together.** Pinch's gain is largest where taste is hard to put into words, as with the first designer's glowing panels and the second's mono figures. Where the notes already say it plainly, plain notes beside the screenshots carry nearly as much. A made-up designer writes plainer notes than a person talking over a screenshot, so the author's own test, timed and judged by eye, still decides.

**Limits.**

- One fresh designer, judged by the same model family that builds, and no minutes.
- The builds by hand broke so little that a pair often turned on one detail, so the share of pairs moves a lot on little.

### The fresh designer again, after D150, 2026-11-03

The same notes and the same 12 builds by hand; only Pinch's side was read, tidied and built again. The tidy now restores details a note gives that no rule kept, rules from one note that came through it stand as rules, and the rules say a rule holds for what it names.

- The agent read the 67 notes into 39 rules; the tidy folded 1, reworded 7 to carry details their notes gave, and added none, leaving 38. A rule for "a small grey dot and a word" came from the reading itself this time, and signed changes became a rule for every figure, not an example for tables.
- No rule was left an example.

| | By hand | Pinch |
| --- | --- | --- |
| Pairs won (a tie counts half) | 46% | 54% |
| Changes the designer would ask for | 23 | 13.5 |
| Taste points broken (mean per judgment) | 1.4 | 0.8 |

**Fewer changes, not more pairs.** Pinch's builds needed 41% fewer changes, against 17% before, and broke the status dot 0 times (4 before), the small labels 1 (5), money amounts 1 (3) and the card style 0 (2). But Pinch won 5 pairs, lost 4 and tied 3.

- **What lost the pairs:** serif section headings (4 judgments, against 3 before; the new line on what a rule names didn't stop it), and the payments list set loose on the page rather than in one container with thin rules (3, against 0), since the reading made thin rules a rule for settings and tables and space a rule for lists.
- **Near the ceiling, pairs turn on little.** In several pairs Pinch's build broke nothing, and the judge picked the other for initials in a circle or a timestamp. The changes count says more here than the pairs do.
- **Limits.** The fixes came from this designer's losses. A third designer, on new screenshots, is the check.

### A third designer on new screenshots, after D150, 2026-11-03

The check of D150 on material it wasn't built from. The author gave 35 new full pages (Coinbase, Cosmos, Craft, Deel, DoorDash, Equals, FLORA, Gamma, Givingli, Hers, Klarna, Luma, Medium, Mixpanel, Netflix, Nike, Open, Pitch, Preply, Programa, Replit, Runway, Spotify, The New Yorker, Tines, Typeform, Uber Eats, Vimeo, Wise, komoot). One was a copy of another and was left out, leaving 34. A new session invented the designer: Mara Ellison, a former magazine and menu designer, designing Slow Hours, class booking for small yoga studios, with 15 points of hidden taste and 86 notes.

- The check rewrote one note, which put a number's label above it where the taste puts it beside or under.
- The screenshots came to 114 MB, past the 60 MB a local run takes in one batch (`MAX_MEMORY_BATCH_BYTES`; Pinch with a store uploads straight to it). So they went in as four takes, of 6, 6, 9 and 13 screenshots.
- The agent read the 86 notes in six rounds into 53 rules; the tidy folded 6 and reworded 7, leaving 47, none an example.

| | By hand | Pinch |
| --- | --- | --- |
| Pairs won (a tie counts half) | 75% | 25% |
| Changes the designer would ask for | 28 | 40 |
| Taste points broken (mean per judgment) | 1.8 | 3.0 |

**Not better: worse.** Pinch won 1 pair, lost 7 and tied 4, and its builds needed 43% more changes.

- **A rule from one note, made for the very task.** One note praised a booking grid; the reading made it R7, "Show time slots as thin-outlined boxes in day columns", where: "in booking and schedule grids". The first task was a weekly class schedule, so every Pinch build of it was a grid of boxed tiles, against the designer's hairline rows like a printed menu (broken 6 times, against 1 by hand). Pinch won none of those four pairs.
- **Another, against a rule from four notes.** One note's plain list of actions with a chevron each became R33; the builds made the booking's secondary actions chevron rows, though R24, from four notes, says small actions are underlined text links. The tidy didn't see the two pull apart.
- **A rule kept too narrow.** Serif for longer text became a rule "in long-form reading", and Pinch's builds set class descriptions in sans (12, against 7).
- **What the notes beside the screenshots did instead.** Each of those notes was one of 86, on another product's screen. The builds by hand read them as that and built the schedule as the notes as a whole describe it.

**What the runs on untuned designers say.** Pinch won 58% and 54% of pairs on the second designer and 25% on this one. Most of the ground Pinch's builds lost, in every run, came from one kind of fault: something drawn from one note or one close-up, widened to whole screens or matched to the task. That covers the first designer's colour blocks, the mono figures, the close-up detail of run 5 and this schedule grid. Where Pinch won, it won on what several notes share. Until a rule from one note stops steering builds, Pinch isn't reliably better than notes beside screenshots.

### Single notes as notes, all three designers again, 2026-11-03

D151: a rule from one note no longer reaches builders as a rule. They get its note, with its close-up and screenshot, after the rules, to read as a note beside a screenshot. Each designer's rules were exported again from the reading already made, and only Pinch's 12 builds were made again; the 12 by hand are the same as before.

| Designer | Rules, single notes | Pairs won by Pinch, before, then now | Changes, hand and Pinch, before | Changes, hand and Pinch, now |
| --- | --- | --- | --- | --- |
| Noor (first, author's screenshots) | 17, 16 | 92%, then 71% | 39 and 24.5 | 36 and 21.5 |
| Ines (second) | 18, 20 | 54%, then 50% | 23 and 13.5 | 18.5 and 17 |
| Mara (third) | 24, 23 | 25%, then 92% | 28 and 40 | 31.5 and 15.5 |
| All 36 pairs | | 57%, then 71% | 90 and 78 (13% fewer) | 86 and 54 (37% fewer) |

**Better over all three, short of dramatically.** Pinch won 71% of the 36 pairs and needed 37% fewer changes.

- **The third designer turned round.** Pinch's builds broke 1.0 taste points a judgment, against 3.0, and won all four weekly schedules: the booking-grid note was now a note about Preply's screen, not a rule for schedules. Secondary actions as text links were broken 2 times, against 8 by D150's builds and 11 by hand.
- **The first held,** with fewer changes; more pairs were ties (5).
- **The second slipped.** Its notes say its taste plainly, and some details lived only in single notes. As notes they lost force: small labels broken 7 times (1 before), list rows inside one container 8 (3 before).
- **The judge varies.** The same builds by hand needed 39 then 36, 23 then 18.5, and 28 then 31.5 changes.

**What it says.** Pinch helps where it gathers what several notes share and shows the author's close-ups; it hurts where it turns one note into a rule. Giving a single note as a note keeps the help and drops most of the hurt. The cost is a designer whose plain single notes were right: the open question is how to keep those details without widening them.

### Teaching from corrections: the test, set before it runs, 2026-11-04

Every note so far is on someone else's screen, and most of what Pinch lost came from carrying such a note over to a new product. A correction on the agent's own work needs no carrying. Does it reach a new task, and does Pinch carry it further than a notes file does?

**The rounds,** for each of the three designers, whose three tasks stay in their order:

1. A session holding the hidden taste corrects one build of task 1, as the designer would talking over the render: at most five notes, each on an element it can point at (`simulate/correct.ts`). Task 2 is then built twice with those corrections.
2. The same, correcting one of those builds of task 2. Task 3 is built twice with both rounds' corrections.

**Four ways,** so 12 builds to compare in each, 4 from each designer:

| | Without corrections | With corrections |
| --- | --- | --- |
| Pinch | the D151 builds | Each way corrects its own work. The notes go in on the render, marked as Ours, are read and tidied, and the package is exported again. |
| By hand | the same builds as before | Each way corrects its own work. The corrections are kept in `notes.md` and the renders beside it: more than a chat, which loses them when it ends. |

**Judged as before:** blind, each pair twice, sides swapped, 12 pairs for each of three comparisons.

**The verdict, set now:**

- **Do corrections carry to a new task?** Pinch with them against Pinch without. They carry if Pinch with them wins more than 60% of pairs and needs at least 25% fewer changes.
- **Does Pinch carry them further than a notes file?** Pinch with them against by hand with them, on the test's own scale. Dramatically better: at least 75% of pairs and 40% fewer changes. Better: more than half the pairs and no more changes. Anything else: not better.
- **By hand with them against by hand without** shows whether the corrections help on their own, whoever keeps them.
- **Over the rounds,** each round has only 6 pairs, so it is reported as a signal, with no verdict.

**A limit known now:** a made-up designer corrects from a perfect key to its own taste, and a person won't. This shows the most that corrections can carry.

### Teaching from corrections: the results, 2026-11-04

Two rounds on each of the three designers: 29 corrections by hand and 27 with Pinch, 6 of each saying what to keep. At the simulated take's pace, each round is about a minute of talking.

| Comparison, 12 pairs each | Pairs won by the first | Changes, first and second | Verdict set in advance |
| --- | --- | --- | --- |
| Pinch with corrections against Pinch without | 100% | 22 and 56.5 (61% fewer) | **They carry** (needed more than 60% of pairs and 25% fewer) |
| By hand with corrections against by hand without | 100% | 27 and 60 (55% fewer) | They help whoever keeps them |
| Pinch with corrections against by hand with them | 67% | 27.5 and 40 (31% fewer) | **Better, not dramatically** |

**Corrections are the largest gain any test has found.** The first version with them won all 24 of its pairs against the same version without. Everything tried on the rules gave at most 37% fewer changes over all three designers (D151), and that was against plain notes rather than against itself.

**By designer, Pinch against by hand, both with corrections:** Noor 88% of pairs (9 changes and 14.5), Ines 62% (9 and 12), Mara 50% (9.5 and 13.5). Pinch needed fewer changes on all three.

**Over the rounds, a signal on 6 pairs each.** In the first round, Pinch with corrections won 42% of pairs with 6% fewer changes than by hand with them; in the second, 92% with 47% fewer. Pinch's builds needed about as many changes in both rounds (14.5 and 13), while the builds by hand needed more on the second round's task (15.5 and 24.5). The tasks differ, so this may be the task and not the rounds.

**Where Pinch carried a correction further:** as a rule rather than a line in a file.

- Noor's column of about 1,100px, which no version had carried in any earlier run: broken 0 times by Pinch's builds, against 7 by hand, though both had been told.
- Ines's cards with a hairline border and no shadow: 0, against 6.
- Mara's real photographs: 0, against 4.

**Where it fell behind:** Noor's corner radius (4, against 0), and small labels on Ines and Mara (3 and 2, against 1 and 0). Empty states were missed about equally by both, since no correction spoke of them.

**Limits.**

- A made-up designer corrects from a perfect key to its own taste, so its corrections say exactly what the judge wants. A person's will be vaguer and sometimes wrong. This is the most corrections can carry.
- By hand here keeps its corrections in `notes.md`, more than a chat does. A chat that loses them when it ends is nearer by hand without corrections, but that pairing wasn't judged.
- Twelve pairs a comparison, one build corrected each round, the same model family judging, no minutes.
