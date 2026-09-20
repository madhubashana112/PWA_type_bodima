/* Editing a member from the People list. The row used to carry a delete,
   one mis-tap away from removing someone from every expense they were in. */
const h = require('./helpers/harness');

(async () => {
  const s = h.suite('members');
  const b = await h.launch();
  const { ctx, page } = await h.open(b, s);
  await h.register(page, 'Rajawasala', 'pw', ['Sadeesh', 'Shaminda', 'Sudhari']);
  await h.settleIn(page);
  await page.evaluate(() => {
    const [a, b2] = S.members.map(m => m.id);
    S.expenses = [{ id: 'e1', desc: 'Dinner', amount: 900, payer: a,
                    parts: S.members.map(m => m.id), date: Date.now() }];
    S.debts = [{ id: 'd1', owner: b2, ownerName: 'Shaminda', person: 'Kalana',
                 total: 500, reason: '', date: Date.now(), due: null, payments: [] }];
    save(); go('mem');
  });
  await page.waitForTimeout(400);

  s.section('1. the row offers edit, not delete');
  s.check('a row per member', (await page.$$eval('.mrow', e => e.length)) === 3);
  s.check('no delete button on any row', (await page.$$eval('.mrow .del', e => e.length)) === 0);
  s.check('an edit button on every row', (await page.$$eval('.mrow .edit', e => e.length)) === 3);

  s.section('2. editing renames, and it reaches the house');
  await page.click('.mrow:nth-child(2) .edit');
  await page.waitForTimeout(400);
  s.check('the sheet opens on that member',
          (await page.inputValue('#m_name')) === 'Shaminda', await page.inputValue('#m_name'));
  await page.fill('#m_name', 'Shaminda P.');
  await page.click('#sheet .addbtn.coral');
  await page.waitForTimeout(600);
  s.check('renamed locally', await page.evaluate(() => S.members.some(m => m.name === 'Shaminda P.')));
  s.check('renamed in the database', await page.evaluate(() => {
    const k = Object.keys(window.__store.h)[0];
    return Object.values(window.__store.h[k].members).some(m => m.name === 'Shaminda P.');
  }));
  // Debts cache the owner's name, so a rename has to reach them.
  s.check('their debt shows the new name', await page.evaluate(() => S.debts[0].ownerName === 'Shaminda P.'));
  s.check('nobody else was touched',
          (await page.evaluate(() => S.members.map(m => m.name).join())) === 'Sadeesh,Shaminda P.,Sudhari');
  s.check('their expenses are intact', await page.evaluate(() => S.expenses.length === 1));

  s.section('3. the colour can be changed, which is why the sheet has swatches');
  await page.click('.mrow:nth-child(3) .edit');
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => S.members[2].color);
  const other = await page.evaluate(() => {
    const cur = S.members[2].color;
    return AVCOLORS.find(c => c !== cur);
  });
  await page.click(`#m_colors .swatch[data-c="${other}"]`);
  s.check('the picked swatch is marked',
          await page.evaluate(c => document.querySelector(`#m_colors .swatch[data-c="${c}"]`).classList.contains('on'), other));
  await page.click('#sheet .addbtn.coral');
  await page.waitForTimeout(600);
  s.check('the colour changed', await page.evaluate(c => S.members[2].color === c, other));
  s.check('and it is not the old one', (await page.evaluate(() => S.members[2].color)) !== before);

  s.section('4. removing is still possible, from inside the sheet');
  await page.click('.mrow:nth-child(3) .edit');
  await page.waitForTimeout(400);
  const delBtn = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#sheet .addbtn')]
      .find(x => /remove member|අයින්/i.test(x.textContent));
    return btn ? btn.textContent.trim() : null;
  });
  s.check('a remove button is in the sheet', !!delBtn, delBtn);
  await page.evaluate(() => {
    [...document.querySelectorAll('#sheet .addbtn')]
      .find(x => /remove member|අයින්/i.test(x.textContent)).click();
  });
  await page.waitForTimeout(300);
  s.check('it asks first', await page.evaluate(() => !!document.getElementById('cfmBg')));
  await page.click('#cfmYes');
  await page.waitForTimeout(600);
  s.check('the member is gone', (await page.evaluate(() => S.members.length)) === 2);
  s.check('the sheet closed', !(await page.evaluate(() =>
          document.getElementById('sheet').classList.contains('show'))));
  s.check('gone from the database too', await page.evaluate(() => {
    const k = Object.keys(window.__store.h)[0];
    return Object.keys(window.__store.h[k].members).length === 2;
  }));

  s.section('5. adding a member still works');
  await page.click('.stg > .addbtn:last-child');
  await page.waitForTimeout(400);
  await page.fill('#m_name', 'Nimradha');
  await page.click('#sheet .addbtn.coral');
  await page.waitForTimeout(600);
  s.check('added', await page.evaluate(() => S.members.some(m => m.name === 'Nimradha')));
  s.check('with a colour', await page.evaluate(() =>
          /^#[0-9A-Fa-f]{6}$/.test(S.members.find(m => m.name === 'Nimradha').color)));

  await ctx.close();
  await b.close();
  s.finish();
})();
