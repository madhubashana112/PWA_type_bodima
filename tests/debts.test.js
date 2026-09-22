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

  s.section('5. picking who a debt belongs to, rather than guessing from identity');
  // The bug this repairs: a debt added on a device with no identity chosen
  // baked the localised word for "someone" into ownerName forever, and no
  // amount of setting up identity afterwards could ever fix it because
  // debtOwnerName trusted whatever was stored over a live member lookup.
  await page.evaluate(() => {
    S.debts.push({ id: 'ghost1', owner: 'nobody', ownerName: 'Someone',
                   person: 'Shaminda', total: 5000, reason: '', date: Date.now(),
                   due: null, payments: [] });
    save(); drawView();
  });
  await page.waitForTimeout(300);
  s.check('an unresolvable owner still shows the placeholder, not a wrong name',
          await page.evaluate(() => debtOwnerName(debtById('ghost1'))) === 'Someone');

  await page.evaluate(() => openDebtForm('ghost1'));
  await page.waitForTimeout(400);
  s.check('the picker is there', await page.evaluate(() => document.querySelectorAll('#d_owner .payer').length) === 2);
  s.check('an unresolvable owner starts with nobody selected',
          await page.evaluate(() => !document.querySelector('#d_owner .payer.on')));
  const fixTo = await page.evaluate(() => S.members[1].id);
  await page.evaluate(id => { debtDraft.owner = id; renderDebtOwner(); }, fixTo);
  await page.click('#sheet .addbtn.coral');
  await page.waitForTimeout(400);
  s.check('the real name replaces the placeholder',
          await page.evaluate(() => debtOwnerName(debtById('ghost1'))) === await page.evaluate(id => S.members.find(m => m.id === id).name, fixTo));
  s.check('the owner id was actually reassigned, not just the label',
          (await page.evaluate(() => debtById('ghost1').owner)) === fixTo);

  s.section('6. a new debt defaults to whoever this device is, and that is pickable');
  await page.evaluate(() => setMeId(S.members[0].id));
  await page.evaluate(() => openDebtForm());
  await page.waitForTimeout(400);
  s.check('it defaults to the current identity',
          await page.evaluate(id => debtDraft.owner === id, await page.evaluate(() => S.members[0].id)));
  const otherId = await page.evaluate(() => S.members[1].id);
  await page.evaluate(id => { debtDraft.owner = id; renderDebtOwner(); }, otherId);
  await page.fill('#d_person', 'Landlord');
  await page.fill('#d_total', '750');
  await page.click('#sheet .addbtn.coral');
  await page.waitForTimeout(400);
  const created = await page.evaluate(() => allDebts().find(d => d.person === 'Landlord'));
  s.check('the debt is owned by whoever was picked, not just the device identity',
          created && created.owner === otherId, created);
  s.check('and that name is what shows',
          created && created.ownerName === (await page.evaluate(id => S.members.find(m => m.id === id).name, otherId)));

  s.section('7. reachable from Home as a compact tile, not from the top bar');
  // otherId owns every debt in this suite by now.
  await page.evaluate(id => { setMeId(id); view = 'home'; drawView(); }, otherId);
  await page.waitForTimeout(350);
  s.check('no icon for it in the top bar',
          !(await page.evaluate(() => Array.from(document.querySelectorAll('.tools .icbtn')).some(b => b.textContent.includes('💳')))));
  const tileInfo = await page.evaluate(() => {
    const kids = Array.from(document.querySelector('.stg').children);
    const statsIdx = kids.findIndex(el => el.classList.contains('stats'));
    const reportIdx = kids.findIndex(el => el.classList.contains('reportbtn'));
    const tile = Array.from(document.querySelectorAll('.stats .stat')).find(el => el.textContent.includes('💳'));
    return { statsIdx, reportIdx, tileText: tile ? tile.textContent : null };
  });
  s.check('it sits in the stats grid, above Report', tileInfo.tileText !== null && tileInfo.statsIdx < tileInfo.reportIdx, tileInfo);
  s.check('it names Money I Owe', /Money I Owe|ණයයි/.test(tileInfo.tileText), tileInfo.tileText);
  const oweColour = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('.stats .stat')).find(x => x.textContent.includes('💳'));
    return el ? getComputedStyle(el).backgroundImage : '';
  });
  s.check('it stands out in blue, not the plain white the other tiles use',
          oweColour.includes('gradient') && /45,\s*152,\s*218/.test(oweColour), oweColour);
  await page.evaluate(() => Array.from(document.querySelectorAll('.stats .stat')).find(el => el.textContent.includes('💳')).click());
  await page.waitForTimeout(300);
  s.check('tapping it opens the debts list', await page.evaluate(() => view === 'debts'));

  s.section('8. still there with nothing owed — the only way in, since the icon is gone');
  const meWithNone = await page.evaluate(() => S.members[0].id);   // owns none of the debts above
  await page.evaluate(id => { setMeId(id); view = 'home'; drawView(); }, meWithNone);
  await page.waitForTimeout(350);
  const oweTileText = await page.evaluate(() =>
    (Array.from(document.querySelectorAll('.stats .stat')).find(el => el.textContent.includes('💳')) || {}).textContent || '');
  s.check('the tile is still on the screen', oweTileText !== '', oweTileText);
  s.check('it reads Rs.0 rather than disappearing', /0/.test(oweTileText), oweTileText);
  await page.evaluate(() => Array.from(document.querySelectorAll('.stats .stat')).find(el => el.textContent.includes('💳')).click());
  await page.waitForTimeout(300);
  s.check('and it still opens the debts screen', await page.evaluate(() => view === 'debts'));
  await page.click('.smode button:nth-child(2)');   // "Just me" — this identity owns none
  await page.waitForTimeout(300);
  s.check('filtered to mine, it is properly empty rather than crashing',
          await page.evaluate(() => !!document.querySelector('.empty')));

  await ctx.close();
  await b.close();
  s.finish();
})();
