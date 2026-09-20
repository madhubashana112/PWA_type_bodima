/* Monthly rules: the date maths, catching up, and not duplicating. */
const h = require('./helpers/harness');

(async () => {
  const s = h.suite('recurring');
  const b = await h.launch();

  async function house() {
    const r = await h.open(b, s);
    await h.register(r.page, 'Recur House', 'pw', ['Nimal', 'Kamal']);
    await h.settleIn(r.page);
    return r;
  }

  s.section('1. the date maths');
  {
    const { ctx, page } = await house();
    const r = await page.evaluate(() => ({
      key: ymKey(new Date(2026, 0, 15).getTime()),
      next: ymAdd('2026-01', 1),
      wrap: ymAdd('2026-12', 1),
      back: ymAdd('2026-01', -1),
      feb31: new Date(recurDate('2026-02', 31)).getDate(),
      febMonth: new Date(recurDate('2026-02', 31)).getMonth(),
      leap: new Date(recurDate('2028-02', 31)).getDate(),
      apr31: new Date(recurDate('2026-04', 31)).getDate(),
      normal: new Date(recurDate('2026-03', 15)).getDate()
    }));
    s.check('month key', r.key === '2026-01', r);
    s.check('next month', r.next === '2026-02', r);
    s.check('wraps the year', r.wrap === '2027-01', r);
    s.check('goes back a year', r.back === '2025-12', r);
    s.check('the 31st clamps to 28 in February', r.feb31 === 28, r);
    s.check('and stays inside February', r.febMonth === 1, r);
    s.check('29 in a leap year', r.leap === 29, r);
    s.check('30 in a 30-day month', r.apr31 === 30, r);
    s.check('an ordinary day is untouched', r.normal === 15, r);
    await ctx.close();
  }

  const { ctx, page } = await house();

  s.section('2. a rule is made from an expense, without duplicating it');
  await page.evaluate(() => openExpense());
  await page.waitForTimeout(400);
  await page.fill('#e_desc', 'Rent');
  await page.fill('#e_amt', '15000');
  await page.click('#e_recur');
  await page.waitForTimeout(150);
  s.check('the toggle reads as on', await page.evaluate(() => document.getElementById('e_recur').classList.contains('on')));
  await page.click('#sheet .addbtn.coral');
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => ({ exp: S.expenses.length, rules: S.recurring.length,
    linked: S.expenses[0].ruleId === S.recurring[0].id, lastYm: S.recurring[0].lastYm,
    nowYm: ymKey(Date.now()) }));
  s.check('one expense', st.exp === 1, st);
  s.check('one rule', st.rules === 1, st);
  s.check('the expense is linked to it', st.linked, st);
  s.check('the rule starts this month, so today is not re-added', st.lastYm === st.nowYm, st);

  s.section('3. catching up makes one expense per month missed');
  const made = await page.evaluate(() => { S.recurring[0].lastYm = ymAdd(ymKey(Date.now()), -3); return rollRecurring(); });
  s.check('three months, three expenses', made === 3, made);
  s.check('four in total now', (await page.evaluate(() => S.expenses.length)) === 4);
  s.check('the rule is up to date', await page.evaluate(() => S.recurring[0].lastYm === ymKey(Date.now())));
  const amounts = await page.evaluate(() => S.expenses.filter(e => e.ruleId).map(e => e.amount));
  s.check('each copy carries the rule amount', amounts.every(a => a === 15000), amounts);

  s.section('4. running it again changes nothing');
  s.check('nothing new', (await page.evaluate(() => rollRecurring())) === 0);
  s.check('still four', (await page.evaluate(() => S.expenses.length)) === 4);

  s.section('5. two devices catching up the same month converge');
  const dupes = await page.evaluate(() => {
    S.recurring[0].lastYm = ymAdd(ymKey(Date.now()), -1); rollRecurring();   // other device
    S.recurring[0].lastYm = ymAdd(ymKey(Date.now()), -1); rollRecurring();   // this one
    const ids = S.expenses.map(e => e.id);
    return ids.length - new Set(ids).size;
  });
  s.check('no duplicate ids', dupes === 0, dupes);

  s.section('6. closing the month keeps the series alive');
  const before = await page.evaluate(() => S.recurring.length);
  await page.evaluate(() => {
    S.archives.unshift({ id: 'a1', label: 'x', closedAt: Date.now(),
      total: S.expenses.reduce((t, e) => t + e.amount, 0),
      members: S.members.slice(), expenses: S.expenses.slice(), settles: [] });
    S.expenses = []; S.settles = []; save();
  });
  s.check('the rule survived the close', (await page.evaluate(() => S.recurring.length)) === before);
  // Months -5..-3 were never generated; -2..0 are in the archive just made.
  const after = await page.evaluate(() => { S.recurring[0].lastYm = ymAdd(ymKey(Date.now()), -6); return rollRecurring(); });
  s.check('it still produces the months it missed', after === 3, after);
  s.check('and does not re-add the archived ones', (await page.evaluate(() => S.expenses.length)) === 3);

  s.section('7. a rule whose payer is gone pauses instead of guessing');
  await page.evaluate(() => { S.recurring[0].payer = 'ghost'; S.recurring[0].lastYm = ymAdd(ymKey(Date.now()), -1); });
  s.check('nothing produced', (await page.evaluate(() => rollRecurring())) === 0);
  s.check('reported as unusable', !(await page.evaluate(() => recurUsable(S.recurring[0]))));

  s.section('8. turning the toggle off drops the rule, keeps the expense');
  await page.evaluate(() => {
    S.recurring[0].payer = S.members[0].id;
    S.expenses = [{ id: 'keep1', desc: 'Rent', amount: 15000, payer: S.members[0].id,
      parts: S.members.map(m => m.id), date: Date.now(), ruleId: S.recurring[0].id }];
    save(); drawView();
  });
  await page.evaluate(() => openExpense('keep1'));
  await page.waitForTimeout(400);
  s.check('the toggle reflects the rule', await page.evaluate(() => document.getElementById('e_recur').classList.contains('on')));
  await page.click('#e_recur');
  await page.click('#sheet .addbtn.coral');
  await page.waitForTimeout(500);
  s.check('rule gone', (await page.evaluate(() => S.recurring.length)) === 0);
  s.check('expense kept', (await page.evaluate(() => S.expenses.length)) === 1);
  s.check('the link is cleared', await page.evaluate(() => !S.expenses[0].ruleId));

  s.section('9. rules reach the rest of the house');
  await page.evaluate(() => {
    S.recurring = [{ id: 'rule1', createdAt: Date.now(), desc: 'Wifi', amount: 3000,
      payer: S.members[0].id, parts: S.members.map(m => m.id), split: null, day: 5,
      lastYm: ymKey(Date.now()) }];
    save();
  });
  await page.waitForTimeout(300);
  s.check('written to the database', await page.evaluate(() => {
    const k = Object.keys(window.__store.h)[0]; return !!window.__store.h[k].recurring.rule1; }));

  await ctx.close();
  await b.close();
  s.finish();
})();
