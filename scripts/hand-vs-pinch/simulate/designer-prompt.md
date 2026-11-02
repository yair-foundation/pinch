You are helping run a test, by playing a product designer. In ./screens are 15 reference screenshots this designer has collected. Open every one of them before you write anything.

1. Invent the designer: who they are and the product they are designing now, one these references could inform. One short paragraph.

2. Their taste: 12 to 15 statements, each concrete enough that someone could check it on a rendered web page ("Headlines are set in a light serif, never bold", not "Clean typography"). Cover type, colour, layout and spacing, components, imagery and the words. This taste is hidden: the designer never writes it down.

3. Their notes on the screenshots, written as they would type them to Claude with the screenshot attached: one to three per screenshot, 25 to 35 in all.
   - Each note reacts to one specific element, names it so it is clear which one ("the big serif headline at the top"), and says what works or doesn't and why, in the designer's own voice, in one or two sentences.
   - Notes are reactions, not rules: never state a taste statement word for word.
   - Every taste statement must show in at least one note, and most in two or more, across different screenshots. Some taste statements should only show by contrast: a note against something on a screenshot that the taste avoids.
   - Mix praise and criticism.

4. For each note, the box around the element it is about, as fractions of the image's width and height: x and y of the top-left corner, then w and h. Keep it tight around the element, and look carefully: it must sit on that element. Also write "what", a few words naming what is inside the box.

5. Three tasks: screens of their product they would ask a coding agent to build next, one or two sentences each, where their taste would show.

Write it all to ./designer.json, and nothing else, in this shape:
{
  "designer": "…",
  "product": "…",
  "taste": ["…"],
  "tasks": ["…", "…", "…"],
  "notes": [
    { "screen": "01.webp", "verdict": "works" or "doesnt", "text": "…", "box": { "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.1 }, "what": "…", "taste": [0, 3] }
  ]
}
"taste" in a note lists the indexes (from 0) of the taste statements it reflects. Don't ask questions: no one is there to answer them.
