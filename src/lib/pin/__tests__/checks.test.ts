import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

import { CHECK_SCRIPT } from '../check-script';
import {
  type Check,
  checksBasis,
  checksManifest,
  checksOf,
  checksPrompt,
  checksRequest,
  checksStale,
  checksSystem,
  cleanChecks,
  cleanValue,
  hexOf,
  valueText,
  withChecks,
} from '../checks';
import {
  type BatchNote,
  type Collection,
  newCollection,
  type Rule,
  rulesOf,
  rulesPackage,
} from '../learnings';
import { checksGuide } from '../package-checks';

const note = (ref: string, works: string, doesNotWork = ''): BatchNote => ({
  ref,
  image: `${ref}.png`,
  source: 'ours',
  topics: ['visual'],
  works,
  doesNotWork,
  crop: `crops/${ref}.jpg`,
});

const rule = (id: string, text: string, notes: string[], context = ''): Rule => ({
  id,
  text,
  context,
  topics: ['visual'],
  tags: [],
  evidence: notes.map((n) => ({ batchId: 'b1', note: n })),
  status: 'approved',
  createdAt: `2026-10-21T10:00:0${id.charCodeAt(0) - 97}Z`,
});

function library(): Collection {
  return {
    ...newCollection('My rules', 'c1', '2026-10-21T10:00:00Z'),
    batches: [
      {
        id: 'b1',
        name: 'pinch-2026-10-21',
        addedAt: '2026-10-21T10:00:00Z',
        exportedAt: '2026-10-21T10:00:00Z',
        root: 'pinch-2026-10-21/',
        images: 3,
        notes: [
          note('01.1', '', 'text is too small for UI mocks'),
          note('02.1', '', "avoid this dark navy blue, it's legacy"),
          note('03.1', 'clean Figtree headings'),
        ],
      },
    ],
    rules: [
      rule('a', 'Keep text in UI mocks large enough to read.', ['01.1'], 'in UI mocks'),
      rule('b', 'Avoid the legacy dark navy blue.', ['02.1']),
      rule('c', 'Set text in Figtree.', ['03.1']),
    ],
  };
}

const suggested: Check[] = [
  { kind: 'textSize', value: 12, rules: ['a'], why: 'Estimated from "too small".' },
  { kind: 'bannedColours', value: ['#1f3a93'], rules: ['b'], why: 'Estimated navy.' },
];

describe('a check’s value (D109)', () => {
  it('is tidied to what the script can hold', () => {
    assert.equal(cleanValue('textSize', 11.26), 11.5);
    assert.equal(cleanValue('textSize', '3'), 6, 'never below the floor');
    assert.equal(cleanValue('contrast', '4,51'), 4.5);
    assert.equal(cleanValue('typeSizes', 4.4), 4);
    assert.equal(cleanValue('textSize', 'big'), null);
    assert.deepEqual(cleanValue('bannedColours', '#1F3A93, 0b2, nope, #1f3a93'), [
      '#1f3a93',
      '#00bb22',
    ]);
    assert.deepEqual(cleanValue('fonts', ['"Figtree"', ' figtree', 'Inter ']), [
      'Figtree',
      'Inter',
    ]);
    assert.equal(cleanValue('fonts', []), null);
    assert.equal(hexOf('zz'), '');
    assert.equal(valueText({ value: ['#1f3a93', '#00bb22'] }), '#1f3a93, #00bb22');
  });
});

describe('what goes to the AI and what comes back', () => {
  it('sends each rule’s words, place and notes, and nothing else', () => {
    const c = library();
    const req = checksRequest(rulesOf(c));
    assert.deepEqual(req[0], {
      id: 'a',
      text: 'Keep text in UI mocks large enough to read.',
      where: 'in UI mocks',
      notes: ["doesn't: text is too small for UI mocks"],
    });
    assert.match(
      checksPrompt(req),
      /^a: Keep text in UI mocks large enough to read\. \(where: in UI mocks\)\n {2}- doesn't: text/,
    );
  });

  it('keeps one check per kind, tied to rules that were asked about', () => {
    const out = cleanChecks(
      {
        checks: [
          {
            kind: 'textSize',
            number: 12.2,
            list: [],
            rules: ['a', 'zz', 'a'],
            why: ' From "too small". ',
          },
          { kind: 'textSize', number: 20, list: [], rules: ['a'], why: 'Twice.' },
          { kind: 'contrast', number: 4.5, list: [], rules: ['zz'], why: 'No rule asked about.' },
          {
            kind: 'bannedColours',
            number: null,
            list: ['#1F3A93', 'navy'],
            rules: ['b'],
            why: 'Estimate.',
          },
          { kind: 'fonts', number: null, list: [], rules: ['c'], why: 'Nothing usable.' },
        ],
      },
      ['a', 'b', 'c'],
    );
    assert.deepEqual(out, [
      { kind: 'textSize', value: 12, rules: ['a'], why: 'From "too small".' },
      { kind: 'bannedColours', value: ['#1f3a93'], rules: ['b'], why: 'Estimate.' },
    ]);
  });
});

describe('the collection’s checks, worked out in the background', () => {
  it('are asked for again only when the rules or their notes change', () => {
    const c = library();
    const basis = checksBasis(checksRequest(rulesOf(c)));
    assert.equal(
      basis,
      checksBasis(checksRequest(rulesOf(library()))),
      'the same rules, the same basis',
    );
    assert.ok(checksStale(c, basis), 'never worked out');
    const kept = withChecks(c, [suggested[1], suggested[0]], basis, 'one');
    assert.ok(!checksStale(kept, basis));
    assert.deepEqual(
      checksOf(kept).map((x) => x.kind),
      ['textSize', 'bannedColours'],
      'in the usual order',
    );
    assert.equal(kept.checks?.at, 'one');
    const reworded = {
      ...kept,
      rules: kept.rules.map((r) => (r.id === 'a' ? { ...r, text: 'Bigger text.' } : r)),
    };
    assert.ok(checksStale(reworded, checksBasis(checksRequest(rulesOf(reworded)))));
    const renoted = structuredClone(kept);
    renoted.batches[0].notes[0].doesNotWork = 'way too small';
    assert.ok(checksStale(renoted, checksBasis(checksRequest(rulesOf(renoted)))));
    const none = withChecks(c, [], basis, 'two');
    assert.ok(!checksStale(none, basis), 'no checks is an answer too, so it isn’t asked again');
  });

  it('go into the package with the script, say what they are, and mark the worklist', () => {
    const plainPackage = rulesPackage(library(), new Map(), '2026-10-22T09:00:00Z');
    assert.ok(
      !plainPackage.files.some(
        (f) => f.name.endsWith('/checks.json') || f.name.endsWith('/check-render.js'),
      ),
    );

    const c = withChecks(library(), [suggested[0]], 'x', 'n');
    const made = rulesPackage(c, new Map(), '2026-10-22T09:00:00Z');
    const read = (name: string) =>
      new TextDecoder().decode(made.files.find((f) => f.name.endsWith(`/${name}`))?.data);
    const json = JSON.parse(read('checks.json'));
    assert.equal(json.kind, 'checks');
    assert.equal(json.workedOutAt, 'n');
    assert.match(json.about, /without the author setting the numbers/);
    assert.deepEqual(
      json.checks.map((x: { kind: string }) => x.kind),
      ['textSize'],
    );
    assert.deepEqual(json.checks[0].rules, [{ id: 'R1', key: 'a' }]);
    assert.match(read('check-render.js'), /pinchChecks/);
    assert.match(
      read('README.md'),
      /`checks\.json` and `check-render\.js`: checks Pinch worked out/,
    );
    const md = read('checks.md');
    assert.match(md, /## Ready to run\n\nPinch worked out one check from these rules/);
    assert.match(md, /The author didn’t set these numbers/);
    assert.match(md, /\*\*Smallest text\*\*: 12 \(px at display size, at least\)\..* Holds R1\./);
    assert.match(md, /\| R1 \| `a` \| .* \| check \| check-render\.js: textSize \|/);
    assert.match(md, /\| R2 \| `b` \| .* \| {2}\| {2}\|/);
    assert.deepEqual(checksManifest(c, rulesOf(c), 'x').checks.length, 1);
    assert.doesNotMatch(checksGuide(library(), rulesOf(library()), 'x'), /## Ready to run/);
  });
});

/** A value from the script's own realm, as plain data to compare. */
const plain = (x: unknown) => JSON.parse(JSON.stringify(x));

/** The script as a page would load it, through Node's module exports. */
function script() {
  const module = { exports: {} as Record<string, unknown> };
  runInNewContext(CHECK_SCRIPT, { module, globalThis: {} });
  return module.exports as {
    evaluate: (
      spec: unknown,
      texts: unknown[],
      colours: unknown[],
    ) => {
      passed: boolean;
      failures: { check: string; where: string; found: string; rules: { id: string }[] }[];
      skipped: { contrast: number };
    };
    report: (r: unknown) => string;
    contrast: (a: unknown, b: unknown) => number;
    parseColour: (v: string) => { r: number; g: number; b: number; a: number } | null;
  };
}

describe('check-render.js', () => {
  const s = script();
  const spec = {
    checks: [
      { kind: 'textSize', value: 12, rules: [{ id: 'R1', key: 'a' }] },
      { kind: 'contrast', value: 4.5, rules: [{ id: 'R5', key: 'e' }] },
      { kind: 'bannedColours', value: ['#1f3a93'], rules: [{ id: 'R2', key: 'b' }] },
      { kind: 'fonts', value: ['Figtree'], rules: [{ id: 'R3', key: 'c' }] },
      { kind: 'typeSizes', value: 2, rules: [{ id: 'R4', key: 'd' }] },
    ],
  };
  const text = (where: string, size: number, extra: Record<string, unknown> = {}) => ({
    where,
    text: where,
    size,
    family: 'Figtree',
    colour: 'rgb(23, 23, 23)',
    background: 'rgb(255, 255, 255)',
    ...extra,
  });

  it('reads colours and measures contrast as WCAG does', () => {
    assert.deepEqual(plain(s.parseColour('#0b2')), { r: 0, g: 187, b: 34, a: 1 });
    assert.deepEqual(plain(s.parseColour('rgba(10, 20, 30, 0.5)')), {
      r: 10,
      g: 20,
      b: 30,
      a: 0.5,
    });
    assert.equal(s.parseColour('red'), null);
    const black = { r: 0, g: 0, b: 0, a: 1 };
    const white = { r: 255, g: 255, b: 255, a: 1 };
    assert.equal(Math.round(s.contrast(black, white)), 21);
    assert.equal(s.contrast(white, white), 1);
  });

  it('passes a page that keeps every check', () => {
    const r = s.evaluate(
      spec,
      [text('h1', 24), text('p', 16)],
      [{ where: 'p', property: 'color', value: 'rgb(23, 23, 23)' }],
    );
    assert.equal(r.passed, true);
    assert.match(s.report(r), /^All checks pass/);
  });

  it('fails each broken check with the rules it breaks', () => {
    const r = s.evaluate(
      spec,
      [
        text('h1', 24),
        text('small', 11),
        text('grey', 16, { colour: 'rgb(190, 190, 190)' }),
        text('serif', 16, { family: 'Georgia' }),
        text('on-photo', 16, { background: null }),
      ],
      [{ where: 'button', property: 'background-color', value: 'rgb(33, 60, 150)' }],
    );
    const kinds = r.failures.map((f) => f.check);
    assert.deepEqual(plain(kinds), ['textSize', 'contrast', 'bannedColours', 'fonts', 'typeSizes']);
    assert.equal(r.failures[0].where, 'small');
    assert.equal(r.failures[0].found, '11px');
    assert.equal(r.failures[2].found, '#213c96', 'close to the banned navy');
    assert.match(
      s.report(r),
      /FAIL bannedColours \(R2\) at button "background-color": #213c96, needs a colour other than #1f3a93/,
    );
    assert.equal(r.skipped.contrast, 1, 'text on an image is not judged');
    const lines = s.report(r);
    assert.match(lines, /FAIL textSize \(R1\) at small "small": 11px, needs at least 12px/);
    assert.match(
      lines,
      /FAIL typeSizes \(R4\) at the page: 3 sizes \(11, 16, 24px\), needs at most 2/,
    );
    assert.match(lines, /1 texts on an image or gradient: contrast not checked\./);
  });

  it('caps a long list of the same failure', () => {
    const many = Array.from({ length: 60 }, (_, i) => text(`p${i}`, 10));
    const r = s.evaluate({ checks: [spec.checks[0]] }, many, []);
    assert.equal(r.failures.length, 51);
    assert.equal(r.failures[50].found, '10 more like these');
  });
});

describe('render checks for a connected agent (D110)', () => {
  it('says there are none yet, then gives the checks and the script', async () => {
    const { renderChecksContent } = await import('../agent');
    const none = renderChecksContent(library(), true);
    assert.match(none.content[0].text, /^No render checks yet/);
    assert.match(renderChecksContent(null, true).content[0].text, /^No render checks yet/);
    const c = withChecks(library(), [suggested[0]], 'x', 'n');
    const both = renderChecksContent(c, true);
    assert.equal(both.content.length, 2);
    assert.match(both.content[0].text, /^checks\.json:\n\{/);
    const spec = JSON.parse(both.content[0].text.slice('checks.json:\n'.length));
    assert.deepEqual(spec.checks[0].rules, [{ id: 'R1', key: 'a' }]);
    assert.match(both.content[1].text, /^check-render\.js:\n/);
    assert.equal(renderChecksContent(c, false).content.length, 1, 'without the script when asked');
  });
});

describe('fonts to avoid (D112)', () => {
  it('is a check the model can answer, tidied like a list of families', () => {
    const out = cleanChecks(
      {
        checks: [
          {
            kind: 'bannedFonts',
            number: null,
            list: ['"Nunito"', 'nunito ', 'Nunito Sans'],
            rules: ['c'],
            why: 'The rules call Nunito legacy.',
          },
        ],
      },
      ['a', 'b', 'c'],
    );
    assert.deepEqual(out, [
      {
        kind: 'bannedFonts',
        value: ['Nunito', 'Nunito Sans'],
        rules: ['c'],
        why: 'The rules call Nunito legacy.',
      },
    ]);
    assert.match(checksSystem, /bannedFonts: font families no text may be set in/);
  });

  it('fails text set in a family to avoid, and passes the rest', () => {
    const s = script();
    const spec = {
      checks: [{ kind: 'bannedFonts', value: ['Nunito'], rules: [{ id: 'R171', key: 'n' }] }],
    };
    const text = (where: string, family: string) => ({
      where,
      text: where,
      size: 16,
      family,
      colour: 'rgb(0, 0, 0)',
      background: 'rgb(255, 255, 255)',
    });
    const r = s.evaluate(
      spec,
      [text('h1', 'Figtree'), text('button', 'nunito'), text('p', 'Nunito Sans')],
      [],
    );
    assert.equal(r.failures.length, 1);
    assert.match(
      s.report(r),
      /FAIL bannedFonts \(R171\) at button "button": nunito, needs a family other than Nunito/,
    );
  });

  it('goes into checks.md and checks.json like the others', () => {
    const c = withChecks(
      library(),
      [{ kind: 'bannedFonts', value: ['Nunito'], rules: ['c'], why: 'Legacy.' }],
      'x',
      'n',
    );
    const md = checksGuide(c, rulesOf(c), 'x');
    assert.match(
      md,
      /\*\*Fonts to avoid\*\*: Nunito \(font families\)\. No visible text is set in one of these families\. Holds R3\./,
    );
    assert.deepEqual(checksManifest(c, rulesOf(c), 'x').checks[0].rules, [{ id: 'R3', key: 'c' }]);
  });
});
