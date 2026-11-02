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

**Limits.**

- One made-up designer, whose notes name each element clearly. That is generous to the hand version.
- The judge comes from the same model family as the builders.
- Six pairs, judged on renders cut at 2,400px.
- No minutes were measured.

The test on the author's own screenshots, judged by eye, still decides.
