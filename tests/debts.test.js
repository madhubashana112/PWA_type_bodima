/* The "money I owe" list and its detail sheet — both were disfigured by CSS
   class names that two unrelated things were sharing. */
const h = require('./helpers/harness');

/* Do two elements' boxes actually sit on top of each other on screen? */
async function overlaps(page, a, bSel) {
  return page.evaluate(([x, y]) => {
    const p = document.querySelector(x), q = document.querySelector(y);
    if (!p || !q) return null;
    const r = p.getBoundingClientRect(), s = q.getBoundingClientRect();
    return !(r.right <= s.left || s.right <= r.left || r.bottom <= s.top || s.bottom <= r.top);
  }, [a, bSel]);
}

(async () => {
  const s = h.suite('debts');
  const b = await h.launch();
  const { ctx, page } = await h.open(b, s);
  await h.register(page, 'Rajawasala', 'pw', ['Shamindha', 'Madhubashana']);
  await h.settleIn(page);
  await page.evaluate(() => {
    S.debts = [{ id: 'd1', owner: S.members[1].id, ownerName: 'Madhubashana',
                 person: 'Shamindha', total: 5000, reason: '', date: Date.now(),
                 due: null, payments: [] }];
    save(); go('debts');
  });
  await page.waitForTimeout(400);

  s.section('1. the row lays out instead of stacking on itself');
  s.check('a debt row is showing', await page.evaluate(() => !!document.querySelector('.debt')));
  // The donut's centre label had claimed .dmid, which this column already
  // used, so every row became position:absolute and the name landed on top
  // of the amount.
  const pos = await page.evaluate(() => getComputedStyle(document.querySelector('.debt .dmid')).position);
  s.check('the middle column is in normal flow', pos !== 'absolute', pos);
  s.check('the name does not sit on the amount',
          (await overlaps(page, '.debt .dnm', '.debt .dright')) === false);
  s.check('the name does not sit on the avatar',
          (await overlaps(page, '.debt .dnm', '.debt .dav')) === false);
  const widths = await page.evaluate(() => {
    const row = document.querySelector('.debt').getBoundingClientRect();
    const mid = document.querySelector('.debt .dmid').getBoundingClientRect();
    return { rowW: Math.round(row.width), midW: Math.round(mid.width), midH: Math.round(mid.height) };
  });
  s.check('the middle column takes the space left over', widths.midW > 0 && widths.midW < widths.rowW, widths);
  s.check('and has real height', widths.midH > 10, widths);

  s.section('2. the avatar keeps its shape outside a row');
  await page.evaluate(() => openDebt('d1'));
  await page.waitForTimeout(450);
  const av = await page.evaluate(() => {
    const el = document.querySelector('#sheet .dav');
    if (!el) return null;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return { w: Math.round(r.width), hgt: Math.round(r.height), radius: cs.borderTopLeftRadius,
             display: cs.display, colour: cs.color, weight: cs.fontWeight, text: el.textContent.trim() };
  });
  s.check('the sheet has an avatar', !!av, av);
  // .dav used to be styled only as ".debt .dav", so in the sheet it rendered
  // as a bare square with dark, top-left text spilling out of it.
  s.check('it is square', av && av.w === av.hgt, av);
  s.check('it is rounded', av && av.radius !== '0px', av && av.radius);
  s.check('its initials are centred', av && av.display === 'grid', av && av.display);
  s.check('its text is white', av && /255,\s*255,\s*255/.test(av.colour), av && av.colour);
  s.check('the initials are there', av && av.text.length > 0 && av.text.length <= 2, av && av.text);
  const fits = await page.evaluate(() => {
    const el = document.querySelector('#sheet .dav');
    return el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1;
  });
  s.check('nothing spills out of it', fits);
  s.check('the heading does not sit on the avatar',
          (await overlaps(page, '#sheet .dav', '#sheet .dav + div')) === false);

  s.section('3. the donut still works after the rename');
  await page.evaluate(() => { closeSheet(); view = 'report'; reportScope = 'house';
    S.expenses = [{ id: 'e1', desc: 'Rice', amount: 900, payer: S.members[0].id,
                    parts: S.members.map(m => m.id), date: Date.now() }];
    save(); drawView(); });
  await page.waitForTimeout(450);
  const mid = await page.evaluate(() => {
    const el = document.querySelector('#catDonut .dn-mid');
    if (!el) return null;
    return { position: getComputedStyle(el).position, amount: (el.querySelector('.dn-v') || {}).textContent || '' };
  });
  s.check('the centre label renders', !!mid);
  s.check('it is centred over the ring', !!mid && mid.position === 'absolute', mid);
  s.check('it shows an amount', !!mid && mid.amount.includes('900'), mid);

  s.section('4. no class is styled both bare and as a descendant by accident');
  // The shape that caused both faults above: a rule like `.dmid{...}` landing
  // on elements that only ever expected `.debt .dmid{...}`.
  const clash = await page.evaluate(() => {
    const bare = new Set(), scoped = new Set();
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
      for (const r of rules) {
        if (!r.selectorText) continue;
        for (const part of r.selectorText.split(',')) {
          const sel = part.trim();
          const m = /^\.([a-zA-Z][\w-]*)(:[\w-()]+)?$/.exec(sel);
          if (m) { bare.add(m[1]); continue; }
          for (const c of sel.matchAll(/\.([a-zA-Z][\w-]*)/g))
            if (sel.indexOf('.' + c[1]) > 0) scoped.add(c[1]);
        }
      }
    }
    // Known base-plus-modifier pairs, which are deliberate.
    const ok = new Set(['seg-ind', 'av', 'fab', 'tbar']);
    return [...bare].filter(c => scoped.has(c) && !ok.has(c));
  });
  s.check('no unexpected collisions', clash.length === 0, clash);

  await ctx.close();
  await b.close();
  s.finish();
})();
