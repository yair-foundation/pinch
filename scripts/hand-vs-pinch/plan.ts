// The hand-vs-Pinch test (D145), its pure parts: the test's settings, the builds and blind pairs,
// the prompt every build gets, and the score with the verdict set before the test runs.

export type Arm = "hand" | "pinch"
export const ARMS: Arm[] = ["hand", "pinch"]

/** `test.json`, which the author fills in. */
export type Settings = {
  /** The screens the agent builds from each input: two to four, written before either input. */
  tasks: string[]
  /** Builds of each task from each input; two shows how much a build varies. */
  runs: number
  /** The author's hands-on minutes making each input, from the first screenshot to the last file. */
  minutes: { pinch: number | null; hand: number | null }
  /** The model the builds run on, as `claude --model` takes it; null for the author's default. */
  model: string | null
  /** A round of corrections (D154), which builds one task. */
  round?: number
}

export const SETTINGS: Settings = {
  tasks: ["", "", ""],
  runs: 2,
  minutes: { pinch: null, hand: null },
  model: null,
}

/** What's wrong with the settings, or nothing. */
export function settingsProblems(s: Settings): string[] {
  const out: string[] = []
  const tasks = (s.tasks ?? []).filter((t) => t.trim())
  if (s.round) {
    if (tasks.length !== 1) out.push("A round builds one task.")
  } else if (tasks.length < 2 || tasks.length > 4)
    out.push("Write two to four tasks in test.json.")
  if (!Number.isInteger(s.runs) || s.runs < 1 || s.runs > 4)
    out.push("Set runs to 1–4.")
  return out
}

/** One build: an arm's input put to one task, once. Its id names nothing about it. */
export type Build = { id: string; arm: Arm; task: number; run: number }
/** Two builds of one task, one from each input, on random sides. */
export type Pair = { id: string; task: number; left: string; right: string }

/** The builds for every task and run from both inputs, and their pairs in a random order. */
export function blind(
  tasks: number,
  runs: number,
  random: () => number = Math.random,
): { builds: Build[]; pairs: Pair[] } {
  const used = new Set<string>()
  const id = () => {
    let x = ""
    while (!x || used.has(x))
      x = Math.floor(random() * 36 ** 6)
        .toString(36)
        .padStart(6, "0")
    used.add(x)
    return x
  }
  const builds: Build[] = []
  const pairs: Pair[] = []
  for (let task = 0; task < tasks; task++)
    for (let run = 0; run < runs; run++) {
      const [hand, pinch] = ARMS.map((arm) => {
        const b = { id: id(), arm, task, run }
        builds.push(b)
        return b.id
      })
      const swap = random() < 0.5
      pairs.push({
        id: id(),
        task,
        left: swap ? pinch : hand,
        right: swap ? hand : pinch,
      })
    }
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[pairs[i], pairs[j]] = [pairs[j], pairs[i]]
  }
  return { builds, pairs }
}

/** What every build is asked, word for word, whichever input sits in `./input`. */
export const buildPrompt = (
  task: string,
) => `You are designing for one designer, from their guidance alone. It is in the folder ./input: read all of it first, opening the images, since it is everything you know about their taste.

Then build this, as one self-contained HTML file, ./index.html, for a desktop window 1440px wide:

${task.trim()}

- Load Tailwind with <script src="https://cdn.tailwindcss.com"></script>, and Google Fonts if the guidance calls for a typeface; load nothing else from outside.
- No external images: draw with inline SVG or CSS, and write realistic text.
- Where the guidance says nothing, use your own judgment.

You can see what you build: \`node render.mjs\` draws ./index.html 1440px wide into ./render.png, which you can open.

Write ./index.html and nothing else. Don't ask questions: no one is there to answer them.`

/** The author's verdict on one pair, as the judging page saves it. */
export type Answer = {
  pick: "left" | "right" | "same"
  /** The changes they would ask for before each build is theirs. */
  changes: { left: number; right: number }
  note?: string
}

export type Score = {
  /** Pairs judged, of those built. */
  judged: number
  pairs: number
  /** Pinch's share of the judged pairs: a win counts one, the same counts half. */
  pinchShare: number
  /** The changes asked for, summed over the judged pairs. */
  changes: Record<Arm, number>
  /** How many fewer changes Pinch's builds needed than the hand's, as a share of the hand's. */
  fewerChanges: number
  /** Pinch's minutes over the hand's, or null until both are in. */
  timeRatio: number | null
  verdict: "Dramatically better" | "Better" | "Not better" | "Needs the minutes"
  /** Per task: Pinch's share of its pairs. */
  byTask: { task: number; pairs: number; pinchShare: number }[]
}

/**
 * The score, with the verdict decided before the test (D145). Dramatically better: Pinch's builds
 * win at least three in four pairs and need at least 40% fewer changes, in no more than 1.25
 * times the minutes; or they win at least half in half the minutes or less. Better: they win
 * more than half and need no more changes, in no more than 1.5 times the minutes. Anything else
 * is not better.
 */
export function score(
  builds: Build[],
  pairs: Pair[],
  answers: Record<string, Answer>,
  minutes: Settings["minutes"],
): Score {
  const arm = new Map(builds.map((b) => [b.id, b.arm]))
  const changes: Record<Arm, number> = { hand: 0, pinch: 0 }
  const tasks = new Map<number, { pairs: number; pinch: number }>()
  let judged = 0
  let pinch = 0
  for (const p of pairs) {
    const a = answers[p.id]
    const left = arm.get(p.left)
    const right = arm.get(p.right)
    if (!a || !left || !right) continue
    judged++
    const won =
      a.pick === "same"
        ? 0.5
        : (a.pick === "left" ? left : right) === "pinch"
          ? 1
          : 0
    pinch += won
    changes[left] += a.changes.left
    changes[right] += a.changes.right
    const t = tasks.get(p.task) ?? { pairs: 0, pinch: 0 }
    tasks.set(p.task, { pairs: t.pairs + 1, pinch: t.pinch + won })
  }
  const pinchShare = judged ? pinch / judged : 0
  const fewerChanges = changes.hand
    ? 1 - changes.pinch / changes.hand
    : changes.pinch
      ? -1
      : 0
  const timeRatio =
    minutes.hand && minutes.pinch !== null && minutes.hand > 0
      ? minutes.pinch / minutes.hand
      : null
  const verdict =
    timeRatio === null
      ? "Needs the minutes"
      : (pinchShare >= 0.75 && fewerChanges >= 0.4 && timeRatio <= 1.25) ||
          (pinchShare >= 0.5 && timeRatio <= 0.5)
        ? "Dramatically better"
        : pinchShare > 0.5 && fewerChanges >= 0 && timeRatio <= 1.5
          ? "Better"
          : "Not better"
  return {
    judged,
    pairs: pairs.length,
    pinchShare,
    changes,
    fewerChanges,
    timeRatio,
    verdict,
    byTask: [...tasks.entries()]
      .sort(([a], [b]) => a - b)
      .map(([task, t]) => ({
        task,
        pairs: t.pairs,
        pinchShare: t.pinch / t.pairs,
      })),
  }
}

/** The score as `results.md`. */
export function scoreText(
  s: Score,
  settings: Settings,
  title = "Hand vs Pinch: results",
): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`
  const tasks = settings.tasks.filter((t) => t.trim())
  return [
    `# ${title}`,
    "",
    `**${s.verdict}.**${s.judged < s.pairs ? ` ${s.judged} of ${s.pairs} pairs judged so far.` : ""}`,
    "",
    "| | By hand | Pinch |",
    "| --- | --- | --- |",
    `| Pairs won (the same counts half) | ${pct(1 - s.pinchShare)} | ${pct(s.pinchShare)} |`,
    `| Changes you'd ask for | ${s.changes.hand} | ${s.changes.pinch} |`,
    `| Your minutes | ${settings.minutes.hand ?? "–"} | ${settings.minutes.pinch ?? "–"} |`,
    "",
    `Pinch's builds needed ${s.fewerChanges >= 0 ? `${pct(s.fewerChanges)} fewer` : `${pct(-s.fewerChanges)} more`} changes${s.timeRatio === null ? "" : `, in ${s.timeRatio.toFixed(2)} times the minutes`}.`,
    "",
    "## By task",
    "",
    ...s.byTask.map(
      (t) =>
        `- ${tasks[t.task]?.trim().replace(/[.\s]+$/, "") ?? `Task ${t.task + 1}`}: Pinch won ${pct(t.pinchShare)} of ${t.pairs} pairs.`,
    ),
    "",
  ].join("\n")
}
