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

### Corrections alone: the test, set before it runs, 2026-11-04

If corrections carry that far, are notes on reference screenshots needed at all? They take the most time, and most of what Pinch lost came from them.

**The rounds,** for each of the three designers, with no notes on references and an empty Pinch:

1. The agent builds task 1 with no taste to go on. The designer corrects it, at most five notes (`simulate/correct.ts`), and they go into Pinch on the render, marked as Ours, are read and exported. Task 2 is built twice from that package.
2. The designer corrects one of those builds, the same way. Task 3 is built twice from both rounds' corrections.

**Compared,** blind, each pair twice, 12 pairs each, against builds already made for the last test:

- **Pinch from reference notes,** without corrections: what Pinch asks of a person today before anything is built.
- **Pinch from reference notes and corrections,** which had the same two rounds of corrections.

**The verdict, set now:**

- **Can corrections alone stand in for reference notes?** Against reference notes without corrections: they can if they win more than half the pairs and need no more changes.
- **Do reference notes still earn their time once a person corrects?** Against notes and corrections: notes add little if corrections alone win at least 40% of pairs and need no more than 25% more changes. Otherwise they still earn their time.
- **The time** is reported at the simulated take's pace, spoken minutes only.

**Limits known now:** a made-up designer corrects from a perfect key, which flatters this test more than any other, since corrections are all it has. A person starting from nothing may not know yet what they want to say. Only Pinch's way is tested, not corrections alone in a notes file.

### Corrections alone: the results, 2026-11-04

An empty Pinch for each designer, two rounds of five corrections each, 10 to 14 rules at the end. The first build, with no taste to go on, took each designer's first five corrections.

| Corrections alone against, 12 pairs each | Pairs won | Changes, alone and the other | Verdict set in advance |
| --- | --- | --- | --- |
| Reference notes, no corrections | 33% | 54.5 and 44 (24% more) | **They can't stand in** |
| Reference notes and corrections | 8% | 62.5 and 23 (172% more) | **Reference notes still earn their time** |

**Reference notes stay,** even in a test that flatters corrections. The two kinds of note do different work. Reference notes reach across the taste, and corrections reach only what the one build got wrong. Noor's and Ines's builds from corrections alone broke about five taste points a judgment, against about one for reference notes and corrections. Ten corrections leave much unsaid: Noor's never spoke of the page background and Ines's did only in passing, and it was broken in 5 and 8 of 8 judgments.

**By designer,** against reference notes without corrections: Noor 0% of pairs, Ines 38%, Mara 62%, with fewer changes on Mara alone (10 and 16.5).

**They catch up fast, as a signal on 6 pairs each.** After five corrections, corrections alone won 8% of pairs with 82% more changes than reference notes. After ten, they won 58% with 13% fewer. At the simulated take's pace that is about 2.5 minutes of talking, against 10 to 13 for the reference notes. The tasks differ between the rounds, and a third round wasn't run.

**What it says.** Do both. Reference notes give the breadth, and corrections then give the largest gain. Against reference notes with corrections, nothing else tested comes close.

**Limits.** Made-up designers correcting from a perfect key, 12 pairs a comparison, the same model family judging, and spoken minutes only, not a person's time.

### The author's trial: set before it runs, 2026-11-05

Every result above comes from made-up designers correcting from a perfect key. This is the first run with a person. It also decides whether to build a loop, where Pinch carries on past Export: a person corrects what their agent made, and each version has to beat a plain notes file. None of that loop is built until this passes (D154).

**The start** is the test at the top of this page, as written: 8–12 references for one product the author is designing, three tasks, Pinch first and by hand the next day, standalone pages. That's 12 builds and 6 pairs, judged blind by the author, in real minutes.

**The product is Pinch,** where the author's taste is strongest, with 10 references chosen by Claude from screenshots the author gathered, at the author's request, so the author may have less to say about some: Vimeo Web, Equals Web 0, Gumroad Web 9, GitBook Web 258, Luma Web 355, Headspace Web 114, Cloudflare Web 170, Tines Web 11, The New Yorker Web 15, Fey Web 123. Each build still starts from an empty folder, so it sees only its input and the task, not Pinch's code. The tasks, written before either input:

1. The pricing page for Pinch, with one plan at $19 once.
2. The account page for Pinch: email, purchase, credits, the agent connection and deleting the account.
3. Your rules in Pinch, with 30 rules grouped by topic and one question waiting.

**Then two rounds of corrections,** each started with `run.ts round <dir>`, which refuses until every pair so far is judged:

1. The script draws the first build of the task from each way, in `round-N/`. This says which way made it, so it comes only after those verdicts are saved.
2. **Pinch:** add `for-pinch-N.png` to Pinch, say "This is ours", talk over it, Add to your rules, read them, Export. The zip goes in `round-N/pinch/`.
3. **By hand:** write the corrections in `round-N/hand/notes.md`, in place of the line asking for them.
4. Each way corrects its own build, at most five notes, and both are timed. The minutes go in `round-N/test.json`.
5. `build`, `judge` and `score` on `round-N`: the next task, built twice each way, for 4 builds and 2 pairs.

Round 1 corrects task 1 and builds task 2. Round 2 corrects task 2 and builds task 3, from both rounds' corrections. `score` on the test folder then gives both verdicts.

**The verdict, set now.** The rule at the top of this page, twice:

- **References:** on the first 6 pairs, does Pinch's package beat notes by hand?
- **The loop:** on the last 4 pairs, with the minutes of both rounds. Build it only if these reach **Dramatically better** and the author answers yes to "would you do another round unprompted?". Anything less and it isn't built.

**Limits known now:**

- Standalone pages, with no design system. A design system trial follows only if this passes.
- Ten pairs and one person. Earlier runs moved by a pair or more on noise alone, so this decides what to build next, and it isn't a claim about Pinch.
- The author made Pinch and wants it to win. Only the judging is blind: correcting says which way made the build being corrected.
- Pinch goes first each time, which gives the hand way a head start in thinking it through.
- It doesn't test a new version having to beat the last one, which needs more rounds than this.
- Where the words come out wrong, that counts against Pinch: a real user would hit the same thing.

### The author's trial: as it ran

**Pinch's side, 2026-11-05.** The author talked through the 10 references on the live site rather than a local Pinch, so the words were read in the browser by the smaller model (D140), and some came out wrong: "hello colored buttons with no feeling" on an outlined button. They stay as they came, as set in advance. 65 notes, read into rules, then tidied by the agent, with 3 rules reworded. The first reading wasn't the agent's: it stopped within a minute, and the notes kept being read. The package holds 23 rules and 18 single notes.

**Minutes: about 17,** from the session's timestamps, not a timer: 14 from adding the images to Add to your rules, 3 answering Pinch's questions and exporting, with the wait for the reading left out.

**The hand way, 2026-11-05.** The author asked Claude to do this part. Claude didn't write any notes: `hand/notes.md` is the words of the author's own take, copied word for word and grouped by screenshot, wrong words included, as the test runs with made-up designers do. So this compares what Pinch adds to the same words. It doesn't compare Pinch with what the author would have written by hand, which would likely be more considered and free of misheard words, and might come with crops. No minutes by hand were measured.

**The builds, 2026-11-05.** The first 6 of the 12 to start all reached the 20-minute limit, 3 from each way, and their logs are empty, so the cause isn't known. One had already written a whole page. All 6 were built again with the limit unchanged, the written page set aside unseen, so that every build ended on its own. The 12 that count took about 6 to 11 minutes each.

**References: Not better, 2026-11-05.** The author judged the 6 pairs blind. Pinch's package won 1 of them and its builds needed 18 changes against the plain file's 10, 80% more. Two builds from the plain file needed none. With under half the pairs, the rule gives Not better at any minutes, so the missing hand minutes don't matter; `score` still prints "Needs the minutes" because it looks at those first.

| Task | Run | Closer | Changes by hand | Changes Pinch |
| --- | --- | --- | ---: | ---: |
| Pricing | 1 | By hand | 0 | 3 |
| Pricing | 2 | Pinch | 6 | 3 |
| Account | 1 | By hand | 0 | 4 |
| Account | 2 | By hand | 2 | 3 |
| Your rules | 1 | By hand | 1 | 3 |
| Your rules | 2 | By hand | 1 | 2 |

This reverses the last run with made-up designers, where Pinch won 71% of 36 pairs. Only the third of them had gone this far the other way, at 25%, before single notes became notes. A made-up designer's taste is a list of points, which is what rules are, and that may be part of why they scored higher.

**What the builds and the package show,** read by Claude after the judging, and not tested:

- **The package holds back what the author liked most.** Builds from the plain file carried "white on a color" across the whole page, with lilac behind white cards and very large titles. The package keeps its colour rules (R4, R10, R11) to marketing heroes and tells agents never to make a single note a pattern, which is where "white on a color" sits. One account page from it has a gradient strip on grey. The author on the page it lost to: "the background with the card is much more fresh".
- **Rules outrank the author's words.** Two notes for dividers became R2, a core rule. Two against stayed single notes, and the package says rules win. One build says so: "R2 comes from two notes and R33 from one, so R2 wins". The author praised "the lack of dividers".
- **Rules say more than the notes.** "I like the color." became three rules. "This alert banner is pretty straightforward, good execution." became two. They carry a description rather than the look: "a soft pastel background".
- **Some labels are wrong.** At least 10 of the 53 notes labelled as working are doubts or complaints, such as "I'm not sure about it" and "The search looks very, very old with the sharp edges." `verdictOfClaim` counts a note with no clear lean as good. The plain file has no labels, so its builds read the words.
- **Rules became content.** One account page draws "Too wide." and "R17" into its illustration.

**Limits of this result:**

- Six pairs and one person: 5 of 6 comes up by chance about 1 time in 9. Against that, the author wants Pinch to win and judged blind.
- Both ways had the same words, so this says nothing about notes really written by hand, which would probably have done no worse.
- Three of the six Pinch builds didn't run `check-render.js`, because the test only lets a build run `render.mjs`. In a real project they could. The checks measure text sizes and contrast, so it's unlikely to explain this.

### Pointing without the rules: the test, set before it runs, 2026-11-05

The package lost to the same words in a plain file, but it holds two things: where the author pointed, and the rules read from that. This takes the rules away, to see which one lost (D155).

**The two ways.** By hand is as before: the 10 screenshots and `hand/notes.md`, the 65 notes word for word. The other way is the same screenshots and the same notes in the same order, plus each note's number and close-up, and the marked copies. So the only difference is the pointing. It has no rules, no checks, no labels, no review sheets and none of the package's instructions. The marks keep the colours Pinch gave them, which come from the labels, so its notes file says "A mark's colour means nothing."

**The run.** Same tasks, 2 runs each, 12 new builds and 6 pairs, judged blind by the author, in `~/pinch-test-2`. The script is unchanged: the second way is a zip in `pinch/`, so its results say "Pinch".

**The verdict, set now.** No hand minutes exist, so this reads the pairs and the changes, on the thresholds at the top of this page:

- **Pointing carries it:** at least 75% of pairs and 40% fewer changes. The package should lead with the author's words and marks, and the rules step back.
- **Pointing helps:** more than half the pairs and no more changes. The same direction, on weaker evidence.
- **Pointing adds nothing:** anything else. Words and screenshots do as well, and Pinch would have to earn its place by being faster than writing, which then needs real hand minutes.

**Limits known now:**

- Six pairs and one person, as before.
- It doesn't compare the rules with the pointing directly: each is measured against the plain file, on different builds.
- The author has seen the first builds, knows the plain file won, and has read Claude's reasons, which may colour what they look for. The judging is still blind.
- The notes are still the words as they came out, wrong words included, and neither way is writing really done by hand.

### Pointing without the rules: the results, 2026-11-05

**Pointing carries it.** Judged blind, the same words with marks and close-ups won all 6 pairs and needed 7 changes against the plain file's 24, 71% fewer. All 12 builds finished the first time. `score` says "Needs the minutes", and its "Pinch" column is the pointing, as set above.

| Task | Run | Closer | Changes plain file | Changes pointing |
| --- | --- | --- | ---: | ---: |
| Pricing | 1 | Pointing | 4 | 1 |
| Pricing | 2 | Pointing | 3 | 1 |
| Account | 1 | Pointing | 3 | 1 |
| Account | 2 | Pointing | 4 | 1 |
| Your rules | 1 | Pointing | 6 | 2 |
| Your rules | 2 | Pointing | 4 | 1 |

It's the first time anything has reached these thresholds with a real person. So far, one person has ranked them: the same words with pointing, over the plain file, over the rules. That order joins two sittings and hasn't been tested head to head.

**Why isn't known.** No build's report says it used the close-ups, though the reports don't list what a build opened, and the two ways look alike: lilac, white cards, ink hands. In the 3 pairs Claude opened, the pointing builds kept to one centred column or a narrow card where the plain file's split the page into two columns or a wide card. The author's one note in this sitting agrees: "side by side like the left one is not a good option". The rules' narrow column lost in the first sitting, though, so width alone doesn't explain it.

**Limits of this result:**

- **Change counts depend on what's beside them.** The same plain file needed 10 changes in the first sitting and 24 in this one. A pricing page from it got 0 there, and a near twin got 4 here. So read the pairs first, and don't compare counts across sittings: 7 here and 18 for the rules there say nothing about each other.
- Six pairs from one person, one take, one set of references and the same three tasks. 6 of 6 comes up by chance about 1 time in 64.
- The author had seen the first builds and Claude's reasons, though both ways here carry the things those reasons named.
- This is pointing against the same spoken words without pointing. It says nothing yet about notes really written by hand, or about minutes.

### Pointing against the rules: the test, set before it runs, 2026-11-05

Two sittings put pointing above the plain file and the plain file above the rules, but nothing has put the two side by side, and change counts moved between sittings. Reading notes into rules is also the paid step (D98), so this decides what the package leads with (D156).

**The two ways.** Both come from the author's same take, so the words, marks and close-ups are the same.

- **Pointing** is the input from the last test: the screenshots, the notes with their numbers and close-ups, and the marked copies.
- **Rules** is the whole export as it first ran: the rules, notes, labels, checks, close-ups, marked copies, review sheets and instructions.

**The run.** Same tasks, 2 runs each, 12 new builds and 6 pairs, judged blind by the author, in `~/pinch-test-3`. The script is unchanged. Pointing sits in its hand slot and the rules in its Pinch slot, so in `results.md` "By hand" means pointing and "Pinch" means rules. The minutes come from the same take: 14 for pointing and 17 for rules, which leaves out the wait for the reading and its credits.

**The verdict, set now,** from pointing's side:

- **Pointing wins:** at least 75% of pairs and 40% fewer changes. The package leads with the author's words and marks, and the rules step back.
- **Pointing holds:** at least half the pairs and no more changes. Rules cost minutes, a wait and credits and don't pay for them here, so they stop being the default.
- **Rules ahead:** anything else. The sittings contradict each other, neither result stands, and the package stays as it is until a fresh take settles it.

**Limits known now:**

- Six pairs, one person, one take, and the author's third sitting on the same three tasks.
- A rules build that draws a rule number into its page, as one did in the first sitting, gives itself away. Such builds stay in, and Claude counts them in the results without telling the author beforehand.
- Neither way is notes really written by hand.

### Pointing against the rules: the results, 2026-11-05

**Pointing wins.** Judged blind, pointing won 5 of 6 pairs and needed 8 changes against the rules' 16, 50% fewer, in 14 minutes against 17 and the wait for a reading. `score` says "Not better" because its "Pinch" column is the rules here.

| Task | Run | Closer | Changes pointing | Changes rules |
| --- | --- | --- | ---: | ---: |
| Pricing | 1 | Pointing | 1 | 4 |
| Pricing | 2 | Pointing | 1 | 3 |
| Account | 1 | Pointing | 1 | 4 |
| Account | 2 | Rules | 3 | 1 |
| Your rules | 1 | Pointing | 1 | 2 |
| Your rules | 2 | Pointing | 1 | 2 |

**The three sittings agree,** on one take:

| Sitting | Closer | Pairs | Changes |
| --- | --- | ---: | --- |
| Rules against the plain file | Plain file | 5 of 6 | 10 and 18 |
| Pointing against the plain file | Pointing | 6 of 6 | 7 and 24 |
| Pointing against the rules | Pointing | 5 of 6 | 8 and 16 |

**Rule numbers may have given builds away.** Three of the 6 rules builds show a rule number in their text, such as "R15", and all 3 lost. No pointing build shows one. Without those pairs, pointing won 2 of 3 and needed 5 changes against 8, 38% fewer: the same direction, just short of the 40% bar.

**What the pages show,** from the 2 account pairs Claude opened, as the author left no notes this time, and not tested:

- With one column each way, flat lilac behind white cards beat a gradient fading into grey, 1 change against 4. The first sitting's widest gap on this task was the same contrast, 0 against 4. The package keeps its colour rules to marketing heroes, which fits, but doesn't prove it.
- The rules' one win beat a pointing build that set its cards side by side. Side by side also lost on lilac in the last sitting, where the author wrote "side by side like the left one is not a good option". So the layout may count for more than which way made the page.

**Limits of this result:**

- One person, one take of 65 notes, one set of references and the same three tasks, on the author's third sitting. 5 of 6 alone comes up by chance about 1 time in 9.
- 65 notes are few enough for an agent to read whole. Rules may earn their place at hundreds of notes, or across months and projects, which this can't see.
- Standalone pages, not work in a repository with a design system, where D154 says Pinch's people work.
- Neither way is notes really written by hand, so "better than manual" is still untested, and so are hand minutes.

### The package changed, 2026-11-05

Since D157, Pinch's Export gives the words and the pointing with no rules, so "Pinch's package" above means the older export, which is now Back up. For a new test or a round, the Pinch side is: add the screenshots, talk them through, Export, and put the zip in `pinch/`, with no reading and no questions. The two rounds set above haven't run. They still decide whether to build a loop, on this package, and their written corrections would be the first notes really written by hand.

### The rounds on the new package: set before they run, 2026-11-05

What changes from the rounds set in D154 (D158):

- **The folder is `~/pinch-test-2`,** whose two ways are the plain file and pointing. Each way corrects its own first build of the pricing page, then the account page.
- **Pinch's way:** the new build on the author's machine in Chrome, since it isn't deployed and the app's own browser blocks the microphone: a production build with the browser's voice model, as the live site has. The author's 65 notes are loaded into it first through Pinch's own import, which redraws their marks in one colour; the words came back identical to the plain file. The author talks over the build, says "This is ours", and presses Export. The zip holds the 65 notes and the corrections so far.
- **By hand:** Claude shows the build, and the author types at most five corrections as a message in the chat, which is how someone corrects Claude by hand. Claude copies them word for word into `hand/notes.md`.
- **Minutes** come from the session's timestamps: for Pinch from the author's "start" to their "exported", leaving out the wait for the words to be read as the author estimates it, and by hand from Claude showing the build to the author's message.

**The verdict doesn't change.** On the last 4 pairs, the rule at the top of this page, with these minutes: build a loop only at **Dramatically better**, and only if the author answers yes to "would you do another round unprompted?".

**Limits known now:**

- Four pairs and one person. The first real microphone on this package is also its first correction.
- Only the judging is blind: correcting says which way made the build being corrected.
- Pinch goes first each time, though each way corrects a different build.
- The hand way's earlier notes are the author's spoken words, as before. Only its corrections are really written by hand.

**Round 1, first try, 2026-11-05: thrown out.** The take's words came back as 21 notes of looping nonsense, so nothing was built from it and its minutes don't count. The recording itself was sound: 94 seconds from the built-in microphone at a normal level, with long pauses between a few short sentences. On the same audio, the larger model on this machine (whisper.cpp, large-v3-turbo) heard "I'm missing the secondary button." and "I have nothing bad to say at this time.", and invented a little in the pauses. The browser's model (whisper-base.en) heard "I'm using the a continued button." and "I have nothing but to see it this time.", and filled the pauses with loops. 205 of its 264 words had no length, against none of 297 on a synthetic take with no pauses, but dropping those still leaves loops. So the small model needs talk without long pauses, as in the author's first take, and Pinch gave no warning before exporting the result.

**The rounds use the larger model (D159).** At the author's choice, round 1 and round 2 read the words with whisper.cpp's large-v3-turbo on this Mac, not the browser's model. This replaces "wrong words count against Pinch" and "with the browser's voice model" above. So the result says whether talking and pointing beats typing, and not whether the live site's words are good enough, which this first try says they aren't for talk with long pauses.

**Round 1, as it ran.** The second try read well, and "This is ours" was heard. The author said more than five things, so the limit of five notes was lifted for the typing too: each way says as much as it would. One thought often split across several notes at the author's pauses, 19 in all, kept as they came. Chrome had lost the local sign-in, so its export held only this take, and Claude added the 65 notes to the zip as a signed-in export would have them, with the words untouched. Minutes are in `round-1/test.json`, from the session's timestamps, with about 12 seconds' wait for the words taken off Pinch's and the clock restarted when the author asked what to type.

**Round 1's result.** The account page, judged blind: pointing won both pairs and needed 5 changes against typing's 7, 29% fewer, in 3 minutes against 3.7. The author's notes on the pairs: pointing's illustrations and icons were better, and typing's font and two cards side by side were better, both things the author's typed corrections had named.

**Round 2, as it ran.** The author signed in again in Chrome. Its export brought back the 21 notes of the thrown-out try in place of the 19 real ones, probably because Claude deleted them on the server while the tab was open and the tab saved them back. Claude built the round's zip from round 1's real zip and this take's 12 notes, words untouched, so it holds 65, 19 and 12. Minutes are in `round-2/test.json`.

**Round 2's minutes by hand, set before its pairs are judged.** The timestamps give 10.2 minutes, against 3.7 in round 1. The author first wasn't sure, then confirmed they didn't step away, so `round-2/test.json` holds 10.2, which includes any time spent looking and thinking. Whether the message was typed or dictated isn't known. At round 1's pace of 31.6 words a minute, its 177 words would take 5.6 minutes, so the result also says what the verdict would be at that figure.

### The rounds: the results, 2026-11-06

**Dramatically better, on the minutes.** Judged blind, pointing won 3 of the 4 pairs and needed 9 changes against writing's 12, 25% fewer, in 4.9 minutes against 13.9, 0.35 times. That passes the rule's second way, at least half the pairs in half the minutes or less. It doesn't pass the first, which needs 40% fewer changes.

| Round | Task | Run | Closer | Changes writing | Changes pointing |
| --- | --- | --- | --- | ---: | ---: |
| 1 | Account | 1 | Pointing | 4 | 2 |
| 1 | Account | 2 | Pointing | 3 | 3 |
| 2 | Your rules | 1 | Writing | 1 | 3 |
| 2 | Your rules | 2 | Pointing | 4 | 1 |

**It hangs on one number.** Round 2's writing took 10.2 minutes against round 1's 3.7. The author didn't step away, but isn't sure what else was in it. At round 1's pace of writing, 5.6 minutes, the total is 9.3 and the ratio 0.53, which is **Better, not dramatically**: the rule's half is just missed.

**What the author wrote on the pairs:** each way taught different things. Pointing's illustrations and icons were preferred, and writing's font and two cards side by side, which their written corrections had named. Their own best page would take from both.

**Limits of this result:**

- Four pairs and one person, who knew which way made each build they corrected.
- Pointing ran on the larger voice model on this Mac (D159), with speech detection. On the live site's small model the same talk came out as nonsense, so this is not yet what people get.
- Only the corrections were really written by hand. Both ways' first 65 notes were the author's spoken words, so a whole first take by hand is still untested, and may be typed or dictated in round 2's case: that isn't known.
- A talked correction splits one thought across several notes at the pauses, 31 notes in all, against two written messages. Agents followed them in order, but nobody has asked whether they'd do better whole.
- Both rounds' zips were put together by Claude from Pinch's exports, because of a lost sign-in and notes restored by an open tab, words untouched. Those two faults are in how the test ran, and the sign-in's cause isn't known.

**The other half of D154's condition:** asked whether they would do another round unprompted, the author answered "Yes, I would". So the condition is met, on the minutes as timed (D160).

### Speech for the live site: what was tested, 2026-11-06

The browser's words, on the author's two real takes: round 2, which is steady talk, and the thrown-out take, which is a few short sentences with long pauses. Errors are against the larger model on this Mac for round 2, and against three sentences it heard in the thrown-out take. All in a real browser with the graphics card, except the two marked. Sizes are the one-time download.

| Setup | Download | Round 2, words off | The take with pauses |
| --- | ---: | ---: | --- |
| Today: base.en, decoder q8 | 136 MB | 10% | Misheard, and loops on some runs |
| base.en, repeated phrases blocked | 136 MB | 10% | Worse, loops |
| base.en, decoder on the processor | 136 MB | 10% | Misheard |
| base.en, decoder q4 or full | 206 to 291 MB | 10% | Worse, loops |
| base.en, speech detection, on the processor | 80 MB | 18% | Worse: "and I hope you enjoy the video" |
| small.en | 586 MB | 12% | Misheard, no loops |
| small.en, speech detection, on the processor | 252 MB | 17% | Worse |
| large-v3-turbo | 564 MB | 7% | "I'm missing the secondary button", "The icons are too plain", no loops |

Settings don't fix it, and the graphics card isn't the cause: every base.en setup misheard the thrown-out take, and which of them looped changed from run to run. Speech detection, which helps the larger model on this Mac, hurts these when each stretch is read alone. Only the large model holds up, and it runs in a browser. Two real takes are a small test, and it has only run on this Mac.

### Marks described in words: the test, set before it runs, 2026-11-06

A box says where a note is but not what it's on, and it can be wrong or sit on top of the design. So the author asked whether another way of marking would help, not necessarily a visual one. This tests the idea before anything is built, on the author's first take of 65 notes, with no talking.

**The two ways.** Both have the screenshots, the same words in the same order, the marked copies and today's opening lines.

- **Today's marks:** each note's close-up has the mark drawn on it, as Export gives it now.
- **Words:** each note also says where it is, the text under the mark and its main colours, such as `Where: top left, on "Choose a plan". Colours: #ffffff, #1a1a2e.` Its close-up has nothing drawn on it, and everything outside the spot is dimmed. The text is read on this Mac with Apple's Vision, and the colours are measured from the pixels.

**The run.** Same tasks, 2 runs each, 12 new builds and 6 pairs, judged blind by the author, in `~/pinch-test-4`. Today's marks sit in the script's hand slot and the words in its Pinch slot, so in `results.md` "By hand" means today's marks and "Pinch" means words. The minutes are the same for both, since the author would do nothing different.

**The verdict, set now,** from the words' side:

- **Words win:** at least 75% of pairs and 40% fewer changes. Build them into Export.
- **Words help:** more than half the pairs and no more changes. Build them if they're cheap in a browser.
- **No gain:** anything else. Export keeps today's marks.

**Limits known now:**

- Six pairs and one person, on the author's fifth sitting on these three tasks, so fatigue and familiarity may blunt the difference.
- It doesn't separate the words from the dimmed close-ups: it tests them together.
- Apple's Vision isn't what a browser would run, so a win here doesn't yet say a browser can read text as well.
- The notes are the words as they came out of the small model, wrong words included, on both sides.


### Marks described in words: the results, 2026-11-06

**Words help.** Judged blind, words won 5 of the 6 pairs and needed 13 changes against today's marks' 20, 35% fewer, in the same minutes. That passes "more than half the pairs and no more changes" and misses "Words win", which needs 40% fewer. `results.md` says "Better", with words in its "Pinch" column. By the rule set above, they get built if they're cheap in a browser.

| Task | Run | Closer | Changes today's marks | Changes words |
| --- | --- | --- | ---: | ---: |
| Pricing | 1 | Today's marks | 2 | 5 |
| Pricing | 2 | Words | 4 | 2 |
| Account | 1 | Words | 4 | 1 |
| Account | 2 | Words | 4 | 1 |
| Your rules | 1 | Words | 2 | 2 |
| Your rules | 2 | Words | 4 | 2 |

**What the author wrote on the pairs:** words' pages mostly won on layout, and illustrations went the other way. In 4 of the 6 pairs the author preferred today's marks' illustrations or disliked those from words, including one that repeated a robot's hand on every picture. The author also called both pages of one pair "very messy".

**Why isn't known.** It may be the words, the dimmed close-ups, or both, as the test ran them together. Dimming could explain the illustrations, since it hides what's around a spot, but nothing here shows that.

**What it costs in a browser,** not yet measured: where a mark sits, its colours and the dimming need no download and a few lines each. Reading the text under a mark is the one real cost: Apple's Vision did it here, and a browser would need something like ppu-paddle-ocr, at about 6.4 MB beside the 570 MB voice model. Whether that reads as well is the next check, on the same close-ups, with no judging.

**Limits of this result:**

- Six pairs and one person, on the author's fifth sitting on these tasks. 5 of 6 comes up by chance about 1 time in 9.
- Words and dimming are tested together, so only both together have earned this result.
- Change counts depend on what's beside them, so 13 and 20 say nothing about other sittings.
