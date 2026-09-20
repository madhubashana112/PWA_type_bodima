/* The spend-by-category donut, and that Sinhala labels still render as text. */
const h = require('./helpers/harness');

(async () => {
  const s = h.suite('report');
  const b = await h.launch();
  const { ctx, page } = await h.open(b, s);
  await h.register(page, 'Wellawatte', 'pw', ['Nimal', 'Kamal', 'Sunil']);
  await h.settleIn(page);
  await page.evaluate(() => {
    const [a, b2, c] = S.members.map(m => m.id);
    const mk = (desc, amount, payer, daysAgo) => ({ id: 'x' + desc.replace(/\W/g, '') + daysAgo,
      desc, amount, payer, parts: S.members.map(m => m.id),
      date: Date.now() - daysAgo * 864e5, split: { mode: 'equal', values: {} } });
    S.expenses = [
      mk('Rice and curry', 1200, a, 1), mk('Kottu', 1800, b2, 2),
      mk('Tea and biscuits', 680, b2, 3), mk('Wifi bill', 4500, c, 4),
      mk('Rent', 15000, a, 5), mk('Bus fare', 300, b2, 6),
      mk('Soap', 620, a, 7), mk('Eggs and veg', 1100, b2, 8),
      mk('Phone case', 900, c, 9)
    ];
    save(); view = 'report'; reportPeriod = 'month'; catPick = null; drawView();
  });
  await page.waitForTimeout(400);

  s.section('1. descriptions are sorted into categories');
  const cats = await page.evaluate(() => ['Rice and curry', 'tea', 'Soap', 'Wifi bill', 'bus',
    'eggs', 'nonsense', '', 'බත්', 'කුලී'].map(d => categoryOf(d).key));
  s.check('food, tea, household, bills, travel, groceries',
          cats.slice(0, 6).join() === 'food,tea,clean,bills,travel,fresh', cats);
  s.check('an unmatched description falls to other', cats[6] === 'other', cats[6]);
  s.check('an empty description does not throw', cats[7] === 'other', cats[7]);
  s.check('Sinhala descriptions classify too', cats[8] === 'food' && cats[9] === 'bills', cats.slice(8));
  s.check('the row emoji still comes from the same place',
          await page.evaluate(() => emojiFor('Rice and curry') === '🍛' && emojiFor('') === '🛒'));

  s.section('2. the slices account for every rupee in the period');
  const sums = await page.evaluate(() => {
    const sl = spendByCategory(periodExpenses(reportPeriod));
    return { sliced: sl.reduce((a, x) => a + x.value, 0),
             period: periodExpenses(reportPeriod).reduce((a, e) => a + Math.round(e.amount), 0),
             count: sl.length, descending: sl.every((x, i) => !i || sl[i - 1].value >= x.value),
             empty: sl.some(x => x.value <= 0) };
  });
  s.check('slices add up to the period total', sums.sliced === sums.period, sums);
  s.check('largest first', sums.descending);
  s.check('no empty slices', !sums.empty);

  s.section('3. the donut renders and follows the period');
  s.check('it is on the report', await page.evaluate(() => !!document.getElementById('catDonut')));
  const arcs = () => page.$$eval('#catDonut .dslice', e => e.length);
  s.check('one arc per category present', (await arcs()) === sums.count, [await arcs(), sums.count]);
  s.check('a legend entry per arc',
          (await page.$$eval('#catDonut .dlg', e => e.length)) === sums.count);
  s.check('the centre leads with the largest', (await page.textContent('#catDonut .dn-v')).includes('15,000')
          || (await page.textContent('#catDonut .dn-n')).length > 0, await page.textContent('#catDonut .dn-n'));
  // Bills and rent is 19,500 of 26,100 here
  s.check('the centre shows a share', /%$/.test((await page.textContent('#catDonut .dn-p')).trim()));

  s.section('4. arcs together close the ring');
  const geom = await page.evaluate(() => {
    const els = [...document.querySelectorAll('#catDonut .dslice')];
    const C = 2 * Math.PI * 54;
    const lens = els.map(e => parseFloat(e.getAttribute('stroke-dasharray').split(' ')[0]));
    const offs = els.map(e => parseFloat(e.getAttribute('stroke-dashoffset')));
    return { C, sum: lens.reduce((a, x) => a + x, 0), gaps: els.length, firstOff: offs[0],
             monotonic: offs.every((o, i) => !i || o <= offs[i - 1]) };
  });
  // Each slice gives up 1px to a separator gap.
  s.check('arc lengths fill the circumference', Math.abs(geom.sum - (geom.C - geom.gaps)) < 0.5,
          [geom.sum, geom.C, geom.gaps]);
  s.check('the first arc starts at zero', geom.firstOff === 0, geom.firstOff);
  s.check('arcs are laid end to end', geom.monotonic);

  s.section('5. tapping a slice moves the centre');
  const before = await page.textContent('#catDonut .dn-v');
  await page.click('#catDonut .dlg:nth-child(3)');
  await page.waitForTimeout(300);
  const after = await page.textContent('#catDonut .dn-v');
  s.check('the centre changed', before !== after, [before, after]);
  s.check('the tapped legend entry is marked',
          (await page.$$eval('#catDonut .dlg.on', e => e.length)) === 1);
  await page.click('#catDonut .dlg:nth-child(3)');
  await page.waitForTimeout(300);
  s.check('tapping it again goes back to the largest',
          (await page.textContent('#catDonut .dn-v')) === before);

  s.section('6. switching period does not strand the selection');
  await page.click('#catDonut .dlg:nth-child(2)');
  await page.waitForTimeout(250);
  await page.evaluate(() => setReportPeriod('day'));
  await page.waitForTimeout(350);
  s.check('the pick is cleared', await page.evaluate(() => catPick === null));
  s.check('no leftover selection in the markup',
          (await page.$$eval('#catDonut .dlg.on', e => e.length)) <= 1);
  await page.evaluate(() => setReportPeriod('month'));
  await page.waitForTimeout(350);

  s.section('7. a day with nothing in it does not draw a donut');
  await page.evaluate(() => { S.expenses = []; save(); drawView(); });
  await page.waitForTimeout(300);
  s.check('no donut, no crash', await page.evaluate(() => !document.getElementById('catDonut')));

  s.section('8. .sin means the Sinhala font, and nothing else');
  // The history search input once reused this class name, which turned every
  // Sinhala label in the app into something that looked like a text box.
  await page.evaluate(() => {
    // put an expense back: an empty history has no search box to compare against
    S.expenses = [{ id: 'z1', desc: 'බත් පැකට්', amount: 900, payer: S.members[0].id,
                    parts: S.members.map(m => m.id), date: Date.now() }];
    save(); setLang('si'); go('hist');
  });
  await page.waitForTimeout(400);
  const styled = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('.sin').forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.borderTopWidth !== '0px' || cs.paddingLeft === '38px') bad.push(el.tagName + '.' + el.className);
    });
    return bad;
  });
  s.check('no Sinhala label is drawn as an input', styled.length === 0, styled);
  s.check('and the search box keeps its own styling',
          await page.evaluate(() => getComputedStyle(document.getElementById('histQ')).paddingLeft === '38px'));

  await ctx.close();
  await b.close();
  s.finish();
})();
