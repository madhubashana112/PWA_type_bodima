/* Searching and filtering the expense history. */
const h = require('./helpers/harness');
const DAY = 864e5;

(async () => {
  const s = h.suite('history');
  const b = await h.launch();
  const { ctx, page } = await h.open(b, s);
  await h.register(page, 'Feat House', 'pw', ['Nimal', 'Kamal', 'Sunil']);
  await h.settleIn(page);
  await page.evaluate(d => {
    const [a, b2, c] = S.members.map(m => m.id);
    const mk = (desc, amount, payer, parts, daysAgo) => ({
      id: 'x' + desc.replace(/\W/g, '') + daysAgo, desc, amount, payer, parts,
      date: Date.now() - daysAgo * d, split: { mode: 'equal', values: {} } });
    S.expenses = [
      mk('Rice and curry', 1200, a, [a, b2, c], 1),
      mk('Bus fare', 300, b2, [b2, c], 3),
      mk('Wifi bill', 4500, c, [a, b2, c], 10),
      mk('Soap', 450, a, [a, b2], 40),
      mk('Old dinner', 900, b2, [a, b2], 75)
    ];
    save(); drawView();
  }, DAY);
  await page.waitForTimeout(300);
  const rows = () => page.$$eval('#histList .exp', es => es.length);

  s.section('1. everything is listed by default');
  await page.click('#n-hist');
  await page.waitForTimeout(300);
  s.check('all five expenses', (await rows()) === 5, await rows());
  s.check('the count is shown', (await page.textContent('#histCount')).includes('5'));
  s.check('the filtered total is footed', (await page.textContent('#histList')).includes('7,350'));

  s.section('2. searching narrows by description');
  await page.fill('#histQ', 'wifi');
  await page.waitForTimeout(250);
  s.check('one match', (await rows()) === 1, await rows());
  s.check('it is the wifi bill', (await page.textContent('#histList')).toLowerCase().includes('wifi'));
  s.check('the count shows the subset', (await page.textContent('#histCount')).includes('1/5'));
  // Re-rendering the whole view here would drop the keyboard mid-word.
  s.check('the search box keeps focus while typing',
          await page.evaluate(() => document.activeElement.id === 'histQ'));

  s.section('3. search also matches the payer, and amounts exactly');
  await page.fill('#histQ', 'kamal');
  await page.waitForTimeout(250);
  s.check('what Kamal paid', (await rows()) === 2, await rows());
  await page.fill('#histQ', '450');
  await page.waitForTimeout(250);
  s.check('450 finds only the 450', (await rows()) === 1, await rows());
  await page.fill('#histQ', '4500');
  await page.waitForTimeout(250);
  s.check('4500 is its own match', (await rows()) === 1, await rows());
  s.check('and it is the wifi bill', (await page.textContent('#histList')).toLowerCase().includes('wifi'));

  s.section('4. nothing found is explained, and recoverable');
  await page.fill('#histQ', 'zzzzz');
  await page.waitForTimeout(250);
  s.check('no rows', (await rows()) === 0);
  s.check('it says nothing matches', (await page.textContent('#histList')).toLowerCase().includes('nothing matches'));
  await page.click('#histList button');
  await page.waitForTimeout(300);
  s.check('clearing brings everything back', (await rows()) === 5, await rows());

  s.section('5. the period filter');
  await page.click('#histChips button[data-period="week"]');
  await page.waitForTimeout(250);
  s.check('the last 7 days keeps two', (await rows()) === 2, await rows());
  await page.click('#histChips button[data-period="month"]');
  await page.waitForTimeout(250);
  const inMonth = await page.evaluate(() => S.expenses.filter(e => e.date >= startOfMonth(Date.now())).length);
  s.check('this month matches the data', (await rows()) === inMonth, [await rows(), inMonth]);
  await page.click('#histChips button[data-period="all"]');
  await page.waitForTimeout(250);

  s.section('6. the person filter, and filters combining');
  const sunil = await page.evaluate(() => S.members.find(m => m.name === 'Sunil').id);
  await page.selectOption('#histWho', sunil);
  await page.waitForTimeout(250);
  s.check('only what Sunil is part of', (await rows()) === 3, await rows());
  await page.fill('#histQ', 'bus');
  await page.waitForTimeout(250);
  s.check('person and search together', (await rows()) === 1, await rows());

  s.section('7. how someone browses is never shared');
  const store = await page.evaluate(() => JSON.stringify(window.__store));
  s.check('no filter state in the database', !store.includes('histQ') && !store.includes('"period"'));
  s.check('none saved locally either',
          !(await page.evaluate(() => localStorage.getItem('bodime_data_v2'))).includes('"period"'));

  await ctx.close();
  await b.close();
  s.finish();
})();
