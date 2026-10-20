# The cost benchmark

What does one reading of notes into rules cost, and does a pack of 500 readings at $19.99 pay for itself (D96)? This page says how it was measured and what came out. The script is `scripts/rules-bench/cost.ts`; the 200-rule library it reads is `scripts/rules-bench/cost-library.json`.

## Method

**The call.** Exactly the one `/api/pin/learn` makes: `claude-opus-5-5`, medium effort, the reading's own instructions with the expert foundation, the library and the new notes, structured output, the server-side fallback.

**The cells.** Libraries of 0, 50 and 200 rules (the most the route sends), each with 1, 5 and 30 new notes (30 is the most in one call). The notes are the 55 hand-written notes of the rules benchmark's cases. The library is the cases' own rules topped up to 200 by a model once, in the same style: about half with a context, one in eight interpreted, a few with open questions, one in thirty dismissed. Each cell ran twice, with different notes each time.

**Three ways.**

| Way | What it is |
| --- | --- |
| route | The call as the route makes it today, with no caching. |
| cold | Cache breakpoints after the instructions and after the library, behind a fresh marker so nothing is cached yet: an author coming back after a break, with no one else reading. |
| warm | Straight after cold, the same instructions and library with other notes: a second reading within the cache's five minutes. |

Every attempt was kept, with its input, cache-write, cache-read and output tokens and its cost at the prices in `src/lib/budget.ts` (Opus 5.5: $4 in, $20 out, $0.20 cache read, cache writes 1.25 times input). The SDK's own retries were off, so a failed or unusable attempt would have been counted and read again. Run on 2026-10-20: 54 calls, $5.01.

## Results

**What a call is made of.**

- **The instructions and foundation: about 6,700 tokens on every call.**
- **Each library rule: about 84 tokens.** A library of 50 adds about 4,150; one of 200 adds about 16,700.
- **Each note: about 74 tokens in.** Thirty notes bring back about 5,200 tokens out, a third of them thinking.
- **One note brings back very little,** from 18 to 745 tokens: its cost is almost all the fixed input.

**Per reading and per note** (mean of two runs; per note is per reading divided by its notes).

| Rules | Notes | route | cold | warm | Per note (route / cold / warm) |
| --- | --- | --- | --- | --- | --- |
| 0 | 1 | $0.028 | $0.035 | $0.010 | $0.028 / $0.035 / $0.010 |
| 0 | 5 | $0.051 | $0.064 | $0.034 | $0.010 / $0.013 / $0.007 |
| 0 | 30 | $0.14 | $0.15 | $0.13 | $0.005 / $0.005 / $0.005 |
| 50 | 1 | $0.053 | $0.066 | $0.010 | $0.053 / $0.066 / $0.010 |
| 50 | 5 | $0.070 | $0.082 | $0.029 | $0.014 / $0.017 / $0.006 |
| 50 | 30 | $0.16 | $0.18 | $0.11 | $0.005 / $0.006 / $0.004 |
| 200 | 1 | $0.10 | $0.13 | $0.019 | $0.10 / $0.13 / $0.019 |
| 200 | 5 | $0.12 | $0.14 | $0.037 | $0.024 / $0.028 / $0.007 |
| 200 | 30 | $0.21 | $0.23 | $0.12 | $0.007 / $0.008 / $0.004 |

- **Caching works on both parts.** Every warm call read the whole of the instructions and the library from the cache. A cold call costs a little more than no caching, since writing the cache costs 1.25 times input.
- **No failures.** All 54 calls were usable on their first attempt, so retries cost nothing here; two runs a cell is too few to say they never will.
- **Time.** Thirty notes take 41 to 54 seconds; one to five notes, 3 to 15.

**A pack of 500 readings.** What its notes cost, by how many go in each reading. A pack at $19.99 brings about $18.49 after Lemon Squeezy's fee (5% plus $0.50, assumed), before suggestions, storage, hosting and refunds. The mix is an assumption, not a measurement: half the notes read 30 at a time, 30% five at a time, 20% one at a time.

| Read | Way | 0 rules | 50 rules | 200 rules |
| --- | --- | --- | --- | --- |
| 30 at a time | route | $2.38 | $2.59 | $3.43 |
| 30 at a time | cold | $2.48 | $2.94 | $3.90 |
| 30 at a time | warm | $2.24 | $1.79 | $2.02 |
| 5 at a time | route | $5.11 | $7.04 | $11.89 |
| 5 at a time | cold | $6.42 | $8.24 | $14.19 |
| 5 at a time | warm | $3.36 | $2.86 | $3.68 |
| 1 at a time | route | $14.20 | $26.39 | $51.24 |
| 1 at a time | cold | $17.61 | $32.83 | $63.80 |
| 1 at a time | warm | $4.79 | $4.74 | $9.61 |
| mix | route | $5.56 | $8.69 | $15.53 |
| mix | cold | $6.69 | $10.50 | $18.97 |
| mix | warm | $3.09 | $2.70 | $4.04 |

The free 50 readings of a new author, with a small library, cost from about $0.25 (30 at a time) to about $1.75 (one at a time, cold).

## What it means

- **500 at $19.99 holds when notes are read five or more at a time,** with any library and any cache: $14.19 at most.
- **It loses money when notes are read one at a time against a library of 50 or more** with no cache or a cold one ($26 to $64). In the mix, a cold cache against a full library ($18.97) costs about what the pack brings.
- **A smaller pack can't fix that.** A single-note reading against a full library costs $0.10 to $0.13, so a pack would have to hold about 140 readings to cover it, which would short every author who reads in batches. The cost to cut is the fixed part of a call, not the count.
- **The fixed part can be cut two ways.**
  - **Caching.** The instructions are the same for every author, so in production they stay cached whenever anyone has read in the last five minutes. Only the author's own library would be cold after a break.
  - **Sending less library with few notes.** For example, only the rules that share a topic with the notes. That could miss a strengthening or a conflict across topics, so it needs the rules benchmark's checks before it ships.
- **Asking before reading (D96's Update rules) helps on its own:** notes wait until the author is done, so fewer readings carry a single note.

## Limits

- Two runs a cell; output varies from run to run, most with one note.
- The library is made, not a designer's. Its rules are as long as the reading writes (76 characters on average), so its size in tokens should be close; its content isn't.
- The notes are the hand-written benchmark notes, not real ones; real notes may be longer.
- The warm runs had nothing else cached alongside; in production, other authors keep the instructions warm, so cold costs there sit between cold and warm here.
- How often authors read one, five or thirty notes at a time is unknown until people use Update rules.
