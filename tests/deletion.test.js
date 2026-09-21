/* Deletions must stick. Two devices with a shared database: one goes offline,
   the other deletes, and the offline one comes back. The stores are shuttled
   by hand because each browser context has its own stub. */
const h = require('./helpers/harness');

async function device(b, s, store) {
  const ctx = await h.context(b);
  const page = await ctx.newPage();
  page.on('pageerror', e => s.countFailure('uncaught page error: ' + e.message));
  await page.goto(h.BASE + '/index.html', { waitUntil: 'load' });
  await h.install(page, store);
  return { ctx, page };
}
const put = (page, store) => page.evaluate(st => { window.__store = st; }, store);
const ids = page => page.evaluate(() => S.expenses.map(e => e.id).sort().join());
const cloudIds = page => page.evaluate(() => {
  const k = Object.keys(window.__store.h || {})[0];
  return k ? Object.keys(window.__store.h[k].expenses || {}).sort().join() : '(no house)';
});

(async () => {
  const s = h.suite('deletion');
  const b = await h.launch();

  const A = await device(b, s);
  await h.register(A.page, 'Rajawasala', 'pw', ['Madhubashana', 'Achintha']);
  await h.settleIn(A.page);
  await A.page.evaluate(() => {
    const m = S.members.map(x => x.id);
    S.expenses = [
      { id: 'e1', desc: 'Sliit', amount: 440, payer: m[0], parts: m, date: Date.now() },
      { id: 'e2', desc: 'Breakfast', amount: 600, payer: m[1], parts: m, date: Date.now() },
      { id: 'e3', desc: 'Dinner', amount: 900, payer: m[0], parts: m, date: Date.now() }];
    save();
  });
  await A.page.waitForTimeout(400);

  const B = await device(b, s, await h.dump(A.page));
  await h.login(B.page, 'Rajawasala', 'pw');
  await B.page.waitForTimeout(500);

  s.section('1. both devices start level');
  s.check('A has three', (await ids(A.page)) === 'e1,e2,e3', await ids(A.page));
  s.check('B has three', (await ids(B.page)) === 'e1,e2,e3', await ids(B.page));

  s.section('2. B goes offline, A deletes one');
  await B.page.evaluate(() => detachCloud());
  await A.page.evaluate(() => { S.expenses = S.expenses.filter(e => e.id !== 'e2'); save(); });
  await A.page.waitForTimeout(400);
  s.check('A has two', (await ids(A.page)) === 'e1,e3', await ids(A.page));
  s.check('the database has two', (await cloudIds(A.page)) === 'e1,e3', await cloudIds(A.page));

  s.section('3. B reconnects — the deletion has to survive');
  await put(B.page, await h.dump(A.page));
  await B.page.evaluate(() => { syncTried = true; tryReconnect(true); });
  await B.page.waitForTimeout(1500);
  s.check('B does not bring it back locally', (await ids(B.page)) === 'e1,e3', await ids(B.page));
  s.check('B does not re-upload it', (await cloudIds(B.page)) === 'e1,e3', await cloudIds(B.page));

  s.section('4. and A does not see it return');
  await put(A.page, await h.dump(B.page));
  await A.page.evaluate(() => { detachCloud(); syncTried = true; tryReconnect(true); });
  await A.page.waitForTimeout(1200);
  s.check('A still has two', (await ids(A.page)) === 'e1,e3', await ids(A.page));
  s.check('the database still has two', (await cloudIds(A.page)) === 'e1,e3', await cloudIds(A.page));

  s.section('5. a deletion marker is what makes it stick');
  {
    const t = await A.page.evaluate(() => Object.keys((S.tombs || {}).expenses || {}));
    s.check('a marker was recorded for the deleted expense', t.includes('e2'), t);
    s.check('and it reached the database', await A.page.evaluate(() => {
      const k = Object.keys(window.__store.h)[0];
      return !!((window.__store.h[k].tombs || {}).expenses || {}).e2;
    }));
    s.check('markers are not left for records that still exist',
            !t.includes('e1') && !t.includes('e3'), t);
    // A key cannot contain a slash, so the markers have to nest by collection
    // — a flat "expenses/e2" key is rejected by the database outright.
    s.check('the markers are shaped as the database will take them',
            await A.page.evaluate(() => {
              const k = Object.keys(window.__store.h)[0];
              const tb = window.__store.h[k].tombs || {};
              return Object.keys(tb).every(c => !/[.$#[\]/]/.test(c)
                && Object.keys(tb[c]).every(id => !/[.$#[\]/]/.test(id) && typeof tb[c][id] === 'number'));
            }));
  }

  s.section('6. closing a month is not undone by an offline phone either');
  {
    await B.page.evaluate(() => detachCloud());
    await A.page.evaluate(() => {
      S.archives.unshift({ id: 'ar1', label: 'September', closedAt: Date.now(),
        total: S.expenses.reduce((t, e) => t + e.amount, 0),
        members: S.members.slice(), expenses: S.expenses.slice(), settles: [] });
      S.expenses = []; S.settles = []; save();
    });
    await A.page.waitForTimeout(400);
    s.check('A is cleared down', (await ids(A.page)) === '');
    await put(B.page, await h.dump(A.page));
    await B.page.evaluate(() => { syncTried = true; tryReconnect(true); });
    await B.page.waitForTimeout(1500);
    s.check('B does not re-open the month', (await ids(B.page)) === '', await ids(B.page));
    s.check('nor push the expenses back', (await cloudIds(B.page)) === '', await cloudIds(B.page));
    s.check('B did receive the archive', await B.page.evaluate(() => S.archives.length === 1));
  }

  s.section('7. a record genuinely re-created with the same id is allowed back');
  {
    await A.page.evaluate(() => {
      // Recurring expenses derive their id, so the same one can legitimately
      // reappear; the marker has to get out of the way.
      S.expenses.push({ id: 'e2', desc: 'Breakfast again', amount: 600,
                        payer: S.members[0].id, parts: S.members.map(m => m.id), date: Date.now() });
      save();
    });
    await A.page.waitForTimeout(400);
    s.check('it is kept', (await ids(A.page)) === 'e2', await ids(A.page));
    s.check('its marker is cleared',
            !(await A.page.evaluate(() => Object.keys((S.tombs || {}).expenses || {}))).includes('e2'));
    s.check('and it reaches the database', (await cloudIds(A.page)) === 'e2', await cloudIds(A.page));
  }

  s.section('8. erasing clears the house for everyone, offline phones included');
  {
    await A.page.evaluate(() => {
      const m = S.members.map(x => x.id);
      S.expenses = [{ id: 'z1', desc: 'Lunch', amount: 300, payer: m[0], parts: m, date: Date.now() }];
      save();
    });
    await A.page.waitForTimeout(300);
    // tryReconnect only acts on a disconnected device, so drop the link first.
    await B.page.evaluate(() => detachCloud());
    await put(B.page, await h.dump(A.page));
    await B.page.evaluate(() => { syncTried = true; tryReconnect(true); });
    await B.page.waitForTimeout(1200);
    s.check('B has it before the erase', (await ids(B.page)) === 'z1', await ids(B.page));
    await B.page.evaluate(() => detachCloud());

    // A erases while B is away.
    await A.page.evaluate(() => { doErase(); });
    await A.page.waitForTimeout(700);
    s.check('the database is emptied', (await cloudIds(A.page)) === '', await cloudIds(A.page));
    s.check('with markers left behind', await A.page.evaluate(() => {
      const k = Object.keys(window.__store.h)[0];
      const tb = window.__store.h[k].tombs || {};
      return Object.keys(tb).some(c => Object.keys(tb[c] || {}).length > 0);
    }));
    s.check('the house itself survives so people stay logged in', await A.page.evaluate(() => {
      const k = Object.keys(window.__store.h)[0];
      return !!(window.__store.h[k].meta && window.__store.h[k].meta.passHash);
    }));

    await put(B.page, await h.dump(A.page));
    await B.page.evaluate(() => { syncTried = true; tryReconnect(true); });
    await B.page.waitForTimeout(1500);
    s.check('B is cleared too', (await ids(B.page)) === '', await ids(B.page));
    s.check('and pushes nothing back', (await cloudIds(B.page)) === '', await cloudIds(B.page));
    s.check('members are gone as well', await B.page.evaluate(() => S.members.length === 0));
  }

  await A.ctx.close(); await B.ctx.close();
  await b.close();
  s.finish();
})();
