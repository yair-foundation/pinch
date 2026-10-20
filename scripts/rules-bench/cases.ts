import type { LearnNote, LibraryRule } from "../../src/lib/pin/learn"

/*
 * The benchmark's annotated examples: three designers, each with a library, a batch of new
 * notes and a key the reader never sees, saying what the designer meant. Vague notes have a
 * meaning the words alone can't give away; a good reading asks, or marks its guess, rather
 * than asserting one. Each case ends with a fresh task for an agent, to see whether the
 * rules change what it builds. Written by hand for the benchmark: a diagnostic, not data
 * from real designers.
 */

export type Case = {
  id: string
  /** `tuning`: the foundation was adjusted after reading its results; `held out`: never. */
  set: "tuning" | "held out"
  designer: string
  library: LibraryRule[]
  notes: LearnNote[]
  key: {
    /** Preferences the notes state outright: a rule set must carry each one faithfully. */
    explicit: { notes: string[]; want: string }[]
    /** Notes whose words leave the meaning open, and what the designer meant. */
    vague: { notes: string[]; meant: string }[]
    /** Notes that hold in different places: kept apart, each with where it holds. */
    context: string[]
    /** Real contradictions with the library: flagged, never merged or reworded away. */
    conflicts: string[]
    /** Library rules new notes support: strengthened, never reworded. */
    strengthen: string[]
    /** Notes too vague to teach anything: in no rule. */
    nothing: string[]
  }
  /** The designer's whole taste, as they would state it: what the agent's work is judged by. */
  taste: string[]
  /** A fresh task for an agent, touching most of the taste. */
  task: string
}

const note = (
  id: string,
  works: string,
  doesNotWork: string,
  source: LearnNote["source"],
  label?: string,
  topics: LearnNote["topics"] = [],
): LearnNote => ({
  id,
  works,
  doesNotWork,
  source,
  topics,
  ...(label ? { label } : {}),
})

export const CASES: Case[] = [
  {
    id: "analytics",
    set: "tuning",
    designer: "Product designer on a B2B analytics app",
    library: [
      {
        id: "r1",
        text: "Keep figures small and restrained; avoid big display numbers.",
        context: "",
        topics: ["visual"],
        status: "approved",
      },
      {
        id: "r2",
        text: 'Write button labels as the action they take ("Save changes", not "OK").',
        context: "",
        topics: ["copy"],
        status: "approved",
      },
    ],
    notes: [
      note(
        "n1",
        "Love how quiet this screen feels.",
        "",
        "competitor",
        "Reports home",
      ),
      note("n2", "I like this heading.", "", "competitor", "Reports home", [
        "visual",
      ]),
      note("n3", "", "Too many outlines.", "ours", "Settings", ["visual"]),
      note("n4", "", "These borders feel heavy.", "ours", "Billing"),
      note(
        "n5",
        "Love how spacing separates these sections.",
        "",
        "competitor",
        "Account",
        ["layout"],
      ),
      note(
        "n6",
        "I like dense tables, lots of rows visible.",
        "",
        "other",
        "Data grid",
        ["layout"],
      ),
      note("n7", "", "This onboarding feels crowded.", "ours", "Onboarding"),
      note(
        "n8",
        "",
        "The main button gets lost next to the other actions.",
        "ours",
        "Invite dialog",
        ["visual"],
      ),
      note("n9", "nice", "", null),
      note(
        "n10",
        "",
        "Copy is too cute for an error message.",
        "ours",
        "Import error",
        ["copy"],
      ),
      note(
        "n11",
        "The table header stays put when you scroll. Keep that.",
        "",
        "other",
        "Data grid",
      ),
      note(
        "n12",
        "Love the big bold numbers on this KPI card.",
        "",
        "competitor",
        "KPI card",
      ),
      note(
        "n13",
        "",
        'Buttons say "Submit" everywhere, say what happens.',
        "ours",
        "Forms",
        ["copy"],
      ),
    ],
    key: {
      explicit: [
        {
          notes: ["n3", "n4", "n5"],
          want: "Separate sections with spacing; use few, light borders and outlines.",
        },
        {
          notes: ["n6"],
          want: "Data tables are dense, with many rows visible.",
        },
        { notes: ["n7"], want: "Onboarding has room; not crowded." },
        {
          notes: ["n8"],
          want: "The main action stands out from the actions beside it.",
        },
        { notes: ["n10"], want: "Error messages are plain, not cute." },
        {
          notes: ["n11"],
          want: "Table headers stay fixed while the table scrolls.",
        },
      ],
      vague: [
        {
          notes: ["n1"],
          meant:
            "Few elements competing for attention, mostly neutral colour, one focal point.",
        },
        {
          notes: ["n2"],
          meant:
            "The heading is short and plain-spoken: its wording, not its size or weight.",
        },
      ],
      context: [
        "n6 (dense tables) and n7 (roomy onboarding) both hold, each in its place.",
      ],
      conflicts: [
        "n12 (big bold KPI numbers) contradicts library rule r1 (small, restrained figures).",
      ],
      strengthen: ["n13 supports library rule r2 (button labels as actions)."],
      nothing: ["n9"],
    },
    taste: [
      "Separate sections with spacing; few, light borders.",
      "Quiet screens: few elements competing, mostly neutral colour, one focal point.",
      "Headings short and plain-spoken.",
      "Data tables dense with many rows visible, and a header that stays fixed on scroll.",
      "Onboarding and first-run screens have room.",
      "The main action clearly stands out from the actions beside it.",
      "Error messages plain, never cute.",
      "Button labels say the action they take.",
      "Headline KPI figures big and bold; other figures restrained.",
    ],
    task: 'Build the Members page of a B2B analytics app\'s settings, as one HTML file with Tailwind classes: a seat summary at the top (32 of 40 seats used), a table of team members (name, email, role, last active; show 15 rows), an "invite member" action, a remove action per row, and the error message shown when an invite fails because the email is already a member.',
  },
  {
    id: "delivery",
    set: "tuning",
    designer: "Designer on a consumer food-delivery mobile app",
    library: [],
    notes: [
      note("m1", "", "This feels cheap.", "ours", "Promo banner"),
      note(
        "m2",
        "Love the rounded, friendly feel.",
        "",
        "competitor",
        "Home screen",
        ["visual"],
      ),
      note("m3", "", "Too much going on.", "ours", "Checkout"),
      note(
        "m4",
        "",
        "The pay button scrolls off the screen. It should always be there at the bottom.",
        "ours",
        "Checkout",
        ["interaction"],
      ),
      note(
        "m5",
        "I like the playful illustration here.",
        "",
        "competitor",
        "Empty cart",
        ["visual"],
      ),
      note(
        "m6",
        "",
        '"Oopsie! Something went wonky" when someone\'s payment failed. No.',
        "ours",
        "Payment error",
        ["copy"],
      ),
      note(
        "m7",
        "",
        "Text is too small to read on the go.",
        "ours",
        "Order status",
        ["accessibility"],
      ),
      note("m8", "", "Tap targets are tiny here.", "ours", "Tip selector", [
        "accessibility",
      ]),
      note("m9", "Great", "", null),
      note(
        "m10",
        "The colour palette here is so good.",
        "",
        "competitor",
        "Onboarding",
        ["visual"],
      ),
      note(
        "m11",
        "Bottom tab bar instead of a hamburger menu, much better.",
        "",
        "competitor",
        "Navigation",
        ["flow"],
      ),
    ],
    key: {
      explicit: [
        {
          notes: ["m4"],
          want: "The pay button stays fixed at the bottom of checkout.",
        },
        {
          notes: ["m5", "m6"],
          want: "Playful illustration fits empty states; payment errors are plain.",
        },
        {
          notes: ["m7"],
          want: "Text larger where people read on the go (no size given).",
        },
        { notes: ["m8"], want: "Bigger tap targets (no size given)." },
        { notes: ["m11"], want: "A bottom tab bar, not a hamburger menu." },
      ],
      vague: [
        {
          notes: ["m1"],
          meant: "Glossy gradients and heavy drop shadows make it cheap.",
        },
        {
          notes: ["m2"],
          meant: "Generous corner radius on cards and buttons.",
        },
        {
          notes: ["m3"],
          meant:
            "Checkout carries promotions and upsells; it should hold only the order and payment.",
        },
        { notes: ["m10"], meant: "Few colours: one warm accent on neutrals." },
      ],
      context: [
        "m5 (playful empty state) and m6 (plain payment error) both hold, each in its place.",
      ],
      conflicts: [],
      strengthen: [],
      nothing: ["m9"],
    },
    taste: [
      "No glossy gradients or heavy drop shadows.",
      "Generous corner radius on cards and buttons.",
      "Checkout holds only the order and payment: no promotions or upsells.",
      "The pay button stays fixed at the bottom of checkout.",
      "Playful illustration in empty states; plain words in payment errors.",
      "Text large enough to read on the go.",
      "Big tap targets.",
      "Few colours: one warm accent on neutrals.",
      "A bottom tab bar for main navigation, never a hamburger menu.",
    ],
    task: "Design the checkout screen of a food-delivery mobile app at 390px wide, as one HTML file with Tailwind classes: an order summary of three items, the delivery address, the payment method, a tip selector and a pay button; the message shown when the card is declined; and the empty-cart screen, with the app's main navigation.",
  },
  {
    id: "docs",
    set: "tuning",
    designer: "Designer on a developer tool and its documentation",
    library: [
      {
        id: "r1",
        text: "Use one accent colour, only for actions and selection.",
        context: "",
        topics: ["visual"],
        status: "approved",
      },
      {
        id: "r2",
        text: "Show code in a monospace block with a copy button.",
        context: "",
        topics: ["visual", "interaction"],
        status: "approved",
      },
      {
        id: "r3",
        text: "Keep page titles under six words.",
        context: "",
        topics: ["copy"],
        status: "approved",
      },
    ],
    notes: [
      note(
        "d1",
        "",
        "Accent used for decoration here, distracting.",
        "ours",
        "Changelog",
        ["visual"],
      ),
      note(
        "d2",
        "Love this sidebar, so easy to scan.",
        "",
        "competitor",
        "Docs navigation",
      ),
      note(
        "d3",
        "The dark theme here is gorgeous.",
        "",
        "other",
        "Code editor",
        ["visual"],
      ),
      note(
        "d4",
        "",
        "Two different blues for links. Pick one.",
        "ours",
        "API reference",
        ["visual"],
      ),
      note(
        "d5",
        "",
        'Title is way too long: "Getting started with configuring your first project workspace".',
        "ours",
        "Guide",
        ["copy"],
      ),
      note(
        "d6",
        "",
        "Cramped code samples, no padding.",
        "ours",
        "API reference",
      ),
      note(
        "d7",
        "Long, descriptive titles so people know what they'll learn.",
        "",
        "competitor",
        "Tutorial",
        ["copy"],
      ),
      note("d8", "meh", "", null),
      note(
        "d9",
        "",
        "Warnings look the same as notes.",
        "ours",
        "Install guide",
      ),
      note(
        "d10",
        "Search front and centre on the docs home.",
        "",
        "competitor",
        "Docs home",
        ["layout"],
      ),
    ],
    key: {
      explicit: [
        { notes: ["d4"], want: "One colour for links." },
        { notes: ["d6"], want: "Code samples have padding." },
        { notes: ["d9"], want: "Warnings look different from notes." },
        { notes: ["d10"], want: "Search is prominent on the docs home." },
        { notes: ["d7"], want: "Tutorial titles are long and descriptive." },
      ],
      vague: [
        {
          notes: ["d2"],
          meant:
            "Grouped sections under small uppercase headings, with short item names.",
        },
        {
          notes: ["d3"],
          meant: "True black background with grey borders, no colour cast.",
        },
      ],
      context: [
        "d7 (descriptive tutorial titles) holds in tutorials; library rule r3 (short titles) elsewhere.",
      ],
      conflicts: [
        "d7 pulls against library rule r3; flagged or scoped to tutorials, never r3 reworded.",
      ],
      strengthen: [
        "d1 supports r1 (accent only for actions and selection).",
        "d5 supports r3 (short page titles).",
      ],
      nothing: ["d8"],
    },
    taste: [
      "One accent colour, only for actions and selection, never decoration.",
      "Code in a monospace block with a copy button and generous padding.",
      "Page titles under six words, except tutorials: long and descriptive.",
      "A sidebar of grouped sections under small uppercase headings, with short item names.",
      "Dark theme: true black background with grey borders, no colour cast.",
      "One colour for links.",
      "Warnings look different from notes.",
      "Search prominent on the docs home.",
    ],
    task: 'Build the "Install" reference page of a CLI tool\'s documentation in its dark theme, as one HTML file with Tailwind classes: the docs sidebar (about 12 pages in 3 sections), a search box, two code samples (install and verify), a warning about unsupported Node versions and a note about shell completion, and a card at the end linking to the first tutorial (give it its title).',
  },
  {
    id: "marketing",
    // Held out in round 2, then tuned on.
    set: "tuning",
    designer: "Designer on the marketing site of a project-management product",
    library: [
      {
        id: "r1",
        text: "Lead each section with one short headline and one line of support.",
        context: "",
        topics: ["copy", "layout"],
        status: "approved",
      },
      {
        id: "r2",
        text: "Keep backgrounds neutral; use colour only for buttons and links.",
        context: "",
        topics: ["visual"],
        status: "approved",
      },
    ],
    notes: [
      note("p1", "", "Hero feels generic.", "ours", "Hero"),
      note(
        "p2",
        "Love this pricing page, so clear.",
        "",
        "competitor",
        "Pricing",
      ),
      note(
        "p3",
        "",
        "Too many calls to action fighting each other.",
        "ours",
        "Hero",
        ["visual"],
      ),
      note(
        "p4",
        "",
        "The testimonials move on before I can finish reading.",
        "ours",
        "Testimonials",
        ["interaction"],
      ),
      note("p5", "", "Font feels too techy.", "ours", "Headlines", ["visual"]),
      note(
        "p6",
        "Love the bold, saturated colour blocks behind each feature section.",
        "",
        "competitor",
        "Features",
        ["visual"],
      ),
      note(
        "p7",
        "",
        "Footer has 40 links, nobody reads that.",
        "ours",
        "Footer",
      ),
      note("p8", "cool", "", null),
      note(
        "p9",
        "",
        'Price hidden behind "Contact us". Show it on the plan.',
        "ours",
        "Pricing",
        ["copy"],
      ),
      note(
        "p10",
        "This animation is smooth.",
        "",
        "competitor",
        "Feature reveal",
        ["interaction"],
      ),
      note("p11", "", "Sign-up form asks for too much.", "ours", "Sign up", [
        "flow",
      ]),
    ],
    key: {
      explicit: [
        { notes: ["p3"], want: "One main call to action per section." },
        {
          notes: ["p4"],
          want: "Testimonials never move on by themselves before people finish reading.",
        },
        {
          notes: ["p7"],
          want: "A short footer with few links (no number given).",
        },
        { notes: ["p9"], want: "Show prices on the plans." },
        { notes: ["p11"], want: "Sign-up asks for less." },
      ],
      vague: [
        {
          notes: ["p1"],
          meant:
            "Stock photos of people at laptops; show the product’s own screens instead.",
        },
        {
          notes: ["p2"],
          meant:
            "Plans side by side with the recommended one highlighted, and a comparison table below.",
        },
        {
          notes: ["p5"],
          meant:
            "A geometric or monospace display font; headlines in a humanist sans.",
        },
        {
          notes: ["p10"],
          meant:
            "A subtle fade-up as sections scroll in: short, and only once.",
        },
      ],
      context: [
        "p6 (colour blocks behind feature sections) holds on the marketing feature sections only.",
      ],
      conflicts: [
        "p6 pulls against library rule r2 (neutral backgrounds); flagged or scoped, never r2 reworded.",
      ],
      strengthen: [],
      nothing: ["p8"],
    },
    taste: [
      "Each section leads with one short headline and one line of support.",
      "Show the product’s own screens, never stock photos of people.",
      "Pricing: plans side by side, the recommended one highlighted, prices on the plans, a comparison table below.",
      "One main call to action per section.",
      "Carousels and testimonials never move on by themselves.",
      "Headlines in a humanist sans, not a geometric or monospace font.",
      "Bold, saturated colour blocks behind feature sections; neutral backgrounds elsewhere.",
      "A short footer with few links.",
      "Motion: a subtle fade-up as sections scroll in, short and only once.",
      "Sign-up asks only for email and password.",
    ],
    task: "Build the home page of a project-management product's marketing site, as one HTML file with Tailwind classes: a hero, three feature sections, testimonials, a pricing section with three plans, a sign-up form and the footer.",
  },
  {
    id: "finance",
    set: "held out",
    designer: "Designer on a personal-finance web app",
    library: [
      {
        id: "r1",
        text: "Show money with its currency and two decimals.",
        context: "",
        topics: ["copy", "visual"],
        status: "approved",
      },
      {
        id: "r2",
        text: "Show every account as a row in one list; no hero numbers.",
        context: "",
        topics: ["layout"],
        status: "approved",
      },
    ],
    notes: [
      note(
        "f1",
        "",
        "This dashboard is overwhelming.",
        "ours",
        "Accounts overview",
      ),
      note(
        "f2",
        "I like how trustworthy this feels.",
        "",
        "competitor",
        "Transfer",
      ),
      note(
        "f3",
        "",
        "Deleting a payee happened in one tap, with no undo!",
        "ours",
        "Payees",
        ["interaction"],
      ),
      note(
        "f4",
        "",
        "Negative amounts are only shown in red; my colour-blind colleague can’t tell them apart.",
        "ours",
        "Transactions",
        ["accessibility"],
      ),
      note(
        "f5",
        "Love the clean transaction list.",
        "",
        "competitor",
        "Transactions",
      ),
      note(
        "f6",
        "",
        "Amounts don’t line up in this table.",
        "ours",
        "Statements",
        ["visual"],
      ),
      note("f7", "ok", "", null),
      note(
        "f8",
        "",
        'The error just says "Something went wrong".',
        "ours",
        "Transfer failed",
        ["copy"],
      ),
      note(
        "f9",
        "Love the big, friendly balance at the top.",
        "",
        "competitor",
        "Home",
        ["visual"],
      ),
      note(
        "f10",
        "",
        "Onboarding asks for my income before I’ve seen anything.",
        "ours",
        "Onboarding",
        ["flow"],
      ),
    ],
    key: {
      explicit: [
        { notes: ["f3"], want: "Deleting a payee asks first or offers undo." },
        {
          notes: ["f4"],
          want: "Negative amounts carry a sign or label as well as colour.",
        },
        { notes: ["f6"], want: "Amounts line up in tables." },
        {
          notes: ["f8"],
          want: "Errors say what went wrong and what to do next.",
        },
        {
          notes: ["f10"],
          want: "Onboarding asks for personal details like income only after showing value.",
        },
      ],
      vague: [
        {
          notes: ["f1"],
          meant:
            "Too many charts at once: show balances first, charts on demand.",
        },
        {
          notes: ["f2"],
          meant:
            "Plain, restrained styling and a confirmation step showing amount and recipient before money moves.",
        },
        {
          notes: ["f5"],
          meant:
            "One line per transaction (merchant, date, amount at the right), with no icons.",
        },
      ],
      context: [
        "f9 (a big balance) holds on the home screen; r2 (accounts as rows, no hero numbers) elsewhere.",
      ],
      conflicts: [
        "f9 pulls against library rule r2; flagged or scoped to home, never r2 reworded.",
      ],
      strengthen: [],
      nothing: ["f7"],
    },
    taste: [
      "Money shown with its currency and two decimals.",
      "Overviews show balances first; charts on demand, never many at once.",
      "Plain, restrained styling, and a confirmation step showing amount and recipient before money moves.",
      "Deleting asks first or offers undo.",
      "Negative amounts carry a minus sign or label, never colour alone.",
      "Transactions one line each: merchant, date, amount at the right; no icons.",
      "Amounts line up in tables and lists.",
      "Errors say what went wrong and what to do next.",
      "A big balance figure on the home screen; elsewhere accounts are rows in one list.",
      "Ask for personal details such as income only after the product has shown its value.",
    ],
    task: "Build the home screen of a personal-finance web app, as one HTML file with Tailwind classes: the total balance, three accounts, the eight latest transactions (some negative), the confirmation step of sending money, the message shown when a transfer fails, and a way to remove a payee.",
  },
]
