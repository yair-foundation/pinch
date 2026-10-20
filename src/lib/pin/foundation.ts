/*
 * The expert foundation (D90): what a seasoned interface designer brings to reading someone
 * else's notes. It is kept apart from the collection: the foundation explains an observation,
 * and only the designer's own notes establish a preference. A principle never becomes a rule
 * by itself, never adds to a rule what the notes don't say, and its own habits (a size, a
 * ratio, a colour) never enter one. A rule only names, in `principles`, the ones that helped
 * read it, by id; the collection keeps no word of the foundation.
 *
 * Each principle says where it applies, where it gives way, and what in a designer's notes
 * justifies reading a note through it. Notes are shorthand ("quiet", "heavy", "I like this
 * heading"), so SHORTHAND says which principles such words usually point at.
 *
 * Written in Pinch's words from three sources, each checked for its licence (none is copied):
 * GenUI's design foundations and review method, Anthropic's frontend-design skill (Apache
 * 2.0) and Vercel's Web Interface Guidelines (MIT). From the guidelines, only judgment a
 * screenshot shows; their code checks and Vercel's own brand preferences stay out.
 */

export const FOUNDATION_SOURCES = {
  genui: {
    name: 'GenUI design foundations and review method',
    where: 'github.com/yair-foundation/gen-ui (docs/design, .claude/skills/product-design-manager)',
    licence: 'Yair Foundation’s own; no licence file',
  },
  frontend: {
    name: 'frontend-design skill',
    where: 'github.com/anthropics/skills (skills/frontend-design)',
    licence: 'Apache License 2.0',
  },
  vercel: {
    name: 'Web Interface Guidelines',
    where:
      'github.com/vercel-labs/web-interface-guidelines, used by the web-design-guidelines skill',
    licence: 'MIT, © Vercel Labs',
  },
  pinch: { name: 'Pinch', where: 'this repository', licence: 'Pinch’s own' },
} as const;

export type FoundationSource = keyof typeof FOUNDATION_SOURCES;

export type Principle = {
  id: string;
  /** What it is about, in a word or two, to browse rules by: "Typography", "Spacing". */
  area: string;
  name: string;
  /** The principle, as a design lead holds it. */
  holds: string;
  /** Where it applies. */
  when: string;
  /** Where it gives way. */
  except: string;
  /** What in the designer's notes justifies reading a note through it. */
  evidence: string;
  sources: FoundationSource[];
};

export const PRINCIPLES: Principle[] = [
  {
    id: 'focus',
    area: 'Hierarchy',
    name: 'One focal point',
    holds:
      'a screen answers what it is for with one focal element and one main action; the rest sits quieter, and boldness is spent in one place',
    when: 'screens, cards and dialogs where several elements or actions compete',
    except:
      'views of equal peers by design: a comparison, a grid of items, a toolbar of equal tools',
    evidence:
      'something “gets lost” or “doesn’t stand out”, too many calls to action, no clear first step, or praise for a screen that says one thing',
    sources: ['genui', 'frontend'],
  },
  {
    id: 'task',
    area: 'Task focus',
    name: 'A task screen holds the task',
    holds:
      'where someone finishes a task, anything that is not the task (promotions, upsells, unrelated links) pulls them away from it',
    when: 'checkout, payment, sign-up, onboarding steps, forms',
    except: 'browsing and discovery screens, where suggestions are the point',
    evidence:
      '“too much going on”, “busy” or “distracting” written on a task screen, or praise for a focused flow',
    sources: ['pinch'],
  },
  {
    id: 'grouping',
    area: 'Spacing',
    name: 'Space groups before lines',
    holds:
      'nearness and alignment group content first; every border, divider, outline or box adds weight, so lines go where space can’t do the job',
    when: 'sections, cards, settings, forms, lists',
    except:
      'dense data (tables, grids, code), where lines guide the eye along rows; the edge of a selected or invalid item',
    evidence:
      'notes on outlines, borders, boxes or dividers, “heavy”, “boxy”, or praise for spacing that separates',
    sources: ['genui'],
  },
  {
    id: 'structure',
    area: 'Structure',
    name: 'Structure carries information',
    holds:
      'numbering, labels over headings, dividers and outlines say something about the content (a sequence, a group, a status); as decoration they read as template chrome',
    when: 'numbered markers, small labels above headings, decorative rules',
    except: 'a real sequence (steps, a timeline) is numbered; real categories are labelled',
    evidence: '“why is this numbered”, “unnecessary labels”, “templated”, or praise for restraint',
    sources: ['frontend'],
  },
  {
    id: 'colour',
    area: 'Colour',
    name: 'Colour carries meaning',
    holds:
      'colour marks selection, status, data or the main action; as decoration it makes a screen loud, and a coloured edge reads as selected or wrong',
    when: 'accents, backgrounds, badges, borders, links',
    except:
      'brand and marketing moments that spend colour on purpose, when the designer’s notes ask for it',
    evidence:
      '“too colourful”, “loud”, a distracting accent, two colours for one role, or praise for a palette',
    sources: ['genui'],
  },
  {
    id: 'not-colour-alone',
    area: 'Status cues',
    name: 'Never colour alone',
    holds:
      'status and kinds carry a label, icon or shape as well as colour, and charts use colours people with colour blindness can tell apart',
    when: 'status, errors, warnings, charts, legends',
    except: 'colour that carries no meaning',
    evidence:
      '“can’t tell which is which”, “warnings look the same as notes”, only red and green to tell apart',
    sources: ['vercel', 'genui'],
  },
  {
    id: 'density',
    area: 'Density',
    name: 'Density follows the job',
    holds:
      'screens people scan and work in all day (tables, dashboards, editors, inboxes) bear density; first-run, onboarding, checkout and marketing need room',
    when: 'notes on how much fits, rows visible, “crowded” or “sparse”',
    except:
      'none in itself: a taste for density in one place and room in another is context, not contradiction',
    evidence: 'notes that pull different ways about density on different kinds of screen',
    sources: ['genui'],
  },
  {
    id: 'type',
    area: 'Typography',
    name: 'Type follows its role',
    holds:
      'size and weight follow what the text is (title, body, label) with clear steps between levels; one or two families, clearly distinct, whose character fits the subject; lines short enough to read in comfort; numbers that are compared line up',
    when: 'headings, hierarchy, fonts, readability, figures',
    except: 'a display moment where the type itself is the picture',
    evidence:
      'notes on a font (“techy”, “generic”), on headings, on text too small or hard to read',
    sources: ['genui', 'frontend', 'vercel'],
  },
  {
    id: 'elevation',
    area: 'Depth',
    name: 'A shadow means it floats',
    holds:
      'a shadow says something floats above the page (a menu, a dialog, something dragged); on resting surfaces shadows read as noise or a template kit, and where they are used they read like real light',
    when: 'cards, panels and buttons with shadows, gloss or gradients',
    except: 'floating layers; a deliberately tactile style the designer asks for',
    evidence: 'notes on shadows or depth, “cheap”, “dated”, “glossy”, “flat”',
    sources: ['genui', 'vercel', 'frontend'],
  },
  {
    id: 'subject',
    area: 'Character',
    name: 'Character comes from the subject',
    holds:
      'a screen feels its own when its imagery, type and colour come from its subject’s world; what any product would use (stock photos, generic gradients, the same card kit) reads as generic',
    when: 'heroes, marketing, brand moments',
    except: 'utility screens, where familiar beats distinctive (settings, forms)',
    evidence: '“generic”, “templated”, “could be anyone’s”, or praise for character',
    sources: ['frontend'],
  },
  {
    id: 'motion',
    area: 'Motion',
    name: 'Motion answers or explains',
    holds:
      'motion earns its place when it answers an action or shows what changed; one deliberate moment beats effects everywhere; nothing moves by itself while people read unless they can stop it; reduced motion is respected',
    when: 'animation, transitions, carousels, anything that moves on its own',
    except: 'one moment of deliberate delight the designer asks for',
    evidence:
      '“smooth”, “janky”, a distracting animation, something that moves on before people finish reading',
    sources: ['frontend', 'vercel'],
  },
  {
    id: 'states',
    area: 'Feedback',
    name: 'Controls show they respond',
    holds:
      'what can be used looks usable, hover, press and focus stand out more than rest, focus always shows, and nothing that looks usable is dead',
    when: 'buttons, links, rows, keyboard use',
    except: 'static content, which needs no states',
    evidence: '“didn’t know I could click”, “no feedback”, “can’t see where I am”',
    sources: ['vercel', 'genui'],
  },
  {
    id: 'reach',
    area: 'Sizing',
    name: 'Sized for where it is used',
    holds:
      'targets are generous and as big as they look, text is big enough to read where and how the screen is used, and zoom is never blocked',
    when: 'mobile, touch, small controls, reading on the move',
    except: 'dense data cells on a desktop screen',
    evidence: '“tiny”, “hard to tap”, “too small to read”, “missed the button”',
    sources: ['genui', 'vercel'],
  },
  {
    id: 'words',
    area: 'Tone and words',
    name: 'Words say what happens',
    holds:
      'labels name things as people know them; a button says what it does and keeps that name through the flow; an error says what went wrong and how to fix it, without jokes or apology; tone is plain where something is at stake (errors, money, deleting) and can be lighter where nothing is',
    when: 'buttons, errors, empty states, headings, labels',
    except: 'a playful tone where nothing is at stake, when the designer likes it',
    evidence:
      'notes on copy: “Submit” everywhere, a cute error, a confusing label, “what does this do”',
    sources: ['frontend', 'vercel', 'genui'],
  },
  {
    id: 'flows',
    area: 'Edge states',
    name: 'Every state has a way on',
    holds:
      'empty, loading, partial, very long and failed states are designed, each with a next step; loading keeps its label; what can’t be undone asks first or offers undo; what is off says why',
    when: 'empty screens, errors, loading, deleting, disabled controls',
    except: 'screens that can’t be empty or fail',
    evidence: 'notes on dead ends, blank screens, lost work, spinners, “why can’t I click this”',
    sources: ['vercel', 'genui'],
  },
  {
    id: 'alignment',
    area: 'Alignment',
    name: 'Alignment is deliberate',
    holds:
      'every element lines up with something on purpose (an edge, a grid, a baseline); inner corners fit inside outer ones; an icon beside text matches its weight',
    when: 'notes that something feels “off”, “messy” or “unpolished”, or praise for polish',
    except: 'deliberate offsets in an expressive layout',
    evidence: '“off”, “misaligned”, “sloppy”, “polished”, “crafted”',
    sources: ['vercel'],
  },
];

/** Words designers use about a screen, and the principles they usually point at. */
export const SHORTHAND: { words: string[]; principles: string[] }[] = [
  { words: ['quiet', 'calm', 'breathes'], principles: ['focus', 'colour', 'grouping'] },
  {
    words: ['busy', 'crowded', 'cluttered', 'too much going on'],
    principles: ['focus', 'task', 'density'],
  },
  { words: ['heavy', 'boxy'], principles: ['grouping', 'elevation'] },
  { words: ['gets lost', 'doesn’t stand out'], principles: ['focus', 'states'] },
  {
    words: ['cheap', 'dated', 'tacky'],
    principles: ['elevation', 'colour', 'alignment', 'subject'],
  },
  { words: ['generic', 'templated'], principles: ['subject', 'structure', 'type'] },
  { words: ['premium', 'polished'], principles: ['alignment', 'colour', 'type'] },
  { words: ['confusing', 'unclear'], principles: ['focus', 'words', 'grouping'] },
  { words: ['cute', 'playful', 'cold', 'robotic'], principles: ['words'] },
  { words: ['friendly', 'soft'], principles: ['subject', 'colour', 'words'] },
  { words: ['easy to scan', 'scannable'], principles: ['grouping', 'type', 'structure'] },
  { words: ['smooth', 'janky'], principles: ['motion'] },
  { words: ['clean', 'clear', 'simple', 'nice', 'gorgeous'], principles: [] },
];

const principleLine = (p: Principle) =>
  `  - ${p.id}, ${p.name}: ${p.holds}. Applies to: ${p.when}. Gives way: ${p.except}. Evidence in notes: ${p.evidence}.`;

const shorthandLine = (s: (typeof SHORTHAND)[number]) =>
  `  - ${s.words.map((w) => `“${w}”`).join(', ')}: ${s.principles.length ? s.principles.join(', ') : 'a verdict, not a quality; what earns it has to come from the rest of the note or other notes'}.`;

/** The foundation as the reading model gets it: a section of its instructions. */
export const foundationText = `The design foundation: what a design lead knows about interfaces. It explains what a note observes; only the designer's notes establish what they prefer.
- The principles, each with where it applies, where it gives way, and the evidence in notes that justifies reading a note through it:
${PRINCIPLES.map(principleLine).join('\n')}
- Notes are shorthand. Words like these usually point at these principles, but which quality this designer means is theirs to say:
${SHORTHAND.map(shorthandLine).join('\n')}
- Use a principle only where the notes show its evidence and the screen is one it applies to, and name its id in principles. Never use one to write a rule no note supports, to widen a rule beyond its notes, or to add the foundation's own habits: no size, ratio, colour or count the notes don't give. Where a note goes against a principle, the note wins.

Stated or interpreted (basis):
- "stated": the notes say what to do or avoid, in concrete words. "The main button gets lost next to the other actions" states it: "Make the main action stand out from the actions beside it." How it stands out isn't said, so the rule doesn't say.
- "interpreted": the rule names a quality the notes only gesture at, read through the foundation ("quiet", "heavy", "cheap"). Write in reading one short phrase on how you read their words, quoting them: "“quiet” as few elements competing for attention, and little colour". Prefer the reading the designer's other notes support: "quiet" beside notes against heavy borders is about restraint. Name only the qualities this note most plausibly means; leave the other candidates out of the rule. A reading has to commit to something an agent would do differently: one that only says the vague word again in other vague words ("techy" as "doesn't fit", "smooth" as "fluid") is no reading, so ask instead.
- A note that says what it means is stated. Don't mark a rule interpreted to look careful.

When to ask (question and options):
- When the words could point at things that would make an agent design differently, and no other note or library rule settles which, don't pick one: ask. Write one short question ("What do you like about this heading?") and two to four options, each a short answer ("Its short wording", "Its size") with the rule it makes, the most likely first. Draw the options from what that kind of screen and element are known for, not only from the words above; where two qualities usually go together, one option may name both. Write rule as the first option's rule; it waits for the designer's answer before an agent gets it.
- Don't ask when other notes settle it, when every reading leads to the same design, or when the note says what it means. Ask only what changes the design: a few questions at most, the most consequential first.
- A note that names an element and gives only praise or a verdict ("I like this heading", "love this settings page", "great onboarding") is worth a question: ask what about it. A note with neither an element nor a quality ("nice", "great") goes in no rule.`;

/** A principle's name by its id, or nothing for an id the foundation doesn't have. */
export const principleName = (id: string) => PRINCIPLES.find((p) => p.id === id)?.name;
