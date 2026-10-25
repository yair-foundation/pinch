/**
 * `check-render.js` in the rules package (D109): plain JavaScript that runs the author's
 * confirmed checks (`checks.json`) on a rendered page in a browser and reports what fails, with
 * the rules each failure breaks. Kept as text, written into the zip as it is, so it runs
 * anywhere a page does (a browser's console, Playwright, Puppeteer) with nothing to install.
 * In Node it exports the same functions, which is how the tests run it.
 */
export const CHECK_SCRIPT = String.raw`/*
 * check-render.js, from Pinch: runs the designer's confirmed checks (checks.json) on a rendered
 * page and says what fails, with the rules each failure breaks.
 *
 * In a page (the console, or Playwright's page.addScriptTag), then:
 *   const result = pinchChecks.run(spec, { scale: 1 });
 *   console.log(pinchChecks.report(result));
 * spec is checks.json, parsed. scale is the size the page is shown at over the size it is
 * rendered at: a mock rendered 3200px wide and shown 1600px wide has scale 0.5. root is the
 * element to check (the whole body if left out).
 */
(function (root) {
  'use strict';

  function parseColour(value) {
    if (!value) return null;
    var v = String(value).trim().toLowerCase();
    if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    var m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
    if (m) {
      var h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
    }
    m = v.match(/^rgba?\(([^)]+)\)$/);
    if (!m) return null;
    var parts = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
    if (parts.length < 3 || parts.slice(0, 3).some(isNaN)) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 && !isNaN(parts[3]) ? parts[3] : 1 };
  }

  function hex(c) {
    return '#' + [c.r, c.g, c.b].map(function (n) {
      return ('0' + Math.round(n).toString(16)).slice(-2);
    }).join('');
  }

  // A colour laid over another, as the eye sees it.
  function blend(top, under) {
    var a = top.a;
    return {
      r: top.r * a + under.r * (1 - a),
      g: top.g * a + under.g * (1 - a),
      b: top.b * a + under.b * (1 - a),
      a: 1,
    };
  }

  function luminance(c) {
    var ch = [c.r, c.g, c.b].map(function (n) {
      var s = n / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  // The WCAG contrast ratio of a text colour on a background, the text laid over it first.
  function contrast(fg, bg) {
    var f = fg.a < 1 ? blend(fg, bg) : fg;
    var l1 = luminance(f);
    var l2 = luminance(bg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  // Whether two colours are the same to the eye: within 12 of 255 on each channel, combined.
  function near(a, b) {
    var d = Math.sqrt(Math.pow(a.r - b.r, 2) + Math.pow(a.g - b.g, 2) + Math.pow(a.b - b.b, 2));
    return d <= 12;
  }

  function firstFamily(value) {
    return String(value || '').split(',')[0].replace(/["']/g, '').trim();
  }

  // Words of letters, for the checks on how text is written (D127).
  function wordsOf(text) {
    return String(text || '').match(/[A-Za-z\u00C0-\u024F]+/g) || [];
  }

  // Capitals: a word of five or more, or two of four or more. Short acronyms (AI, USD) pass.
  function shouting(text) {
    var caps = wordsOf(text).filter(function (w) {
      return w.length >= 2 && w === w.toUpperCase() && w !== w.toLowerCase();
    });
    return caps.some(function (w) { return w.length >= 5; }) ||
      caps.filter(function (w) { return w.length >= 4; }).length >= 2;
  }

  var SMALL = ['with', 'from', 'into', 'over', 'your', 'that', 'this', 'than', 'then', 'when', 'what', 'they', 'them'];

  // Title Case: two or more of the longer words after the first start with a capital, and all do.
  function titleCased(text) {
    var words = wordsOf(text);
    var rest = words.slice(1).filter(function (w) {
      return w.length >= 4 && SMALL.indexOf(w.toLowerCase()) < 0 && w !== w.toUpperCase();
    });
    return rest.length >= 2 && /^[A-Z\u00C0-\u00DE]/.test(words[0]) && rest.every(function (w) {
      return /^[A-Z\u00C0-\u00DE]/.test(w);
    });
  }

  // A date in numbers alone: 2026-10-25, 25.10.26, 10/25/2026; the parts must read as a date.
  function numericDate(text) {
    var m = String(text || '').match(/\b(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})\b|\b(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})\b/);
    if (!m) return '';
    if (m[1]) return +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31 ? m[0] : '';
    var a = +m[4], b = +m[5];
    return a >= 1 && b >= 1 && ((a <= 31 && b <= 12) || (a <= 12 && b <= 31)) ? m[0] : '';
  }

  function rulesLine(check) {
    return (check.rules || []).map(function (r) { return r.id; }).join(', ');
  }

  // Every check against what was read off the page. texts: { where, text, size, family, colour,
  // background, full, underlined, upper, align, heading } with size in px at display size and
  // background null when it can't be known (an image or a gradient behind it). colours: { where,
  // property, value }. more: { images: [{ where, text, natural, shown }] with each a width over
  // height, natural 0 when not loaded; inputs: [{ where, text, labelled }] }.
  function evaluate(spec, texts, colours, more) {
    more = more || {};
    var images = more.images || [];
    var inputs = more.inputs || [];
    var failures = [];
    var skipped = { contrast: 0, images: 0 };
    var CAP = 50;
    // A title is a heading, or text a quarter larger than the page's most common size, with a word
    // in it.
    var counts = {};
    texts.forEach(function (t) {
      var k = Math.round(t.size * 2) / 2;
      counts[k] = (counts[k] || 0) + 1;
    });
    var body = 0;
    Object.keys(counts).forEach(function (k) {
      if (!body || counts[k] > counts[body] || (counts[k] === counts[body] && +k < +body)) body = k;
    });
    body = +body;
    var titles = texts.filter(function (t) {
      return (t.heading || (body && t.size >= body * 1.25)) &&
        wordsOf(t.full || t.text).some(function (w) { return w.length >= 3; });
    });
    (spec.checks || []).forEach(function (check) {
      var found = [];
      var v = check.value;
      if (check.kind === 'textSize') {
        texts.forEach(function (t) {
          if (t.size < v - 0.01)
            found.push({ where: t.where, text: t.text, found: Math.round(t.size * 10) / 10 + 'px', limit: 'at least ' + v + 'px' });
        });
      } else if (check.kind === 'contrast') {
        texts.forEach(function (t) {
          var fg = parseColour(t.colour);
          var bg = t.background ? parseColour(t.background) : null;
          if (!fg || !bg) { skipped.contrast++; return; }
          var ratio = contrast(fg, bg);
          if (ratio < v - 0.005)
            found.push({ where: t.where, text: t.text, found: ratio.toFixed(2) + ':1', limit: 'at least ' + v + ':1' });
        });
      } else if (check.kind === 'bannedColours') {
        var banned = v.map(parseColour).filter(Boolean);
        colours.forEach(function (c) {
          var col = parseColour(c.value);
          if (!col || col.a === 0) return;
          var hit = banned.filter(function (b) { return near(col, b); })[0];
          if (hit)
            found.push({ where: c.where, text: c.property, found: hex(col), limit: 'a colour other than ' + hex(hit) });
        });
      } else if (check.kind === 'fonts') {
        var allowed = v.map(function (f) { return f.toLowerCase(); });
        texts.forEach(function (t) {
          if (allowed.indexOf(String(t.family).toLowerCase()) < 0)
            found.push({ where: t.where, text: t.text, found: t.family || '(none)', limit: 'one of ' + v.join(', ') });
        });
      } else if (check.kind === 'bannedFonts') {
        var avoid = v.map(function (f) { return f.toLowerCase(); });
        texts.forEach(function (t) {
          if (avoid.indexOf(String(t.family).toLowerCase()) >= 0)
            found.push({ where: t.where, text: t.text, found: t.family, limit: 'a family other than ' + v.join(', ') });
        });
      } else if (check.kind === 'typeSizes') {
        var sizes = [];
        texts.forEach(function (t) {
          var s = Math.round(t.size * 2) / 2;
          if (sizes.indexOf(s) < 0) sizes.push(s);
        });
        sizes.sort(function (a, b) { return a - b; });
        if (sizes.length > v)
          found.push({ where: 'the page', text: '', found: sizes.length + ' sizes (' + sizes.join(', ') + 'px)', limit: 'at most ' + v });
      } else if (check.kind === 'underlines') {
        texts.forEach(function (t) {
          if (t.underlined) found.push({ where: t.where, text: t.text, found: 'underlined', limit: 'no underline' });
        });
      } else if (check.kind === 'allCaps') {
        texts.forEach(function (t) {
          if (t.upper ? wordsOf(t.full || t.text).some(function (w) { return w.length >= 2; }) : shouting(t.full || t.text))
            found.push({ where: t.where, text: t.text, found: t.upper ? 'set in capitals by its style' : 'words in capitals', limit: 'sentence case' });
        });
      } else if (check.kind === 'titleCase') {
        titles.forEach(function (t) {
          if (titleCased(t.full || t.text)) found.push({ where: t.where, text: t.text, found: 'Title Case', limit: 'sentence case' });
        });
      } else if (check.kind === 'numericDates') {
        texts.forEach(function (t) {
          var d = numericDate(t.full || t.text);
          if (d) found.push({ where: t.where, text: t.text, found: d, limit: 'a date with the month in words' });
        });
      } else if (check.kind === 'centredTitles') {
        titles.forEach(function (t) {
          if (t.align === 'center' || t.align === '-webkit-center')
            found.push({ where: t.where, text: t.text, found: 'centred', limit: 'left-aligned' });
        });
      } else if (check.kind === 'stretchedImages') {
        images.forEach(function (im) {
          if (!im.natural) { skipped.images++; return; }
          var off = im.shown / im.natural - 1;
          if (Math.abs(off) > 0.02)
            found.push({ where: im.where, text: im.text, found: 'shown ' + Math.round(Math.abs(off) * 100) + '% ' + (off > 0 ? 'wider' : 'narrower') + ' than its own proportions', limit: 'its own proportions (crop it with object-fit: cover)' });
        });
      } else if (check.kind === 'unlabelledInputs') {
        inputs.forEach(function (i) {
          if (!i.labelled) found.push({ where: i.where, text: i.text, found: 'no visible label', limit: 'a <label> tied to it' });
        });
      }
      found.slice(0, CAP).forEach(function (f) {
        failures.push({ check: check.kind, rules: check.rules || [], where: f.where, text: f.text, found: f.found, limit: f.limit });
      });
      if (found.length > CAP)
        failures.push({ check: check.kind, rules: check.rules || [], where: '', text: '', found: (found.length - CAP) + ' more like these', limit: '' });
    });
    return { passed: failures.length === 0, failures: failures, read: { texts: texts.length, colours: colours.length, images: images.length, inputs: inputs.length }, skipped: skipped };
  }

  // A short path to an element: "main > section.hero > p:nth-of-type(2)".
  function pathOf(el) {
    var parts = [];
    for (var node = el; node && node.nodeType === 1 && parts.length < 4; node = node.parentElement) {
      var tag = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(tag + '#' + node.id); break; }
      var cls = (node.getAttribute('class') || '').trim().split(/\s+/)[0];
      var part = tag + (cls ? '.' + cls : '');
      var parent = node.parentElement;
      if (parent) {
        var same = Array.prototype.filter.call(parent.children, function (s) { return s.tagName === node.tagName; });
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
    }
    return parts.join(' > ');
  }

  // The colour behind an element, layers laid over white; null behind an image or gradient.
  function backgroundOf(el, win) {
    var layers = [];
    for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
      var cs = win.getComputedStyle(node);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      var c = parseColour(cs.backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 1) break;
      }
    }
    var out = { r: 255, g: 255, b: 255, a: 1 };
    for (var i = layers.length - 1; i >= 0; i--) out = blend(layers[i], out);
    return 'rgb(' + Math.round(out.r) + ', ' + Math.round(out.g) + ', ' + Math.round(out.b) + ')';
  }

  // Whether an element's text is underlined, by its own style or one it takes from around it.
  // Decoration doesn't reach into inline blocks, floats or positioned boxes.
  function underlinedOf(el, win) {
    for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
      var cs = win.getComputedStyle(node);
      if (/underline/.test(cs.textDecorationLine || cs.textDecoration || '')) return true;
      if (cs.display === 'inline-block' || cs.position === 'absolute' || cs.position === 'fixed' || cs.cssFloat !== 'none') return false;
    }
    return false;
  }

  var FIELD_TYPES = ['', 'text', 'email', 'search', 'number', 'tel', 'url', 'password', 'date', 'datetime-local', 'month', 'time', 'week'];

  // Whether a text field has a visible label tied to it: a <label>, or aria-labelledby.
  function labelledOf(el, doc) {
    var visible = function (n) { return n && n.textContent.trim() && n.getBoundingClientRect().width > 0; };
    if (Array.prototype.some.call(el.labels || [], visible)) return true;
    return (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).some(function (id) {
      return visible(doc.getElementById(id));
    });
  }

  // Reads the page and runs the checks.
  function run(spec, options) {
    options = options || {};
    var doc = options.document || root.document;
    var win = doc.defaultView;
    var scale = options.scale || 1;
    var top = options.root || doc.body;
    var texts = [];
    var colours = [];
    var images = [];
    var inputs = [];
    var all = [top].concat(Array.prototype.slice.call(top.querySelectorAll('*')));
    all.forEach(function (el) {
      var cs = win.getComputedStyle(el);
      var box = el.getBoundingClientRect();
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0 || !box.width || !box.height) return;
      var where = pathOf(el);
      var own = Array.prototype.filter.call(el.childNodes, function (n) {
        return n.nodeType === 3 && n.textContent.trim();
      }).map(function (n) { return n.textContent.trim(); }).join(' ');
      var tag = el.tagName;
      if (tag === 'IMG') {
        var px = function (side) { return parseFloat(cs['padding-' + side]) + parseFloat(cs['border-' + side + '-width']); };
        var w = box.width - px('left') - px('right');
        var h = box.height - px('top') - px('bottom');
        if (cs.objectFit === 'fill' && w > 0 && h > 0)
          images.push({ where: where, text: el.getAttribute('alt') || '', natural: el.naturalWidth && el.naturalHeight ? el.naturalWidth / el.naturalHeight : 0, shown: w / h });
      }
      if ((tag === 'INPUT' && FIELD_TYPES.indexOf(String(el.getAttribute('type') || '').toLowerCase()) >= 0) || tag === 'TEXTAREA' || tag === 'SELECT')
        inputs.push({ where: where, text: el.getAttribute('placeholder') || '', labelled: labelledOf(el, doc) });
      if (own) {
        texts.push({
          where: where,
          text: own.length > 40 ? own.slice(0, 39) + '…' : own,
          full: own,
          size: parseFloat(cs.fontSize) * scale,
          family: firstFamily(cs.fontFamily),
          colour: cs.color,
          background: backgroundOf(el, win),
          underlined: underlinedOf(el, win),
          upper: cs.textTransform === 'uppercase',
          align: cs.textAlign,
          heading: /^H[1-6]$/.test(tag) || el.getAttribute('role') === 'heading',
        });
        colours.push({ where: where, property: 'color', value: cs.color });
      }
      colours.push({ where: where, property: 'background-color', value: cs.backgroundColor });
      ['top', 'right', 'bottom', 'left'].forEach(function (side) {
        if (parseFloat(cs['border-' + side + '-width']) > 0 && cs['border-' + side + '-style'] !== 'none')
          colours.push({ where: where, property: 'border-' + side + '-color', value: cs['border-' + side + '-color'] });
      });
    });
    return evaluate(spec, texts, colours, { images: images, inputs: inputs });
  }

  // The result as lines to read: one per failure, with the rules it breaks.
  function report(result) {
    if (result.passed) return 'All checks pass (' + result.read.texts + ' texts read).';
    return result.failures.map(function (f) {
      return 'FAIL ' + f.check + ' (' + rulesLine(f) + ')' + (f.where ? ' at ' + f.where : '') + (f.text ? ' "' + f.text + '"' : '') + ': ' + f.found + (f.limit ? ', needs ' + f.limit : '');
    }).join('\n') + (result.skipped.contrast ? '\n' + result.skipped.contrast + ' texts on an image or gradient: contrast not checked.' : '') + (result.skipped.images ? '\n' + result.skipped.images + ' images not loaded: proportions not checked.' : '');
  }

  var api = { run: run, evaluate: evaluate, report: report, parseColour: parseColour, contrast: contrast, near: near, shouting: shouting, titleCased: titleCased, numericDate: numericDate, version: 2 };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.pinchChecks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;
