/* What the app says about syncing, and what happens to edits made offline. */
const h = require('./helpers/harness');

(async () => {
  const s = h.suite('sync');
  const b = await h.launch();
  const { ctx, page } = await h.open(b, s);
  await h.register(page, 'Sync House', 'pw', ['Nimal']);
  await h.settleIn(page);

  const state = () => page.evaluate(() => cloudState());

  s.section('1. connected state comes from the database, not from guesswork');
  s.check('syncing', await page.evaluate(() => cloud.on));
  s.check('state is synced', (await state()) === 'synced', await state());
  s.check('badge shows the tick', (await page.evaluate(() => document.getElementById('cloudBtn').textContent)) === '✅');

  s.section('2. losing the connection is actually noticed');
  await page.evaluate(() => window.__setOnline(false));
  await page.waitForTimeout(200);
  s.check('state flips to offline', (await state()) === 'offline', await state());
  s.check('the badge warns', await page.evaluate(() => document.getElementById('cloudBtn').classList.contains('warn')));
  s.check('the tooltip explains', (await page.evaluate(() => document.getElementById('cloudBtn').title)).length > 3);

  s.section('3. edits made offline are held, then flushed on reconnect');
  await page.evaluate(() => { S.members.push({ id: 'zz9', name: 'Offline Guy', color: '#16A074' }); save(); });
  await page.waitForTimeout(150);
  s.check('the edit is kept locally', await page.evaluate(() => S.members.some(m => m.id === 'zz9')));
  s.check('the write is queued, not acknowledged', (await page.evaluate(() => window.__queuedWrites())) > 0);
  s.check('it has not reached the database yet', await page.evaluate(() => {
    const k = Object.keys(window.__store.h)[0]; return !window.__store.h[k].members.zz9; }));
  s.check('the app counts it as pending', (await page.evaluate(() => cloud.pending)) > 0);
  await page.evaluate(() => window.__setOnline(true));
  await page.waitForTimeout(400);
  s.check('state returns to synced', (await state()) === 'synced', await state());
  s.check('nothing left pending', (await page.evaluate(() => cloud.pending)) === 0);
  s.check('the offline edit landed on reconnect', await page.evaluate(() => {
    const k = Object.keys(window.__store.h)[0]; return !!window.__store.h[k].members.zz9; }));

  s.section('4. an edit made in place is sent, not swallowed by the diff');
  await page.evaluate(() => {
    S.expenses = [{ id: 'e1', desc: 'Rice', amount: 500, payer: S.members[0].id,
                    parts: S.members.map(m => m.id), date: Date.now() }];
    save();
  });
  await page.waitForTimeout(250);
  const dbExp = () => page.evaluate(() => {
    const k = Object.keys(window.__store.h)[0]; return window.__store.h[k].expenses.e1; });
  s.check('the first save lands', (await dbExp()).amount === 500);
  // cloud.mirror once held references to these very objects, so mutating one
  // changed both sides of the diff and the edit was never written.
  await page.evaluate(() => { S.expenses[0].amount = 900; S.expenses[0].desc = 'Rice and dhal'; save(); });
  await page.waitForTimeout(250);
  s.check('the new amount syncs', (await dbExp()).amount === 900, await dbExp());
  s.check('the new description syncs', (await dbExp()).desc === 'Rice and dhal');

  s.section('5. logout tears the listeners down');
  await page.evaluate(() => logout());
  await page.waitForTimeout(200);
  s.check('no refs left', await page.evaluate(() => !cloud.ref && !cloud.infoRef && !cloud.on));
  s.check('state reads off', (await state()) === 'off', await state());

  await ctx.close();
  await b.close();
  s.finish();
})();
