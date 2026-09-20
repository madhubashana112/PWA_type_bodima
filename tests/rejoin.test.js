/* A phone that was already logged in when the app updated, and the house it
   has to find its way back to. */
const h = require('./helpers/harness');

// The house as an older build left it: plaintext password, guessable path.
const legacyCloud = () => ({ houses: { rajawasala: {
  meta: { house: 'Rajawasala', pass: 'pw123', lang: 'en' },
  members: {
    m1: { id: 'm1', name: 'Shamindha', color: '#F0573C' },
    m2: { id: 'm2', name: 'Madhubashana', color: '#16A074' }
  },
  expenses: {
    e1: { id: 'e1', desc: 'Dinner', amount: 1100, payer: 'm1', parts: ['m1', 'm2'], date: 1789000000000 },
    e2: { id: 'e2', desc: 'Travel', amount: 90, payer: 'm2', parts: ['m1', 'm2'], date: 1789100000000 }
  }
} } });

// What that build had written into localStorage on this phone.
const legacyLocal = () => JSON.stringify({
  house: 'Rajawasala', pass: 'pw123', lang: 'en', _auth: true,
  members: [{ id: 'm1', name: 'Shamindha', color: '#F0573C' },
            { id: 'm2', name: 'Madhubashana', color: '#16A074' }],
  expenses: [{ id: 'e1', desc: 'Dinner', amount: 1100, payer: 'm1', parts: ['m1', 'm2'], date: 1789000000000 },
             { id: 'e2', desc: 'Travel', amount: 90, payer: 'm2', parts: ['m1', 'm2'], date: 1789100000000 }],
  settles: [], archives: [], activity: [], debts: []
});

/* Loads the app with that localStorage already in place, the way the update
   would have arrived on a phone mid-use. */
async function upgradedPhone(b, s, local, store) {
  const ctx = await h.context(b);
  const page = await ctx.newPage();
  page.on('pageerror', e => s.countFailure('uncaught page error: ' + e.message));
  await page.goto(h.BASE + '/index.html', { waitUntil: 'load' });
  await page.evaluate(d => localStorage.setItem('bodime_data_v2', d), local);
  await page.reload({ waitUntil: 'load' });
  await h.install(page, store);
  await page.evaluate(() => { if (typeof reconnectCloud === 'function') reconnectCloud(); });
  await page.waitForTimeout(600);
  return { ctx, page };
}

/* A phone whose plaintext password was already consumed by an earlier load,
   so it has a valid hash but no cloud path: the state a device is left in if
   it opened the update before this fix existed. */
async function strandedPhone(b, s, store) {
  const ctx = await h.context(b);
  const page = await ctx.newPage();
  page.on('pageerror', e => s.countFailure('uncaught page error: ' + e.message));
  await page.goto(h.BASE + '/index.html', { waitUntil: 'load' });
  await page.evaluate(() => {
    const st = { house: 'Rajawasala', lang: 'en', _auth: true,
      members: [{ id: 'm1', name: 'Shamindha', color: '#F0573C' },
                { id: 'm2', name: 'Madhubashana', color: '#16A074' }],
      expenses: [{ id: 'e1', desc: 'Dinner', amount: 1100, payer: 'm1', parts: ['m1', 'm2'], date: 1789000000000 },
                 { id: 'e2', desc: 'Travel', amount: 90, payer: 'm2', parts: ['m1', 'm2'], date: 1789100000000 }],
      settles: [], archives: [], activity: [], debts: [], recurring: [] };
    setPass(st, 'pw123');                       // real hash, deliberately no cpath
    localStorage.setItem('bodime_data_v2', JSON.stringify(st));
  });
  await page.reload({ waitUntil: 'load' });
  await h.install(page, store);
  await page.evaluate(() => { reconnectCloud(); drawView(); });
  await page.waitForTimeout(600);
  return { ctx, page };
}

(async () => {
  const s = h.suite('rejoin');
  const b = await h.launch();

  s.section('1. an update mid-session keeps syncing');
  {
    const { ctx, page } = await upgradedPhone(b, s, legacyLocal(), legacyCloud());
    s.check('still logged in', await h.loggedIn(page));
    // The plaintext is the only way to derive the path, and it is gone after
    // the first load, so it has to be captured during the migration.
    s.check('a cloud path was worked out', !!(await page.evaluate(() => S.cpath)));
    s.check('the plaintext password is gone', await page.evaluate(() => S.pass === undefined));
    s.check('the password still verifies', await page.evaluate(() => verifyPass(S, 'pw123')));
    s.check('it reconnected rather than going local-only',
            await page.evaluate(() => cloud.on === true), await page.evaluate(() => cloud.on));
    s.check('no "not syncing" warning', !(await page.evaluate(() => syncPaused())));
    // The dangerous shape: private path empty, so the phone uploads its own
    // copy and the group ends up in two houses without anyone noticing.
    const store = await h.dump(page);
    s.check('exactly one house, not a fork', Object.keys(store.h || {}).length === 1, Object.keys(store.h || {}));
    s.check('it carried the house across', await page.evaluate(() => {
      const k = Object.keys(window.__store.h)[0];
      const ids = Object.keys(window.__store.h[k].expenses || {});
      return ids.includes('e1') && ids.includes('e2');
    }));
    s.check('the old path is tombstoned', store.houses.rajawasala.moved === 1, store.houses.rajawasala);
    s.check('the plaintext password is gone from the database',
            !JSON.stringify(store).includes('pw123'));
    await ctx.close();
  }

  s.section('2. an expense added after the update reaches the house');
  {
    const { ctx, page } = await upgradedPhone(b, s, legacyLocal(), legacyCloud());
    await page.evaluate(() => {
      S.expenses.unshift({ id: 'new1', desc: 'Lunch', amount: 555, payer: 'm1',
                           parts: ['m1', 'm2'], date: Date.now() });
      save();
    });
    await page.waitForTimeout(500);
    const inCloud = await page.evaluate(() => JSON.stringify(window.__store).includes('Lunch'));
    s.check('it is in the database', inCloud);
    const where = await page.evaluate(() => {
      const k = Object.keys(window.__store.h || {})[0];
      return k ? Object.keys(window.__store.h[k].expenses || {}) : [];
    });
    s.check('alongside the house it came from', where.includes('e1') && where.includes('new1'), where);
    await ctx.close();
  }

  s.section('3. a phone with no path says so instead of going quiet');
  {
    const { ctx, page } = await strandedPhone(b, s, legacyCloud());
    s.check('it knows it is not syncing', await page.evaluate(() => syncPaused()));
    s.check('and shows a bar saying so',
            await page.evaluate(() => document.getElementById('syncbar').classList.contains('show')));
    s.check('with a way to fix it',
            await page.evaluate(() => !!document.querySelector('#syncbar .ub')));
    s.check('the cloud badge warns too',
            await page.evaluate(() => document.getElementById('cloudBtn').classList.contains('warn')));
    await ctx.close();
  }

  s.section('4. reconnecting rejoins the house instead of splitting it');
  {
    const { ctx, page } = await strandedPhone(b, s, legacyCloud());
    // Something was recorded while the phone was on its own.
    await page.evaluate(() => {
      S.expenses.unshift({ id: 'solo1', desc: 'Groceries', amount: 870, payer: 'm1',
                           parts: ['m1', 'm2'], date: Date.now() });
      localStorage.setItem('bodime_data_v2', JSON.stringify(S));
      drawView();
    });
    await page.waitForTimeout(300);
    s.check('the bar is showing', await page.evaluate(() => syncPaused()));
    await page.click('#syncbar .ub');
    await page.waitForTimeout(400);
    await page.fill('#sync_pass', 'pw123');
    await page.click('#sheet .addbtn.coral');
    await page.waitForTimeout(900);

    s.check('syncing again', await page.evaluate(() => cloud.on === true));
    s.check('the warning is gone', !(await page.evaluate(() => syncPaused())));
    const store = await h.dump(page);
    const privates = Object.keys(store.h || {});
    s.check('exactly one house in the database, not two', privates.length === 1, privates);
    const node = store.h[privates[0]];
    const ids = Object.keys(node.expenses || {});
    s.check('the house\'s own expenses are there', ids.includes('e1') && ids.includes('e2'), ids);
    s.check('and the offline one went up with them', ids.includes('solo1'), ids);
    s.check('nothing was dropped locally',
            await page.evaluate(() => S.expenses.length === 3), await page.evaluate(() => S.expenses.length));
    s.check('the old path is tombstoned', store.houses.rajawasala.moved === 1, store.houses.rajawasala);
    s.check('no plaintext password survives', !JSON.stringify(store).includes('pw123'));
    await ctx.close();
  }

  s.section('5. a wrong password at the bar changes nothing');
  {
    const { ctx, page } = await strandedPhone(b, s, legacyCloud());
    await page.click('#syncbar .ub');
    await page.waitForTimeout(400);
    await page.fill('#sync_pass', 'wrong');
    await page.click('#sheet .addbtn.coral');
    await page.waitForTimeout(600);
    s.check('not syncing', !(await page.evaluate(() => cloud.on === true)));
    s.check('still flagged', await page.evaluate(() => syncPaused()));
    const store = await h.dump(page);
    s.check('no house was created', !store.h || !Object.keys(store.h).length, store.h);
    s.check('the old house is untouched', store.houses.rajawasala.meta.pass === 'pw123');
    await ctx.close();
  }

  s.section('6. a connection that fails at boot recovers by itself');
  {
    const { ctx, page } = await upgradedPhone(b, s, legacyLocal(), legacyCloud());
    s.check('connected to begin with', await page.evaluate(() => cloud.on === true));
    // Drop the connection the way a phone on a bad signal does: no listeners,
    // no .info/connected, nothing watching for the network to come back.
    await page.evaluate(() => { detachCloud(); syncTried = true; drawView(); });
    await page.waitForTimeout(300);
    s.check('the app knows it is not syncing', await page.evaluate(() => notSyncing()));
    s.check('and says so, even though it has a path',
            await page.evaluate(() => document.getElementById('syncbar').classList.contains('show')));
    s.check('the button offers a retry, not a password prompt',
            (await page.textContent('#syncbar .ub')).toLowerCase().includes('retry'),
            await page.textContent('#syncbar .ub'));

    // An expense added while stranded must still go up once it reconnects.
    await page.evaluate(() => {
      S.expenses.unshift({ id: 'late1', desc: 'Kottu', amount: 700, payer: 'm1',
                           parts: ['m1', 'm2'], date: Date.now() });
      save();
    });
    await page.click('#syncbar .ub');
    await page.waitForTimeout(900);
    s.check('retrying reconnects', await page.evaluate(() => cloud.on === true));
    s.check('the warning clears', !(await page.evaluate(() =>
            document.getElementById('syncbar').classList.contains('show'))));
    s.check('the expense added while stranded reached the house', await page.evaluate(() => {
      const k = Object.keys(window.__store.h)[0];
      return !!window.__store.h[k].expenses.late1;
    }));
    await ctx.close();
  }

  s.section('7. coming back online reconnects without being asked');
  {
    const { ctx, page } = await upgradedPhone(b, s, legacyLocal(), legacyCloud());
    await page.evaluate(() => { detachCloud(); syncTried = true; drawView(); });
    await page.waitForTimeout(250);
    s.check('stranded', await page.evaluate(() => notSyncing()));
    // The browser reporting the network back should not wait out the backoff.
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(900);
    s.check('reconnected on its own', await page.evaluate(() => cloud.on === true));
    s.check('no warning left', !(await page.evaluate(() =>
            document.getElementById('syncbar').classList.contains('show'))));
    await ctx.close();
  }

  s.section('8. a retry is scheduled, and backs off rather than hammering');
  {
    const { ctx, page } = await upgradedPhone(b, s, legacyLocal(), legacyCloud());
    const backoff = await page.evaluate(() => {
      detachCloud();
      const waits = [];
      const realSet = window.setTimeout;
      window.setTimeout = (fn, ms) => { if (ms >= 5000) waits.push(ms); return realSet(() => {}, 999999); };
      for (let i = 0; i < 5; i++) { reconnectTimer = null; reconnectTries = i; scheduleReconnect(); }
      window.setTimeout = realSet;
      return waits;
    });
    s.check('waits grow', backoff.length === 5 && backoff.every((w, i) => !i || w >= backoff[i - 1]), backoff);
    s.check('and are capped', Math.max(...backoff) <= 60000, backoff);
    s.check('nothing is scheduled once there is nothing to retry',
            await page.evaluate(() => { clearReconnect(); cloud.on = true;
              scheduleReconnect(); return reconnectTimer === null; }));
    await ctx.close();
  }

  s.section('9. a refused read is reported as such, and not retried forever');
  {
    const { ctx, page } = await upgradedPhone(b, s, legacyLocal(), legacyCloud());
    await page.evaluate(() => {
      detachCloud(); syncTried = true;
      // What Firebase sends when the rules say no.
      const err = new Error('permission_denied at /h/abc: Client does not have permission');
      noteCloudError(err);
      drawView();
    });
    await page.waitForTimeout(250);
    s.check('recognised as a refusal, not a dead network', await page.evaluate(() => cloud.denied === true));
    const text = await page.textContent('#syncbar');
    s.check('the bar says the database refused', text.toLowerCase().includes('refused'), text);
    s.check('no endless retry is scheduled', await page.evaluate(() => {
      clearReconnect(); cloud.denied = true; scheduleReconnect(); return reconnectTimer === null; }));
    s.check('a timeout is still retried', await page.evaluate(() => {
      clearReconnect(); noteCloudError(new Error('timeout'));
      const was = cloud.denied; scheduleReconnect();
      const scheduled = reconnectTimer !== null; clearReconnect();
      return was === false && scheduled; }));
    s.check('the cloud sheet names the reason', await page.evaluate(() => {
      noteCloudError(new Error('permission_denied')); openCloud();
      const t = document.getElementById('sheet').textContent.toLowerCase();
      closeSheet(); return t.includes('refused'); }));
    await ctx.close();
  }

  s.section('10. the warning bar stays inside the app column on a wide window');
  {
    const ctx = await h.context(b, { viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => s.countFailure('uncaught page error: ' + e.message));
    await page.goto(h.BASE + '/index.html', { waitUntil: 'load' });
    await page.evaluate(d => localStorage.setItem('bodime_data_v2', d), legacyLocal());
    await page.reload({ waitUntil: 'load' });
    await h.install(page, legacyCloud());
    await page.evaluate(() => { detachCloud(); syncTried = true; drawView(); });
    await page.waitForTimeout(350);
    const box = await page.evaluate(() => {
      const bar = document.getElementById('syncbar'), app = document.getElementById('app');
      if (!bar || !bar.classList.contains('show')) return null;
      const b = bar.getBoundingClientRect(), a = app.getBoundingClientRect();
      return { barW: Math.round(b.width), appW: Math.round(a.width),
               insideLeft: b.left >= a.left - 1, insideRight: b.right <= a.right + 1 };
    });
    s.check('the bar is showing', !!box, box);
    // It lives outside #app, so without pinning it spanned the whole window.
    s.check('it is not wider than the app column', box && box.barW <= box.appW, box);
    s.check('and sits within it', box && box.insideLeft && box.insideRight, box);
    await ctx.close();
  }

  s.section('11. the migrated copy is clean enough for the hardened rules');
  {
    const { ctx, page } = await upgradedPhone(b, s, legacyLocal(), legacyCloud());
    const node = await page.evaluate(() => {
      const k = Object.keys(window.__store.h)[0];
      return JSON.parse(JSON.stringify(window.__store.h[k]));
    });
    // database.rules.json marks meta.pass and any unknown child .validate:false,
    // so copying the old node verbatim would be rejected on write.
    s.check('no plaintext password in the copy', node.meta.pass === undefined, node.meta);
    s.check('the copy is hashed', /^[0-9a-f]{64}$/.test(node.meta.passHash || ''), node.meta);
    s.check('the salt matches the rule pattern', /^[0-9a-f]{8,64}$/.test(node.meta.passSalt || ''), node.meta);
    s.check('meta carries only what the rules allow',
            Object.keys(node.meta).sort().join() === 'house,lang,passHash,passSalt', Object.keys(node.meta));
    const allowed = ['meta', 'members', 'expenses', 'settles', 'archives', 'activity', 'debts', 'recurring'];
    s.check('no stray top-level keys', Object.keys(node).every(k => allowed.includes(k)), Object.keys(node));
    s.check('every record is keyed by its own id', await page.evaluate(() => {
      const k = Object.keys(window.__store.h)[0], n = window.__store.h[k];
      return ['members', 'expenses'].every(c =>
        Object.keys(n[c] || {}).every(id => n[c][id].id === id));
    }));
    s.check('the house data came across', !!(node.expenses && node.expenses.e1), Object.keys(node.expenses || {}));
    await ctx.close();
  }

  s.section('12. a refusal gives feedback when the button is pressed');
  {
    const { ctx, page } = await upgradedPhone(b, s, legacyLocal(), legacyCloud());
    await page.evaluate(() => {
      detachCloud(); syncTried = true;
      // Make every read fail the way a denying database does. This has to be
      // patched on firebase.database itself: ensureFirebase reassigns cloud.db
      // from it on each attempt, discarding anything patched onto the old one.
      const realDb = window.firebase.database.bind(window.firebase);
      window.firebase.database = () => {
        const db = realDb();
        const realRef = db.ref.bind(db);
        db.ref = p => { const r = realRef(p);
          r.once = () => Promise.reject(new Error('permission_denied at /: Client does not have permission'));
          return r; };
        return db;
      };
      drawView();
    });
    await page.waitForTimeout(250);
    await page.click('#syncbar .ub');
    await page.waitForTimeout(900);
    const toast = await page.evaluate(() => {
      const t = document.getElementById('toast');
      return { shown: t.classList.contains('show'), text: t.textContent };
    });
    s.check('the tap is acknowledged rather than silent', toast.shown, toast);
    s.check('and it says the database refused', toast.text.toLowerCase().includes('refused'), toast);
    s.check('still flagged as denied', await page.evaluate(() => cloud.denied === true));
    await ctx.close();
  }

  await b.close();
  s.finish();
})();
