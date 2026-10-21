import type { LearnNote } from "../../src/lib/pin/learn"

/*
 * The crop benchmark's cases (D96): three screens drawn in HTML, each with four notes on a spot
 * of it and a key the reader never sees, saying what the designer meant. Three kinds of note:
 * - `precise`: the words say it all; a close-up should add nothing, and must not add guesses;
 * - `vague`: the words judge something ("I like this heading") that the close-up shows;
 * - `spot`: the words mean nothing without the spot ("This works", "Too much going on here").
 * Written by hand for the benchmark: a diagnostic, not data from real designers.
 */

export type CropNote = LearnNote & {
  /** The element the note is on, by CSS selector. */
  selector: string
  mark: "dot" | "area"
  kind: "precise" | "vague" | "spot"
  /** What the designer meant: the reader never sees it. */
  meant: string
}

export type CropCase = {
  id: string
  designer: string
  html: string
  notes: CropNote[]
}

const page = (
  body: string,
) => `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
body{margin:0;font:14px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif;color:#1f2937;background:#f8fafc}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:18px 20px}
.muted{color:#6b7280}
button{font:inherit;cursor:pointer}
</style></head><body>${body}</body></html>`

const note = (
  id: string,
  selector: string,
  mark: CropNote["mark"],
  kind: CropNote["kind"],
  works: string,
  doesNotWork: string,
  meant: string,
  topics: LearnNote["topics"] = [],
): CropNote => ({
  id,
  selector,
  mark,
  kind,
  works,
  doesNotWork,
  meant,
  topics,
  source: "ours",
})

const analytics = page(`
<div style="padding:32px 40px;width:1280px">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <h1 style="font-size:26px;font-weight:600;margin:0">Revenue</h1>
    <button id="range" style="border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:6px 14px">Custom &#9662;</button>
  </div>
  <div id="label" style="margin:28px 0 10px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;font-weight:600">This quarter</div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
    <div class="card"><div class="muted" style="font-size:12px">Revenue</div><div style="font-size:28px;font-weight:600">$48,210</div><div style="font-size:12px;color:#15803d">+12% vs last quarter</div></div>
    <div class="card"><div class="muted" style="font-size:12px">Customers</div><div style="font-size:28px;font-weight:600">1,204</div><div style="font-size:12px;color:#15803d">+3% vs last quarter</div></div>
    <div class="card" id="busy" style="display:flex;gap:12px;align-items:flex-start;border:2px solid #fca5a5;background:#fff7ed">
      <div style="width:34px;height:34px;border-radius:8px;background:linear-gradient(135deg,#f97316,#db2777)"></div>
      <div style="flex:1">
        <div style="display:flex;gap:6px;align-items:center;font-size:12px"><b>Churn</b><span style="border:1px solid #9ca3af;border-radius:50%;width:14px;height:14px;font-size:9px;text-align:center;line-height:12px">i</span><span style="background:#f97316;color:#fff;border-radius:999px;padding:0 6px;font-size:10px;font-weight:700">NEW</span></div>
        <div style="display:flex;gap:10px;align-items:center"><span style="font-size:32px;font-weight:800;color:#dc2626">2.4%</span>
          <svg width="90" height="28"><polyline points="0,20 15,14 30,18 45,8 60,12 75,4 90,10" fill="none" stroke="#dc2626" stroke-width="2"/></svg></div>
        <div style="font-size:12px;color:#dc2626">&#9650; 0.3 pt &middot; <u>View report</u> &middot; <u>Set alert</u></div>
      </div>
    </div>
  </div>
  <div id="table" class="card" style="margin-top:24px;padding:8px 20px">
    <table style="width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums">
      <thead><tr style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">
        <th style="text-align:left;padding:10px 0">Customer</th><th style="text-align:left">Plan</th><th style="text-align:right">Seats</th><th style="text-align:right">MRR</th></tr></thead>
      <tbody>
        ${[
          ["Northwind", "Team", "48", "$2,400"],
          ["Acme Labs", "Pro", "12", "$588"],
          ["Globex", "Team", "130", "$6,500"],
          ["Initech", "Starter", "3", "$45"],
          ["Umbrella", "Pro", "27", "$1,323"],
        ]
          .map(
            (r) =>
              `<tr style="border-top:1px solid #eef0f3"><td style="padding:10px 0">${r[0]}</td><td>${r[1]}</td><td style="text-align:right">${r[2]}</td><td style="text-align:right">${r[3]}</td></tr>`,
          )
          .join("")}
      </tbody>
    </table>
  </div>
</div>`)

const pricing = page(`
<div style="padding:40px;width:1280px;text-align:center">
  <h1 style="font-size:34px;font-weight:700;margin:0">Simple pricing for growing teams</h1>
  <p class="muted" style="margin:8px 0 22px">Start free. Change plans any time.</p>
  <div id="toggle" style="display:inline-flex;align-items:center;gap:10px">
    <div style="display:inline-flex;border:1px solid #d1d5db;border-radius:8px;padding:3px;background:#fff">
      <span style="padding:4px 14px">Monthly</span><span style="padding:4px 14px;background:#111827;color:#fff;border-radius:6px">Annual</span></div>
    <span style="background:#dcfce7;color:#166534;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600">Save 20%</span>
  </div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:30px;text-align:left">
    <div class="card"><h3 style="margin:0">Starter</h3><div style="font-size:30px;font-weight:700;margin:8px 0">$12<span class="muted" style="font-size:14px;font-weight:400"> / month</span></div>
      <ul style="padding-left:18px;margin:0 0 18px"><li>Unlimited projects</li><li>5 GB storage</li><li>Email support</li></ul>
      <button style="width:100%;padding:10px;border:1px solid #d1d5db;background:#fff;border-radius:8px">Get started</button></div>
    <div class="card" id="pro" style="background:#eef2ff;border-color:#c7d2fe">
      <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#4f46e5;font-weight:600">Most popular</div>
      <h3 style="margin:2px 0 0">Pro</h3><div style="font-size:30px;font-weight:700;margin:8px 0">$29<span class="muted" style="font-size:14px;font-weight:400"> / month</span></div>
      <ul id="features" style="padding-left:18px;margin:0 0 18px"><li>Priority support</li><li>Unlimited projects</li><li>50 GB storage</li><li>Version history</li></ul>
      <button id="cta" style="width:100%;padding:10px;border:0;background:#4f46e5;color:#fff;border-radius:8px">Get started</button></div>
    <div class="card"><h3 style="margin:0">Team</h3><div style="font-size:30px;font-weight:700;margin:8px 0">$79<span class="muted" style="font-size:14px;font-weight:400"> / month</span></div>
      <ul style="padding-left:18px;margin:0 0 18px"><li>SSO</li><li>Version history</li><li>Unlimited projects</li><li>500 GB storage</li><li>Priority support</li></ul>
      <button style="width:100%;padding:10px;border:1px solid #d1d5db;background:#fff;border-radius:8px">Get started</button></div>
  </div>
</div>`)

const field =
  "width:100%;padding:9px 11px;border:1px solid #d1d5db;border-radius:7px;font:inherit;background:#fff"
const settings = page(`
<div style="width:1280px;padding:36px 0 0">
 <div style="width:640px;margin:0 auto">
  <h1 style="font-size:26px;font-weight:600;margin:0 0 18px">Settings</h1>
  <h2 style="font-size:15px;margin:0 0 10px">Profile</h2>
  <div id="fields" style="display:grid;gap:10px">
    <input style="${field}" placeholder="Full name">
    <input style="${field}" placeholder="Company">
  </div>
  <div style="margin-top:14px"><label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px">Email</label>
    <input style="${field};border-color:#dc2626" value="dana@acme">
    <div id="error" style="display:flex;gap:6px;align-items:center;margin-top:5px;font-size:13px;color:#b91c1c"><span style="width:14px;height:14px;border-radius:50%;background:#dc2626;color:#fff;font-size:10px;text-align:center;line-height:14px;font-weight:700">!</span>Enter a valid email, like name@company.com</div></div>
  <h2 style="font-size:15px;margin:28px 0 10px">Notifications</h2>
  <label style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><input type="checkbox" checked> Weekly summary</label>
  <label style="display:flex;gap:8px;align-items:center"><input type="checkbox"> Product news</label>
 </div>
 <div id="footer" style="margin-top:36px;border-top:1px solid #e5e7eb;background:#fff;padding:14px 0">
  <div style="width:640px;margin:0 auto;display:flex;justify-content:flex-end;gap:18px;align-items:center">
    <a class="muted" style="text-decoration:none">Cancel</a>
    <button style="padding:9px 18px;border:0;border-radius:8px;background:#111827;color:#fff;font-weight:600">Save changes</button>
  </div>
 </div>
</div>`)

export const CROP_CASES: CropCase[] = [
  {
    id: "analytics",
    designer: "Product designer on a B2B analytics app",
    html: analytics,
    notes: [
      note(
        "n1",
        "#label",
        "dot",
        "vague",
        "I like this heading.",
        "",
        "Small group labels above a set of cards: uppercase, letter-spaced, small and muted. Not the page title.",
      ),
      note(
        "n2",
        "#busy",
        "area",
        "spot",
        "",
        "Too much going on in here.",
        "A stat card shows one number and its change; no icon, badge, sparkline, info button or links crowding it, and no alarm colours on the whole card.",
      ),
      note(
        "n3",
        "#table",
        "area",
        "vague",
        "Easy to scan.",
        "",
        "Tables keep numbers right-aligned in tabular figures, with only light horizontal row dividers and no vertical lines.",
      ),
      note(
        "n4",
        "#range",
        "dot",
        "precise",
        "",
        "The date button says Custom; show the selected range on it instead, like Jul 1 – Sep 30.",
        "A date range button shows the selected dates, not the word Custom.",
        ["copy", "interaction"],
      ),
    ],
  },
  {
    id: "pricing",
    designer: "Designer on a SaaS marketing site",
    html: pricing,
    notes: [
      note(
        "n1",
        "#toggle",
        "area",
        "spot",
        "This works.",
        "",
        "Show the annual saving as a small pill right beside the monthly/annual toggle.",
      ),
      note(
        "n2",
        "#pro",
        "area",
        "vague",
        "Love how this one stands out without shouting.",
        "",
        "Mark the recommended plan with a light tint, a thin tinted border and a small Most popular label: no banner, badge burst or scale-up.",
      ),
      note(
        "n3",
        "#features li:nth-child(2)",
        "dot",
        "spot",
        "",
        "Hard to compare.",
        "Plan cards list the same features in the same order, so they line up across plans; here each card orders them differently.",
      ),
      note(
        "n4",
        "#cta",
        "dot",
        "precise",
        "",
        "Get started on every plan says nothing; name the plan, like Start Pro trial.",
        "Each plan's button names the plan.",
        ["copy"],
      ),
    ],
  },
  {
    id: "settings",
    designer: "Product designer on account settings",
    html: settings,
    notes: [
      note(
        "n1",
        "#fields",
        "area",
        "spot",
        "",
        "Where did the labels go?",
        "Every input has a visible label above it; placeholder text is never the only label.",
      ),
      note(
        "n2",
        "#error",
        "dot",
        "spot",
        "This is how errors should read.",
        "",
        "An error sits right under its field and says what to do, with an example of a valid value.",
      ),
      note(
        "n3",
        "#footer > div",
        "area",
        "spot",
        "Good.",
        "",
        "One primary button at the bottom right, with Cancel as a quiet text link beside it, not a second button.",
      ),
      note(
        "n4",
        "h2",
        "dot",
        "precise",
        "Settings grouped under short headings like Profile and Notifications.",
        "",
        "Group settings under short section headings.",
        ["layout"],
      ),
    ],
  },
]
