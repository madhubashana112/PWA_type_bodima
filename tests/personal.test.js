/* Personal expenses: private to the device identity, and how they reach the
   report without disturbing the house's own figures. */
const h = require('./helpers/harness');
const fs = require('fs');

(async () => {
  const s = h.suite('personal');
  const b = await h.launch();
  const ctx = await h.context(b, { acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => s.countFailure('uncaught page error: ' + e.message));
  await page.goto(h.BASE + '/index.html', { waitUntil: 'load' });
  await h.install(page);
  await h.register(page, 'Rajawasala', 'pw', ['Madhubashana', 'Kamal', 'Sunil']);
  await h.settleIn(page);
  await page.evaluate(() => {
    const [a, b2, c] = S.members.map(m => m.id);
    const mk = (desc, amount, payer, daysAgo) => ({ id: 'x' + desc.replace(/\W/g, '') + daysAgo,
      desc, amount, payer, parts: S.members.map(m => m.id),
      date: Date.now() - daysAgo * 864e5, split: { mode: 'equal', values: {} } });
    S.expenses = [mk('Rice and curry', 1200, a, 1), mk('Wifi bill', 4500, c, 3),
                  mk('Gas cylinder', 3200, b2, 5), mk('Tea', 600, a, 2)];
    save(); view = 'report'; reportPeriod = 'month'; reportScope = 'house'; drawView();
  });
  await page.waitForTimeout(400);
  const houseTotalBefore = await page.evaluate(() => periodExpenses('month').reduce((t, e) => t + e.amount, 0));

  s.section('1. adding one through the UI');
  await page.click('#repScope button:nth-child(2)');
  await page.waitForTimeout(350);
  s.check('the Mine view is showing', await page.evaluate(() => reportScope === 'mine'));
  await page.click('.sec-title .link');
  await page.waitForTimeout(450);
  await page.fill('#p_desc', 'Haircut');
  await page.fill('#p_amt', '800');
  await page.click('#sheet .addbtn.coral');
  await page.waitForTimeout(600);
  s.check('it is recorded', (await page.evaluate(() => myPersonal().length)) === 1);
  s.check('the amount stuck', (await page.evaluate(() => myPersonal()[0].amount)) === 800);

  s.section('2. it never leaves the device');
  s.check('not in the house state', !(await page.evaluate(() => JSON.stringify(S).includes('Haircut'))));
  s.check('not in the database', !(await page.evaluate(() => JSON.stringify(window.__store).includes('Haircut'))));
  s.check('held in its own private key',
          await page.evaluate(() => !!JSON.parse(localStorage.getItem('bodime_personal_v1'))[privateOwner()]));
  // A later sync must not wipe it either.
  await page.evaluate(() => { S.members.push({ id: 'zz', name: 'Late', color: '#16A074' }); save(); });
  await page.waitForTimeout(300);
  s.check('a sync does not disturb it', (await page.evaluate(() => myPersonal().length)) === 1);
  await page.evaluate(() => { S.members = S.members.filter(m => m.id !== 'zz'); save(); drawView(); });
  await page.waitForTimeout(300);

  s.section('3. it belongs to one identity, not the phone');
  const otherSees = await page.evaluate(() => {
    const meWas = getMeId();
    setMeId(S.members[1].id);
    const n = myPersonal().length;
    setMeId(meWas);
    return n;
  });
  s.check('another housemate on this phone sees none of it', otherSees === 0, otherSees);
  s.check('and mine is still there', (await page.evaluate(() => myPersonal().length)) === 1);

  s.section('4. the house figures are untouched');
  await page.click('#repScope button:nth-child(1)');
  await page.waitForTimeout(400);
  const houseNow = await page.evaluate(() => periodExpenses('month').reduce((t, e) => t + e.amount, 0));
  s.check('house total unchanged', houseNow === houseTotalBefore, [houseNow, houseTotalBefore]);
  s.check('the House view shows it', (await page.textContent('.stats .stat .v')).includes(String(houseNow).slice(0, 1)));
  s.check('no personal row in the house donut',
          !(await page.textContent('#catDonut')).includes('Haircut'));

  s.section('5. Mine adds my share and my own together');
  await page.click('#repScope button:nth-child(2)');
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => ({
    total: mineAsExpenses('month').reduce((t, e) => t + e.amount, 0),
    share: myShareOf(periodExpenses('month')),
    pers: personalTotal('month'),
    shown: document.querySelector('.stats .stat .v').textContent
  }));
  s.check('total = share + personal', m.total === m.share + m.pers, m);
  s.check('and that is what the tile shows', m.shown.includes(m.total.toLocaleString('en-US')), m);
  s.check('my share is less than the house total', m.share < houseNow, [m.share, houseNow]);

  s.section('6. the donut and trend follow the scope');
  const inDonut = await page.evaluate(() =>
    spendByCategory(mineAsExpenses('month')).reduce((t, x) => t + x.value, 0));
  s.check('the donut totals my spending', inDonut === m.total, [inDonut, m.total]);
  s.check('a personal entry is categorised like any other',
          await page.evaluate(() => categoryOf('Haircut').key === 'other'));
  const tr = await page.evaluate(() => mineTrend(true).reduce((t, d) => t + d.val, 0));
  s.check('the trend counts something', tr > 0, tr);
  // Personal spending is mine alone and is in no house figure, so the bar can
  // stand taller than the house's in a week where only I spent. Take it off
  // and what is left is my share, which never can.
  s.check('my share of it never exceeds the house trend',
          await page.evaluate(() => {
            const cw = startOfWeek(Date.now()), span = 7 * 86400000, house = weekTrend();
            return mineTrend(true).every((d, i) => {
              const from = cw - (5 - i) * span, to = from + span;
              const pers = myPersonal().filter(x => x.date >= from && x.date < to)
                                       .reduce((t, x) => t + Math.round(x.amount || 0), 0);
              return d.val - pers <= house[i].val;
            });
          }));

  s.section('7. the budget counts personal spending');
  await page.evaluate(() => setMyBudget(10000));
  await page.waitForTimeout(150);
  const budgetSpent = await page.evaluate(() => {
    const meId = getMeId();
    return Math.round(consumedByMember(periodExpenses('month'), S.members)[meId] || 0) + personalTotal('month');
  });
  s.check('budget spend includes the haircut', budgetSpent === m.share + m.pers, [budgetSpent, m]);
  await page.evaluate(() => { drawView(); });
  await page.waitForTimeout(300);
  s.check('the budget card renders that number',
          (await page.textContent('.budget')).includes(budgetSpent.toLocaleString('en-US')),
          await page.textContent('.budget'));
  await page.evaluate(() => setMyBudget(0));

  s.section('8. a weekly budget is a separate target, not the monthly one');
  await page.evaluate(() => { setMyBudget(4000, 'week'); setMyBudget(20000); });
  await page.waitForTimeout(150);
  s.check('the weekly target is its own number', await page.evaluate(() => myBudget('week')) === 4000);
  s.check('setting it left the monthly one alone', await page.evaluate(() => myBudget()) === 20000);
  await page.evaluate(() => { reportPeriod = 'week'; drawView(); });
  await page.waitForTimeout(300);
  const wkSpent = await page.evaluate(() => {
    const meId = getMeId();
    return Math.round(consumedByMember(periodExpenses('week'), S.members)[meId] || 0) + personalTotal('week');
  });
  s.check('the card switches to the weekly figure when Week is selected',
          (await page.textContent('.budget')).includes(wkSpent.toLocaleString('en-US')) &&
          (await page.textContent('.budget')).includes((4000).toLocaleString('en-US')),
          await page.textContent('.budget'));
  await page.evaluate(() => { reportPeriod = 'month'; drawView(); });
  await page.waitForTimeout(300);
  s.check('and back to the monthly one when Month is selected again',
          (await page.textContent('.budget')).includes((20000).toLocaleString('en-US')),
          await page.textContent('.budget'));
  await page.evaluate(() => { setMyBudget(0); setMyBudget(0, 'week'); });

  s.section('9. editing and deleting');
  await page.evaluate(() => { drawView(); });
  await page.waitForTimeout(300);
  await page.click('.exp');
  await page.waitForTimeout(450);
  await page.fill('#p_amt', '950');
  await page.click('#sheet .addbtn.coral');
  await page.waitForTimeout(600);
  s.check('the edit took', (await page.evaluate(() => myPersonal()[0].amount)) === 950);
  s.check('still one entry', (await page.evaluate(() => myPersonal().length)) === 1);
  await page.evaluate(() => { setMyPersonal([]); drawView(); });
  await page.waitForTimeout(300);
  s.check('with none left the empty state shows',
          (await page.textContent('.stg')).toLowerCase().includes('no personal expenses'));
  await page.evaluate(() => { setMyPersonal([{ id: 'p1', desc: 'Haircut', amount: 800, date: Date.now() }]); drawView(); });
  await page.waitForTimeout(300);

  s.section('10. Mine needs an identity, and says so by falling back');
  await page.evaluate(() => { setMeId(null); reportScope = 'mine'; drawView(); });
  await page.waitForTimeout(350);
  s.check('it drops back to House rather than showing nothing',
          await page.evaluate(() => reportScope === 'house'));
  await page.evaluate(() => { setMeId(S.members[0].id); reportScope = 'mine'; drawView(); });
  await page.waitForTimeout(350);

  s.section('11. the backup carries them, so a reinstall does not lose them');
  await page.evaluate(() => { setMyBudget(15000); setMyBudget(3500, 'week'); });
  const dl = page.waitForEvent('download', { timeout: 8000 });
  await page.evaluate(() => exportBackup());
  const file = JSON.parse(fs.readFileSync(await (await dl).path(), 'utf8'));
  s.check('personal entries are in the backup', Array.isArray(file.personal) && file.personal.length === 1, file.personal);
  s.check('still no plaintext password in it', file.pass === undefined && !!file.passHash);
  s.check('both budgets are in the backup', file.budget === 15000 && file.budgetWeek === 3500, file);
  const restored = await page.evaluate(f => {
    setMyPersonal([]);                       // simulate a wiped device
    setMyBudget(0); setMyBudget(0, 'week');
    if (Array.isArray(f.personal)) setMyPersonal(f.personal);
    if (f.budget) setMyBudget(f.budget);
    if (f.budgetWeek) setMyBudget(f.budgetWeek, 'week');
    return { personal: myPersonal().length, month: myBudget(), week: myBudget('week') };
  }, file);
  s.check('and restore brings them back', restored.personal === 1, restored);
  s.check('both budgets are restored too', restored.month === 15000 && restored.week === 3500, restored);
  await page.evaluate(() => { setMyBudget(0); setMyBudget(0, 'week'); });

  s.section('12. the CSV follows the scope');
  const mineCsv = await page.evaluate(() => buildMineCsv('month'));
  const lines = mineCsv.split('\r\n');
  s.check('it names the kind of each row', lines[0].includes('Kind'), lines[0]);
  s.check('the personal row is marked', lines.some(l => l.includes('Haircut') && l.includes('Personal')),
          lines.find(l => l.includes('Haircut')));
  s.check('house rows are marked as my share',
          lines.some(l => l.includes('Wifi') && l.includes('My share')));
  const csvTotal = Number(lines[lines.length - 1].split(',')[2]);
  s.check('the CSV total matches the tile', csvTotal === await page.evaluate(() =>
          mineAsExpenses('month').reduce((t, e) => t + e.amount, 0)), csvTotal);

  await ctx.close();
  await b.close();
  s.finish();
})();
