// Mock takes for the package end-to-end run (run.ts): made-up screens drawn from boxes, and a
// walkthrough over them as the reel keeps one, the pointer's path and the timed words a speech
// reader would give. Each says what the package should come out with, for analyze.ts to hold it to.
import type { PointerSample, Shown, Take } from "../../src/lib/pin/narration"
import type { TimedWord } from "../../src/lib/pin/voice-tags"

/** A box on a mock screen, in pixels, with the text written in it, if any. */
export type Box = {
  id: string
  x: number
  y: number
  w: number
  h: number
  fill: string
  text?: string
  ink?: string
  size?: number
  radius?: number
}

export type MockScreen = {
  id: string
  name: string
  width: number
  height: number
  ground: string
  boxes: Box[]
}

/**
 * A note the package should hold: on which screen, words it contains, and where it points: at a
 * box (by id, each spot in order), at the whole screen, or at nothing. `kind` is how notes.md
 * should start it.
 */
export type Expected = {
  screen: number
  says: string
  at: string[] | "whole" | "unpointed"
  kind?: "right" | "partly" | "question"
  takesBack?: boolean
  colours?: boolean
}

export type Scenario = {
  name: string
  about: string
  screens: MockScreen[]
  take: Take
  expect: {
    notes: Expected[]
    quiet: number[]
    /** The quiet screens on show for under half a second, marked so in the transcript. */
    glanced?: number[]
    purpose?: string
    sheets: boolean
    unsure?: string[]
  }
}

/** A word every so long while speaking, and a pause between sentences, as a person talks. */
const WORD_MS = 320
const SENTENCE_GAP = 1100
const FRAME = 16

/**
 * Builds a take in recording time. Gestures are laid from the clock's time without moving it, so a
 * gesture and the words said with it start together; `say` and `wait` move the clock.
 */
class TakeBuilder {
  t = 0
  shown: Shown[] = []
  pointer: PointerSample[] = []
  words: TimedWord[] = []
  constructor(readonly screens: MockScreen[]) {}

  private frac(screen: number, x: number, y: number): [number, number] {
    const s = this.screens[screen]
    return [Number((x / s.width).toFixed(4)), Number((y / s.height).toFixed(4))]
  }
  private box(screen: number, id: string) {
    const b = this.screens[screen].boxes.find((x) => x.id === id)
    if (!b) throw new Error(`No box ${id} on screen ${screen}`)
    return b
  }

  show(screen: number) {
    this.shown.push({ t: this.t, screen })
    return this
  }
  wait(ms: number) {
    this.t += ms
    return this
  }
  /** The pointer comes to rest on a box's middle: one sample, as a still pointer sends no more. */
  rest(screen: number, id: string, at = this.t) {
    const b = this.box(screen, id)
    const [x, y] = this.frac(screen, b.x + b.w / 2, b.y + b.h / 2)
    this.pointer.push([at, screen, x, y])
    return this
  }
  /** The pointer glides to a box's middle over `ms`, ending at the clock's time. */
  glide(screen: number, id: string, ms = 350) {
    const b = this.box(screen, id)
    const last = [...this.pointer]
      .reverse()
      .find((p) => p[1] === screen && p[2] !== null)
    const [x1, y1] = this.frac(screen, b.x + b.w / 2, b.y + b.h / 2)
    const [x0, y0] = last ? [last[2] as number, last[3] as number] : [0.5, 0.95]
    const from = this.t - ms
    for (let f = 0; f <= ms; f += FRAME) {
      const k = f / ms
      this.pointer.push([
        Math.round(from + f),
        screen,
        Number((x0 + (x1 - x0) * k).toFixed(4)),
        Number((y0 + (y1 - y0) * k).toFixed(4)),
      ])
    }
    return this
  }
  /** A loop drawn round a box, a little outside it, over `ms`, from the clock's time. */
  circle(screen: number, id: string, ms = 1100) {
    const b = this.box(screen, id)
    const cx = b.x + b.w / 2
    const cy = b.y + b.h / 2
    const rx = b.w / 2 + 14
    const ry = b.h / 2 + 14
    for (let f = 0; f <= ms; f += FRAME) {
      const a = (f / ms) * 2.15 * Math.PI - Math.PI / 2
      const [x, y] = this.frac(
        screen,
        cx + rx * Math.cos(a),
        cy + ry * Math.sin(a),
      )
      this.pointer.push([Math.round(this.t + f), screen, x, y])
    }
    return this
  }
  /** The pointer leaves the screenshot. */
  off(screen: number) {
    this.pointer.push([this.t, screen, null, null])
    return this
  }
  /** Words, one after another, then the pause that ends a sentence. */
  say(text: string, gap = SENTENCE_GAP) {
    for (const w of text.split(/\s+/).filter(Boolean)) {
      this.words.push({ text: w, start: this.t, end: this.t + WORD_MS - 40 })
      this.t += WORD_MS
    }
    this.t += gap
    return this
  }
  take(id: string): Take {
    return {
      id,
      version: 1,
      recordedAt: "2026-11-13T09:30:00.000Z",
      durationMs: this.t + 500,
      mimeType: "audio/webm",
      screens: this.screens.map((s) => ({
        id: s.id,
        name: s.name,
        width: s.width,
        height: s.height,
      })),
      shown: [...this.shown, { t: this.t, screen: null }],
      pointer: [...this.pointer].sort((a, b) => a[0] - b[0]),
      words: this.words,
      readBy: { engine: "browser", model: "mock", cut: true },
    }
  }
}

// --- Screens ------------------------------------------------------------------------------------

const INK = "#111827"
const MUTED = "#6b7280"

function dashboard(id: string, name: string): MockScreen {
  return {
    id,
    name,
    width: 1440,
    height: 900,
    ground: "#f9fafb",
    boxes: [
      { id: "nav", x: 0, y: 0, w: 1440, h: 64, fill: "#ffffff" },
      {
        id: "logo",
        x: 32,
        y: 18,
        w: 120,
        h: 28,
        fill: "#ffffff",
        text: "Acme",
        ink: INK,
        size: 22,
      },
      {
        id: "title",
        x: 64,
        y: 110,
        w: 620,
        h: 72,
        fill: "#f9fafb",
        text: "Revenue this month",
        ink: INK,
        size: 52,
      },
      {
        id: "export",
        x: 1208,
        y: 120,
        w: 168,
        h: 52,
        fill: "#ff1f3d",
        text: "EXPORT NOW",
        ink: "#ffffff",
        size: 20,
        radius: 4,
      },
      {
        id: "card1",
        x: 64,
        y: 240,
        w: 420,
        h: 220,
        fill: "#ffffff",
        text: "$48,210",
        ink: INK,
        size: 40,
        radius: 12,
      },
      {
        id: "card2",
        x: 492,
        y: 240,
        w: 420,
        h: 220,
        fill: "#ffffff",
        text: "1,204 orders",
        ink: INK,
        size: 32,
        radius: 12,
      },
      {
        id: "card3",
        x: 920,
        y: 240,
        w: 420,
        h: 220,
        fill: "#ffffff",
        text: "3.2% churn",
        ink: INK,
        size: 32,
        radius: 12,
      },
      {
        id: "chart",
        x: 64,
        y: 500,
        w: 1276,
        h: 340,
        fill: "#eef2ff",
        text: "Chart",
        ink: MUTED,
        size: 18,
        radius: 12,
      },
    ],
  }
}

function settings(id: string, name: string): MockScreen {
  return {
    id,
    name,
    width: 1440,
    height: 900,
    ground: "#ffffff",
    boxes: [
      {
        id: "heading",
        x: 64,
        y: 64,
        w: 400,
        h: 48,
        fill: "#ffffff",
        text: "Settings",
        ink: INK,
        size: 36,
      },
      {
        id: "row1",
        x: 64,
        y: 160,
        w: 900,
        h: 64,
        fill: "#f3f4f6",
        text: "Email alerts",
        ink: INK,
        size: 20,
        radius: 8,
      },
      {
        id: "toggle",
        x: 880,
        y: 176,
        w: 64,
        h: 32,
        fill: "#10b981",
        radius: 16,
      },
      {
        id: "row2",
        x: 64,
        y: 240,
        w: 900,
        h: 64,
        fill: "#f3f4f6",
        text: "Weekly digest",
        ink: INK,
        size: 20,
        radius: 8,
      },
      {
        id: "icon1",
        x: 1020,
        y: 170,
        w: 40,
        h: 40,
        fill: "#3b82f6",
        radius: 20,
      },
      {
        id: "icon2",
        x: 1020,
        y: 250,
        w: 40,
        h: 40,
        fill: "#f59e0b",
        radius: 4,
      },
      {
        id: "save",
        x: 64,
        y: 760,
        w: 140,
        h: 48,
        fill: "#111827",
        text: "Save",
        ink: "#ffffff",
        size: 18,
        radius: 8,
      },
      {
        id: "help",
        x: 1100,
        y: 820,
        w: 300,
        h: 40,
        fill: "#ffffff",
        text: "Need help? Contact us",
        ink: MUTED,
        size: 14,
      },
    ],
  }
}

function slide(i: number): MockScreen {
  const hue = (i * 47) % 360
  return {
    id: `slide-${i + 1}`,
    name: `Deck slide ${String(i + 1).padStart(2, "0")}.png`,
    width: 1920,
    height: 1080,
    ground: `hsl(${hue} 30% 96%)`,
    boxes: [
      {
        id: "headline",
        x: 120,
        y: 120,
        w: 1400,
        h: 110,
        fill: `hsl(${hue} 30% 96%)`,
        text: `Slide ${i + 1}: Q${(i % 4) + 1} growth plan`,
        ink: INK,
        size: 72,
      },
      {
        id: "body",
        x: 120,
        y: 300,
        w: 900,
        h: 520,
        fill: "#ffffff",
        text: "Three bullet points about the market",
        ink: MUTED,
        size: 30,
        radius: 16,
      },
      {
        id: "picture",
        x: 1100,
        y: 300,
        w: 700,
        h: 520,
        fill: `hsl(${hue} 70% 55%)`,
        radius: 16,
      },
      {
        id: "footer",
        x: 120,
        y: 960,
        w: 600,
        h: 40,
        fill: `hsl(${hue} 30% 96%)`,
        text: "Confidential",
        ink: MUTED,
        size: 22,
      },
    ],
  }
}

// --- Scenarios ----------------------------------------------------------------------------------

/** A short taste take: a few corrections and praise over three screens, one passed in silence. */
function tasteTake(): Scenario {
  const screens = [
    dashboard("dash", "Dashboard.png"),
    settings("set", "Settings page.png"),
    dashboard("dash2", "Dashboard empty.png"),
  ]
  const b = new TakeBuilder(screens)
  b.show(0).wait(800)
  b.wait(400)
    .glide(0, "export")
    .circle(0, "export")
    .say("This button is way too loud, make it much quieter.")
  b.wait(300).glide(0, "title").rest(0, "title").say("I like this big title.")
  b.wait(300)
    .glide(0, "card2")
    .circle(0, "card2", 1300)
    .say("The spacing between the cards is too tight.")
  b.wait(600).show(1).wait(900)
  b.glide(1, "toggle")
    .rest(1, "toggle")
    .say("I love the green colour of this toggle.")
  b.wait(200)
    .glide(1, "help")
    .circle(1, "help")
    .say("The help text is too small to read.")
  b.wait(600).show(2).wait(3000)
  return {
    name: "taste",
    about:
      "Three screens of an app: corrections and praise, pointed by circling and resting; one screen passed in silence.",
    screens,
    take: b.take("take-taste"),
    expect: {
      notes: [
        { screen: 0, says: "too loud", at: ["export"] },
        { screen: 0, says: "big title", at: ["title"], kind: "right" },
        { screen: 0, says: "too tight", at: ["card2"] },
        {
          screen: 1,
          says: "green colour",
          at: ["toggle"],
          kind: "right",
          colours: true,
        },
        { screen: 1, says: "too small", at: ["help"] },
      ],
      quiet: [2],
      sheets: false,
    },
  }
}

/**
 * A deck review as a work order (D189): what it is for and how to read it said first, then "delete
 * this slide" over many, a change over a few, nothing over the rest. Enough noted slides for sheets.
 */
function deckReview(): Scenario {
  const screens = Array.from({ length: 14 }, (_, i) => slide(i))
  const b = new TakeBuilder(screens)
  b.show(0).wait(600)
  b.off(0).say("These notes are for cleaning up the sales deck before Friday.")
  b.say("If I say nothing over a slide, keep it as it is.")
  b.glide(0, "headline")
    .rest(0, "headline")
    .say("This headline is too long, cut it to four words.")
  const deleted = [1, 2, 4, 5, 7, 8, 10, 11]
  const changed: Record<number, [string, string]> = {
    3: ["picture", "This picture is too saturated, tone it down."],
    9: ["footer", "Drop the confidential footer here."],
  }
  for (let i = 1; i < screens.length; i++) {
    // The last slide flashes past, under half a second: glanced at, not looked at (D189).
    b.wait(300)
      .show(i)
      .wait(i === 13 ? 200 : 700)
    if (deleted.includes(i))
      b.glide(i, "body").rest(i, "body").say("Delete this slide.")
    else if (changed[i])
      b.glide(i, changed[i][0]).circle(i, changed[i][0]).say(changed[i][1])
    else if (i !== 13) b.wait(1800)
  }
  return {
    name: "deck-review",
    about:
      "Fourteen slides reviewed as a work order: the purpose and reading rule said first, eight deletions, three changes, three slides passed (one glanced).",
    screens,
    take: b.take("take-deck"),
    expect: {
      notes: [
        // How to read the rest (D189): a note on the first slide, which notes.md tells the agent to follow.
        { screen: 0, says: "If I say nothing", at: "whole" },
        { screen: 0, says: "headline is too long", at: ["headline"] },
        ...deleted.map((s) => ({
          screen: s,
          says: "Delete this slide",
          at: "whole" as const,
        })),
        { screen: 3, says: "too saturated", at: ["picture"] },
        { screen: 9, says: "confidential footer", at: ["footer"] },
      ],
      quiet: [6, 12, 13],
      glanced: [13],
      purpose: "cleaning up the sales deck",
      sheets: true,
    },
  }
}

/**
 * The hard cases: one note on two spots ("here and here"), a note taken back, a question, a note
 * said with the pointer off the screenshot, a mumble too short to be a note, and a voice tag.
 */
function trickyTake(): Scenario {
  const screens = [
    settings("s1", "Settings v2.png"),
    dashboard("d1", "Dashboard v2.png"),
  ]
  const b = new TakeBuilder(screens)
  b.show(0).wait(700)
  b.say("Tag this as Settings.")
  b.glide(0, "icon1").rest(0, "icon1").say("These icons here", 0)
  b.glide(0, "icon2", 300)
    .rest(0, "icon2")
    .say("and here don't match, one is round and one is square.")
  b.wait(200)
    .glide(0, "save")
    .rest(0, "save")
    .say("Avoid this black button colour.")
  b.wait(200)
    .rest(0, "save")
    .say("Actually you can keep this black, it works for the main action.")
  b.wait(300)
    .off(0)
    .say("Overall the whole flow feels a bit cramped and dense.")
  b.wait(300).say("um yeah")
  b.wait(300).say("The typography is just.")
  b.wait(500).show(1).wait(700)
  b.glide(1, "chart")
    .circle(1, "chart", 1500)
    .say("Do you have an idea how to make this chart easier to scan?")
  b.wait(400)
  return {
    name: "tricky",
    about:
      "Two screens with the hard cases: two spots in one note, a note taken back, a question, a note said off the screenshot, a mumble, a voice tag.",
    screens,
    take: b.take("take-tricky"),
    expect: {
      notes: [
        { screen: 0, says: "don't match", at: ["icon1", "icon2"] },
        { screen: 0, says: "Avoid this black", at: ["save"], colours: true },
        {
          screen: 0,
          says: "keep this black",
          at: ["save"],
          kind: "right",
          takesBack: true,
          colours: true,
        },
        // Said with the hand off the screenshot: about the whole screen (D194).
        { screen: 0, says: "cramped", at: "whole" },
        { screen: 0, says: "typography is just", at: "whole" },
        { screen: 1, says: "easier to scan", at: ["chart"], kind: "question" },
      ],
      quiet: [],
      sheets: false,
      // "um yeah" is only filler, and goes; a sentence that stops short is asked about (D192).
      unsure: ["typography is just"],
    },
  }
}

export const SCENARIOS: Scenario[] = [tasteTake(), deckReview(), trickyTake()]
