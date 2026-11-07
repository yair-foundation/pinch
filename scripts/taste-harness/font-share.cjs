// Measures one taste point in the code, not by a judge's eye: the share of each page's text under
// 16px, for designer 2's builds with the takes (M) and with nothing (A), rounds 2 to 6 of rounds.mjs.
//
//   node scripts/taste-harness/font-share.cjs <dir>      (<dir> holds run.mjs's designers)
const { chromium } = require('playwright');
const path = require('node:path');
(async () => {
  const root = process.argv[2];
  const b = await chromium.launch();
  const rows = [];
  for (const arm of ['A', 'M']) for (let r = 2; r <= 6; r++) {
    const f = path.join(root, 'd2', 'rounds', `r${r}`, arm, 'index.html');
    const p = await b.newPage({ viewport: { width: 1440, height: 2400 } });
    await p.goto(`file://${f}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(800);
    const s = await p.evaluate(() => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let total = 0, small = 0, tiny = 0;
      while (w.nextNode()) {
        const n = w.currentNode; const t = n.textContent.trim();
        if (!t) continue;
        const el = n.parentElement; const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        const px = parseFloat(cs.fontSize); const chars = t.length;
        total += chars; if (px < 16) small += chars; if (px < 13) tiny += chars;
      }
      return { total, small, tiny };
    });
    rows.push({ arm, r, share: +(100 * s.small / s.total).toFixed(0), tiny: +(100 * s.tiny / s.total).toFixed(0) });
    await p.close();
  }
  for (const arm of ['A', 'M']) console.log(arm, 'share of text under 16px, rounds 2-6:', rows.filter(x => x.arm === arm).map(x => `${x.share}%`).join(' '), '| under 13px:', rows.filter(x => x.arm === arm).map(x => `${x.tiny}%`).join(' '));
  await b.close();
})();
