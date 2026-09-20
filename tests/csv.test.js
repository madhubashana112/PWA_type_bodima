/* Exporting a period to a spreadsheet, and the JSON backup beside it. */
const h = require('./helpers/harness');
const fs = require('fs');

(async () => {
  const s = h.suite('csv');
  const b = await h.launch();
  const ctx = await h.context(b, { acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => s.countFailure('uncaught page error: ' + e.message));
  await page.goto(h.BASE + '/index.html', { waitUntil: 'load' });
  await h.install(page);
  await h.register(page, 'CSV House', 'pw', ['Nimal', 'Kamal', 'Sunil']);
  await h.settleIn(page);
  await page.evaluate(() => {
    const [a, b2, c] = S.members.map(m => m.id);
    S.expenses = [
      { id: 'e1', desc: 'Rice, dhal and "curry"', amount: 1000, payer: a, parts: [a, b2, c], date: Date.now() - 2 * 864e5 },
      { id: 'e2', desc: 'බත් පැකට්', amount: 900, payer: b2, parts: [a, b2], date: Date.now() - 864e5 },
      { id: 'e3', desc: 'Gas', amount: 3000, payer: c, parts: [a, b2, c], date: Date.now(),
        split: { mode: 'exact', values: { [a]: 1000, [b2]: 1500, [c]: 500 } } }
    ];
    save(); drawView();
  });
  await page.waitForTimeout(300);

  s.section('1. the shape of the file');
  const csv = await page.evaluate(() => buildCsv(S.expenses));
  const lines = csv.split('\r\n');
  s.check('header, three rows, a total', lines.length === 5, lines.length);
  s.check('a column per housemate', lines[0].split(',').length === 9, lines[0]);
  const quoted = lines.find(l => l.includes('Rice'));
  s.check('a description with a comma is quoted', quoted.includes('"Rice, dhal and ""curry"""'), quoted);
  s.check('embedded quotes are doubled', quoted.split('""curry""').length === 2, quoted);
  s.check('Sinhala survives', csv.includes('බත් පැකට්'));

  s.section('2. the numbers add up');
  const total = lines[4].split(',');
  s.check('the grand total is the sum', Number(total[2]) === 4900, total[2]);
  s.check('the per-person columns add to the same',
          total.slice(6).map(Number).reduce((a, x) => a + x, 0) === 4900, total.slice(6));
  s.check('an exact split is carried through, not re-divided', lines[3].endsWith('1000,1500,500'), lines[3]);

  s.section('3. it exports the period the report is showing');
  const monthN = await page.evaluate(() => { reportPeriod = 'month'; return periodExpenses('month').length; });
  const dayN = await page.evaluate(() => periodExpenses('day').length);
  s.check('a day is narrower than a month', dayN < monthN, [dayN, monthN]);
  const dayCsv = await page.evaluate(() => buildCsv(periodExpenses('day')));
  s.check('the day export holds only today', dayCsv.split('\r\n').length === dayN + 2);

  s.section('4. downloading produces a real file');
  await page.evaluate(() => { view = 'report'; drawView(); });
  await page.waitForTimeout(400);
  const dl = page.waitForEvent('download', { timeout: 8000 });
  await page.evaluate(() => exportCsv());
  const d = await dl;
  s.check('the filename says house and period',
          /^bodime_CSV_House_month_\d{4}-\d{2}-\d{2}\.csv$/.test(d.suggestedFilename()), d.suggestedFilename());
  const body = fs.readFileSync(await d.path(), 'utf8');
  // Without the BOM, Excel reads the Sinhala as mojibake.
  s.check('it opens with a UTF-8 BOM', body.charCodeAt(0) === 0xFEFF);
  s.check('the expenses are in it', body.includes('Gas') && body.includes('බත් පැකට්'));

  s.section('5. the JSON backup still works');
  const dl2 = page.waitForEvent('download', { timeout: 8000 });
  await page.evaluate(() => exportBackup());
  const d2 = await dl2;
  s.check('json filename', /\.json$/.test(d2.suggestedFilename()), d2.suggestedFilename());
  const j = JSON.parse(fs.readFileSync(await d2.path(), 'utf8'));
  s.check('a valid backup', j._bodime === 1 && j.expenses.length === 3, Object.keys(j));
  s.check('with no plaintext password in it', j.pass === undefined && !!j.passHash);

  await ctx.close();
  await b.close();
  s.finish();
})();
