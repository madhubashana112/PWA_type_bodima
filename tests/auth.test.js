/* Registering, logging in, and moving a house created by an older build off
   the guessable path it used to live on. */
const h = require('./helpers/harness');

(async () => {
  const s = h.suite('auth');
  const b = await h.launch();

  s.section('1. register writes only a hash, never the password');
  {
    const { ctx, page } = await h.open(b, s);
    await h.register(page, 'Test House', 'hunter2', ['Nimal']);
    s.check('logged in', await h.loggedIn(page));
    const store = await h.dump(page);
    s.check('no plaintext password anywhere in the database',
            !JSON.stringify(store).includes('hunter2'));
    s.check('nothing at the guessable houses/<name> path', !(store.houses && store.houses.test_house));
    const priv = Object.keys(store.h || {});
    s.check('exactly one private house node', priv.length === 1, priv);
    const meta = store.h[priv[0]].meta;
    s.check('meta carries passHash and passSalt', !!(meta.passHash && meta.passSalt), meta);
    s.check('meta carries no pass field', meta.pass === undefined);
    s.check('the name is claimed', !!(store.names && store.names.test_house));
    await ctx.close();
  }

  s.section('2. a second device logs in with the same name and password');
  {
    const first = await h.open(b, s);
    await h.register(first.page, 'Test House', 'hunter2', ['Nimal']);
    const store = await h.dump(first.page);
    await first.ctx.close();

    const { ctx, page } = await h.open(b, s, store);
    await h.login(page, 'Test House', 'hunter2');
    s.check('logged in on the second device', await h.loggedIn(page));
    const names = await page.evaluate(() => S.members.map(m => m.name));
    s.check('the house members came across', names.includes('Nimal'), names);
    await ctx.close();
  }

  s.section('3. a wrong password is rejected, and says which is wrong');
  {
    const first = await h.open(b, s);
    await h.register(first.page, 'Test House', 'hunter2');
    const store = await h.dump(first.page);
    await first.ctx.close();

    const { ctx, page } = await h.open(b, s, store);
    await h.login(page, 'Test House', 'nope');
    s.check('not logged in', !(await h.loggedIn(page)));
    const err = await h.authError(page);
    // The private path is derived from the password, so a wrong one finds
    // nothing; without the name marker this would read "no such house".
    s.check('says wrong password, not no such house', err.toLowerCase().includes('wrong'), err);
    await ctx.close();
  }

  s.section('4. registering a name already taken is refused');
  {
    const first = await h.open(b, s);
    await h.register(first.page, 'Test House', 'hunter2');
    const store = await h.dump(first.page);
    await first.ctx.close();

    const { ctx, page } = await h.open(b, s, store);
    await h.register(page, 'Test House', 'something-else');
    s.check('refused', !(await h.loggedIn(page)));
    s.check('and says why', (await h.authError(page)).length > 0, await h.authError(page));
    await ctx.close();
  }

  const legacyHouse = () => ({ houses: { old_bodima: {
    meta: { house: 'Old Bodima', pass: 'plain123', lang: 'en' },
    members: { m1: { id: 'm1', name: 'Kamal', color: '#F0573C' } },
    expenses: { e1: { id: 'e1', amount: 500, desc: 'Rice', payer: 'm1', parts: ['m1'],
                      date: 1700000000000, split: { mode: 'equal', values: {} } } }
  } } });

  s.section('5. a house on a plaintext password still logs in, and is migrated');
  {
    const { ctx, page } = await h.open(b, s, legacyHouse());
    await h.login(page, 'Old Bodima', 'plain123');
    s.check('logged in with the old password', await h.loggedIn(page));
    const got = await page.evaluate(() => ({ exp: S.expenses.length, mem: S.members.length,
                                             hash: !!S.passHash, path: S.cpath }));
    s.check('the data came with it', got.exp === 1 && got.mem === 1, got);
    s.check('the password is hashed locally now', got.hash);
    const store = await h.dump(page);
    s.check('the old node is left as a tombstone', store.houses.old_bodima.moved === 1, store.houses.old_bodima);
    s.check('the house moved to its private path', !!(store.h && store.h[got.path.split('/')[1]]));
    s.check('no plaintext left in the database', !JSON.stringify(store).includes('plain123'));
    const meta = store.h[got.path.split('/')[1]].meta;
    s.check('the migrated meta is hashed', !!meta.passHash && meta.pass === undefined, meta);
    s.check('the name is claimed for it', !!(store.names && store.names.old_bodima));
    await ctx.close();
  }

  s.section('6. a wrong password moves nothing');
  {
    const { ctx, page } = await h.open(b, s, legacyHouse());
    await h.login(page, 'Old Bodima', 'wrongpw');
    s.check('not logged in', !(await h.loggedIn(page)));
    const store = await h.dump(page);
    s.check('the old house is untouched', store.houses.old_bodima.meta.pass === 'plain123');
    s.check('no private node was created', !store.h || !Object.keys(store.h).length, store.h);
    await ctx.close();
  }

  s.section('7. a migration that cannot reach the server gives up cleanly');
  {
    const { ctx, page } = await h.open(b, s, legacyHouse());
    // Reads still answer from the seeded store; writes hang, as they do on a
    // real connection that has dropped.
    await page.evaluate(() => window.__setOnline(false));
    await h.login(page, 'Old Bodima', 'plain123');
    await page.waitForTimeout(11000);
    s.check('the button is not stuck on "connecting"',
            await page.evaluate(() => { const btn = document.querySelector('#authBody .btn-primary');
                                        return btn && !btn.disabled; }));
    s.check('it says the cloud is unreachable', (await h.authError(page)).length > 0, await h.authError(page));
    const store = await h.dump(page);
    s.check('the house is left exactly as it was', store.houses.old_bodima.meta.pass === 'plain123');
    await ctx.close();
  }

  s.section('8. a reload reconnects to the private path');
  {
    const { ctx, page } = await h.open(b, s);
    await h.register(page, 'Test House', 'hunter2', ['Nimal']);
    const store = await h.dump(page);
    await page.reload({ waitUntil: 'load' });
    await h.install(page, store);
    await page.evaluate(() => reconnectCloud());
    await page.waitForTimeout(500);
    s.check('still logged in', await h.loggedIn(page));
    s.check('listening on the private path',
            await page.evaluate(() => cloud.on && !!cloud.ref && cloud.ref._path === S.cpath));
    await ctx.close();
  }

  await b.close();
  s.finish();
})();
