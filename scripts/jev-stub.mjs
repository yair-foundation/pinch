// A stand-in for Jev's systemone endpoint, to run Pinch's note tagging locally
// without a key:  node scripts/jev-stub.mjs [port]  (default 3999), then
//   JEV_API_KEY=stub JEV_ENDPOINT=http://localhost:3999 pnpm dev
// It answers the area questions (src/lib/pin/notes-tags.ts) from keywords in
// the note, in Jev's shape ({ model, answers: { <id>: { noul } }, usage }):
// the state is { text } and each question's id is an area (type, colour,
// layout, …); an area answers 0.9 when the text has one of its keywords
// (AREA_RULES), 0.1 otherwise. Several areas can match one note. Not Jev:
// only the plumbing is under test, never the tagging quality.
import { createServer } from "node:http"

const PORT = Number(process.argv[2] ?? 3999)

/** Area → the words in a note that make it about that area. */
const AREA_RULES = {
  type: /\b(font|typeface|typography|type size|text size|weight|line height|letter.?spacing|serif)\b/i,
  colour: /\b(colou?r|contrast|palette|theme|dark mode|light mode|tint)s?\b/i,
  layout: /\b(spacing|align(ed|ment)?|grid|layout|group(ed|ing)?|margin|padding|structure)\b/i,
  density: /\b(clutter(ed)?|crowded|dense|density|too much|too many|whitespace|breath(e|ing room))\b/i,
  motion: /\b(animat(ed|ion)|transition|hover|motion|loading|spinner|feedback)s?\b/i,
  copy: /\b(copy|wording|label(s|led)?|tone|microcopy|heading|error message|says)\b/i,
  hierarchy: /\b(hierarch(y|ical)|stands? out|focal|emphasis|importan(t|ce)|first thing)\b/i,
  components: /\b(button|input|table|chart|card|nav(igation)?|menu|modal|dropdown|toggle|tab)s?\b/i,
  imagery: /\b(icon|illustration|photo|image|logo|brand|graphic)s?\b/i,
  accessibility: /\b(accessib(le|ility)|readab(le|ility)|tap target|screen reader|keyboard|a11y)\b/i,
}

createServer((req, res) => {
  let body = ""
  req.on("data", (c) => (body += c))
  req.on("end", () => {
    const { questions = {}, state = {} } = JSON.parse(body || "{}")
    const text = String(state.text ?? "")
    const areas = Object.keys(AREA_RULES).filter((a) => a in questions && AREA_RULES[a].test(text))
    const answers = {}
    for (const id of Object.keys(questions)) {
      answers[id] = { type: "noul", noul: areas.includes(id) ? 0.9 : 0.1 }
    }
    console.log(`[jev-stub] "${text.slice(0, 60)}" → ${areas.join(", ") || "no area"}`)
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ model: "jev-stub", answers, usage: { input_tokens: 0 } }))
  })
}).listen(PORT, () => console.log(`[jev-stub] listening on ${PORT}`))
