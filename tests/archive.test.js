/* Deleting a closed month. It is the only record of what the house spent
   before the reset, so it is confirmed, and it has to leave the cloud too. */
const h = require('./helpers/harness');

(async () => {
  const s = h.suite('archive');
  const b = await h.launch();
  const { ctx, page } = await h.open(b, s);
  await h.register(page, 'Rajawasala', 'pw', ['Shamindha', 'Madhubashana']);
  await h.settleIn(page);
  await page.evaluate(() => {
    const [a, b2] = S.members.map(m => m.id);
    const mk = (id, label, total) => ({ id, label, closedAt: Date.now(), total,
      members: S.members.map(m => ({ id: m.id, name: m.name, color: m.color })),
      expenses: [{ id: 'x' + id, desc: 'Dinner', amount: total, payer: a, parts: [a, b2],
                   date: Date.now() }], settles: [] });
    S.archives = [mk('a1', 'September 2026', 7615), mk('a2', 'August 2026', 5200)];
    save(); view = 'report'; reportScope = 'house'; drawView();
  });
  await page.waitForTimeout(400);
  const rows = () => page.$$eval('.stg .card .exp', e => e.length);

  s.section('1. each closed month offers a delete');
  s.check('both months listed', (await page.evaluate(() => S.archives.length)) === 2);
  const btns = await page.$$eval('.stg .exp button', e => e.length);
  s.check('a button per row', btns >= 2, btns);
  s.check('both are in the database', await page.evaluate(() => {
    const k = Object.keys(window.__store.h)[0];
    const ar = window.__store.h[k].archives || {};
    return !!ar.a1 && !!ar.a2;
  }));

  s.section('2. it asks before destroying the record');
  await page.evaluate(() => delArchive('a1'));
  await page.waitForTimeout(300);
  s.check('a confirmation appears', await page.evaluate(() => !!document.getElementById('cfmBg')));
  s.check('it names the month and the total', await page.evaluate(() => {
    const t = document.getElementById('cfmBg').textContent;
    return t.includes('September 2026') && t.includes('7,615');
  }), await page.evaluate(() => (document.getElementById('cfmBg')||{}).textContent));
  await page.click('#cfmNo');
  await page.waitForTimeout(300);
  s.check('saying no keeps it', (await page.evaluate(() => S.archives.length)) === 2);

  s.section('3. confirming removes it, here and in the cloud');
  await page.evaluate(() => delArchive('a1'));
  await page.waitForTimeout(300);
  await page.click('#cfmYes');
  await page.waitForTimeout(600);
  s.check('gone locally', (await page.evaluate(() => S.archives.map(a => a.id).join())) === 'a2');
  // archives is a cloud collection, so the removal has to reach everyone —
  // not just disappear from this phone.
  s.check('gone from the database', await page.evaluate(() => {
    const k = Object.keys(window.__store.h)[0];
    const ar = window.__store.h[k].archives || {};
    return !ar.a1 && !!ar.a2;
  }));
  s.check('the other month is untouched',
          await page.evaluate(() => S.archives[0].total === 5200));
  s.check('it is logged', await page.evaluate(() =>
          (S.activity || []).some(x => (x.text || '').includes('September 2026'))));

  s.section('4. the month view has its own delete');
  await page.evaluate(() => viewArchive('a2'));
  await page.waitForTimeout(400);
  const inSheet = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#sheet .addbtn')]
      .find(b => /delete this month|අයින්/i.test(b.textContent));
    return btn ? btn.textContent.trim() : null;
  });
  s.check('a delete button is in the sheet', !!inSheet, inSheet);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#sheet .addbtn')]
      .find(b => /delete this month|අයින්/i.test(b.textContent));
    btn.click();
  });
  await page.waitForTimeout(300);
  await page.click('#cfmYes');
  await page.waitForTimeout(600);
  s.check('the last month is gone', (await page.evaluate(() => S.archives.length)) === 0);
  s.check('the sheet closed', !(await page.evaluate(() =>
          document.getElementById('sheet').classList.contains('show'))));
  // Check the rendered view, not document.body — that includes the <script>
  // tag, where the i18n string itself lives.
  s.check('the Closed months section is gone', await page.evaluate(() =>
          !document.getElementById('content').textContent.includes('Closed months')));
  s.check('and the report still renders', await page.evaluate(() =>
          document.getElementById('content').textContent.includes('Total spent')));

  await ctx.close();
  await b.close();
  s.finish();
})();
