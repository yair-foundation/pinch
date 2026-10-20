# The rules benchmark

Does Pinch's expert foundation (D90) make better rules from a designer's notes, and do better rules make an agent's work better? This page says how it was tested and what came out. The script is `scripts/rules-bench/run.ts`; the cases are in `scripts/rules-bench/cases.ts`.

## Method

**Three readings of the same notes.**

| Reading | What it is |
| --- | --- |
| Plain prompt | What someone would type without Pinch: "Turn these new notes I wrote on screenshots into design rules an AI agent can follow", with the notes and the existing rules. |
| Current Pinch | Pinch's reading before the foundation, kept word for word in `scripts/rules-bench/baseline.ts` (commit 7571b7f). |
| Pinch with the foundation | `learn.ts` as it is: the reading with the expert foundation, stated or interpreted rules, and questions where the words could mean different designs. |

All three run on `claude-opus-5-5`; Pinch's at medium effort, as in the product.

**The cases.** Five designers, written by hand for the benchmark: B2B analytics, a food-delivery app, developer docs, a marketing site and a personal-finance app. Each has a small library of existing rules, ten to thirteen new notes and a key the readers never see. The key lists what the notes state outright, what each vague note meant (which the words alone don't give away), notes that hold in different places, contradictions with the library, library rules the notes support, and notes too vague to teach anything. Each case also has the designer's whole taste and a fresh task for an agent.

**Stage 1: the rules.** A judge plays the designer, with the key, and scores each reading without being told which reading it is. It counts:

- **Explicit preferences carried**: what the notes state, carried so that an agent would do what was meant.
- **Unsupported assumptions**: claims the reading makes as the designer's that the notes don't support. These are an invented size or count, a guessed meaning stated as fact, a rule wider than its notes, or a principle cited for a rule when the notes show nothing it explains. A meaning marked as Pinch's reading, or held back as a question, isn't counted here.
- **Corrections required**: rules the designer must rewrite or delete, and missing rules they must write, before handing the set to an agent.
- **One-click answers**: questions where one of the answers is what the designer meant.
- **Vague notes right**: vague notes asked about with the right answer among the options, read correctly, or stated correctly.

**Stage 2: the work.** An agent builds each case's fresh task as one HTML file with Tailwind, under five kinds of guidance:

- **None.**
- **The plain prompt's rules**, as text.
- **Current Pinch's rules**, as the product hands them over (`rulesText`).
- **Pinch with the foundation, as handed over**: rules waiting on a question are held back.
- **The same, after the designer answers.** A model playing the designer picks the matching answer, or none. Rules with no matching answer are left out, since the designer would write those in their own words.

A second judge, with the designer's whole taste, reads the HTML and counts taste followed and violated, and the changes they would ask for.

**Tuning and held-out cases.** The foundation was tuned between rounds on what the judge found. Each round also ran on a case written before that tuning and never tuned on: the held-out case. Only the held-out numbers say whether a change generalises.

## Limits

- The cases and keys were written by the same author as the foundation. This is a diagnostic, not evidence from designers: their own notes and their verdicts are the real test.
- The judges are the same model family as the readers, and they read rules and HTML as text; nobody looked at the rendered pages to score them.
- The samples are small: two readings and up to two builds per cell.
- The plain prompt's output is free text and Pinch's is structured, so the judge can tell them apart even unlabelled.

## Results

Means per reading; counts summed over the readings. The cost is the whole run's, on `claude-opus-5-5`.

### Round 1: the first foundation, three tuning cases

Two readings per cell, one build per cell. $5.15.

| Stage 1 | Plain prompt | Current Pinch | With foundation |
| --- | --- | --- | --- |
| Explicit preferences carried | 28/32 | 29/32 | 30/32 |
| Unsupported assumptions | 6.7 | 1.0 | 1.2 |
| Corrections required | 5.8 | 3.8 | 2.3 |
| Vague notes right | 8/16 | 2/16 | 9/16 |
| Context kept apart | 4/6 | 6/6 | 6/6 |

Current Pinch dropped 12 of the 16 vague notes ("quiet", "I like this heading", "This feels cheap") without a word. The foundation asked about them or marked its reading, but six of its questions had no answer matching what was meant. The judge's findings also showed flaws in the prompt itself:
- The prompt's own worked example invented a quality ("subtle surface changes").
- Rules reached wider than their notes ("all low-stakes moments") or narrower ("tap targets on selectors").
- A note on link colour was counted as support for the accent rule.

These were fixed as general reading principles. Then the foundation was rebuilt as principles, each with where it applies, where it gives way, the evidence that justifies it and its sources, adding Anthropic's frontend-design skill and Vercel's Web Interface Guidelines.

### Round 2: the rebuilt foundation, three tuning cases and one held out

Two readings and two builds per cell. $12.29.

| Stage 1 | Plain prompt | Current Pinch | With foundation |
| --- | --- | --- | --- |
| **Tuning cases** | | | |
| Explicit preferences carried | 30/32 | 30/32 | 32/32 |
| Unsupported assumptions | 4.3 | 1.0 | 0.8 |
| Corrections required | 5.2 | 3.3 | 2.0 |
| Vague notes right | 7/16 | 4/16 | 10/16 |
| **Held-out case (marketing)** | | | |
| Explicit preferences carried | 7/10 | 8/10 | 8/10 |
| Unsupported assumptions | 5.5 | 3.0 | 3.5 |
| Corrections required | 4.5 | 7.0 | 5.0 |
| Vague notes right | 7/8 | 0/8 | 2/8 |

On the held-out case the foundation still beat current Pinch, but not the plain prompt. It read "Font feels too techy" and "This animation is smooth" into readings that said the vague word again ("a font that doesn't fit the subject", "fluid motion") instead of asking. It dropped "Love this pricing page, so clear", and it scoped "too many calls to action" to the hero only because the note was written there. The judge also counted principles as unsupported when it saw only their names. Each was fixed as a general principle: a reading must commit to something an agent would do differently, or ask; praise for a named element is worth a question; a place is set only when the judgment depends on it. Principles now show what they say, to the judge and to the author. The marketing case became a tuning case, and a new held-out case (finance) was written before those fixes.

| Stage 2: taste followed (violated) | Tuning cases | Held-out case |
| --- | --- | --- |
| No guidance | 25/48 (23) | 4/18 (14) |
| Plain prompt's rules | 39/48 (9) | 10/20 (10) |
| Current Pinch's rules | 39/48 (9) | 14/20 (6) |
| Foundation's rules, as handed over | 37/47 (10) | 12/20 (8) |
| Foundation's rules, questions answered | 38/48 (10) | 12/20 (8) |

Any rules lift the agent's work a lot, from about half of the designer's taste to about four in five. Between the three rule sets the differences are within noise: the foundation's better rules don't yet show in the agent's work. Item by item, every variant misses the same few tastes. Most are the meanings of vague notes, which only the designer can give: the warm accent of a palette, the true black of a dark theme, the layout of a pricing page, a humanist headline font, a fade-up on scroll. One is a conflict left open (big KPI figures against "keep figures small"). The foundation finds these and asks or flags them. But the benchmark's designer only clicks an offered answer: they never write one of their own, nor settle a conflict, and that is where the rest of the quality is.

### Round 3: the final foundation, four tuning cases and one held out

Two readings per cell; two builds per cell for the held-out case only. $5.30.

| Stage 1 | Plain prompt | Current Pinch | With foundation |
| --- | --- | --- | --- |
| **Tuning cases** | | | |
| Explicit preferences carried | 37/42 | 39/42 | 40/42 |
| Unsupported assumptions | 6.8 | 1.5 | 1.8 |
| Corrections required | 5.6 | 4.9 | 3.0 |
| Vague notes right | 13/24 | 4/24 | 15/24 |
| Context kept apart | 7/8 | 6/8 | 8/8 |
| **Held-out case (finance)** | | | |
| Explicit preferences carried | 10/10 | 9/10 | 7/10 |
| Unsupported assumptions | 5.5 | 1.0 | 1.5 |
| Corrections required | 5.5 | 4.5 | 4.5 |
| Vague notes right | 4/6 | 0/6 | 2/6 |

| Stage 2, held-out case | Taste followed | Violated | Changes asked per build |
| --- | --- | --- | --- |
| No guidance | 16/20 | 4 | 4.0 |
| Plain prompt's rules | 14/18 | 4 | 2.5 |
| Current Pinch's rules | 13/18 | 5 | 4.5 |
| Foundation's rules, as handed over | 15/18 | 3 | 4.0 |
| Foundation's rules, questions answered | 16/18 | 2 | 2.0 |

On the finance case, two of the foundation's three explicit misses are the key asking for more than the note said. The note quotes only "Something went wrong", and the key wants "what to do next" too; the rule kept to the note, as the foundation tells it to. Three of its questions had the meaning split across two answers ("restrained styling" and "a confirmation step"), and the author can pick only one. The finance task tells little in stage 2: with no guidance at all, the agent already followed four in five of this designer's tastes.

A reading of ten to thirteen notes now costs about $0.065, against $0.029 before the foundation: the prompt is longer and the answers carry readings, questions and principles.

### The library one rule a line (D97)

To cut what a reading of a few notes costs, the library now goes one rule a line, not as indented JSON, and the notes as JSON on one line (D97, [cost-bench.md](cost-bench.md)). Stage 1 only, the prompt before (`pretty`, kept in `baseline.ts`) and after (`foundation`) in the same run, two runs each, with `BENCH_VARIANTS=pretty,foundation` and no builds. $2.55.

| Cases | Prompt | Explicit faithful | Unsupported | Corrections | Vague right | Context kept | Conflicts | Strengthened |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Tuning | before | 40/42 | 2.0 | 2.8 | 13/24 | 7/8 | 6/6 | 6/6 |
| Tuning | one rule a line | 42/42 | 2.0 | 2.5 | 17/24 | 8/8 | 6/6 | 6/6 |
| Held out | before | 9/10 | 3.5 | 4.5 | 2/6 | 2/2 | 2/2 | – |
| Held out | one rule a line | 9/10 | 3.5 | 5.0 | 1/6 | 2/2 | 2/2 | – |

As good or better on every tuning count, and within noise on the held-out case's two readings. The cases' libraries hold at most a few rules, so this doesn't test strengthening and conflicts against a large library, where the layout matters most.

## What it shows

- **The rules got better, as the designer counts.** Across the tuning cases the foundation needed the fewest corrections every round. In round 3 that was 3.0 a reading, against 4.9 for current Pinch and 5.6 for the plain prompt. It handled vague notes far better than current Pinch (15 of 24 against 4), and kept unsupported assumptions near current Pinch's low (1.8 against 1.5; the plain prompt made 6.8). It kept context apart every time.
- **On fresh cases the gain is smaller.** On the two held-out cases it beat or tied current Pinch on corrections (5.0 against 7.0, then 4.5 and 4.5) and on vague notes. Against the plain prompt it was mixed: fewer unsupported assumptions, but the plain prompt's guesses were right more often. Some of the gain on the tuning cases is tuning.
- **Rules help agents; better rules don't yet show.** Any rule set lifts an agent's work well above none on most tasks (25 to 39 of 48 tastes in round 2). Between the three rule sets the differences stay within noise. The tastes every set misses are the ones only the designer can give: a meaning split across two answers, one no option names, or a conflict left open.

So the foundation makes Pinch's rules more faithful and its uncertainty visible, at twice the cost of a reading. It doesn't yet make an agent's work better than a plain prompt's rules. That claim needs the designer in the loop, and real designers.

## Next

1. **Several answers to one question.** Each answer makes its own rule, from the same notes. In round 3, three questions had the meaning split across two answers.
2. **Settle a conflict in one step.** "Each in its place" asks where each holds; "this one wins" retires the other. Open conflicts are among the tastes every rule set misses.
3. **Test with designers.** Five designers' own notes, their own verdicts on the rules, and their agents' work on a task of theirs, judged from screenshots, not markup.
4. **Strengthening and conflicts against a large library.** Done for the instructions' cache (D97); still to test: a case whose library holds a couple of hundred rules, with notes that strengthen or contradict rules deep in it, before any reading sends only part of the library.
