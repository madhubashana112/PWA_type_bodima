/* Installing offline, and how a new build reaches someone already running one.

   This suite serves its own copy of the app from a temp directory so sw.js can
   be changed mid-test, the way a deploy would change it. */
const h = require('./helpers/harness');
const fs = require('fs'), path = require('path'), http = require('http');

const SRC = path.join(__dirname, '..');
const DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'bodime-sw-'));
const PORT = Number(process.env.BODIME_SW_PORT || 8123);
const BASE = 'http://localhost:' + PORT;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };

for (const f of ['index.html', 'sw.js', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'])
  fs.copyFileSync(path.join(SRC, f), path.join(DIR, f));

const server = http.createServer((req, res) => {
  const name = (req.url === '/' ? '/index.html' : req.url).split('?')[0];
  const file = path.join(DIR, path.basename(name));
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

(async () => {
  const s = h.suite('service-worker');
  await new Promise(r => server.listen(PORT, r));
  const b = await h.launch();
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 } });
  await ctx.route('**/*', r => r.request().url().startsWith(BASE + '/') ? r.continue() : r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => s.countFailure('uncaught page error: ' + e.message));

  s.section('1. the worker registers and takes control');
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 }).catch(() => {});
  s.check('controlled by a worker', await page.evaluate(() => !!navigator.serviceWorker.controller));
  // The first worker claims the page, which fires controllerchange; that must
  // not be mistaken for an update the user asked for.
  s.check('no update bar on a first install',
          !(await page.evaluate(() => document.getElementById('updbar').classList.contains('show'))));

  s.section('2. the app shell opens with the network down');
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'load' }).catch(() => {});
  await page.waitForTimeout(800);
  s.check('an offline reload still renders', await page.evaluate(() => !!document.querySelector('#app .auth, #app .nav')));
  await ctx.setOffline(false);

  s.section('3. a new build offers itself instead of swapping underneath');
  const sw = fs.readFileSync(path.join(DIR, 'sw.js'), 'utf8');
  // Read the shipped version rather than assuming it: hardcoding the number
  // here would turn this into a silent no-op the next time it is bumped.
  const cur = /const VERSION = '([^']+)'/.exec(sw);
  s.check('sw.js declares a version', !!cur, sw.slice(0, 120));
  const next = String(Number(cur[1]) + 1);
  fs.writeFileSync(path.join(DIR, 'sw.js'), sw.replace(cur[0], "const VERSION = '" + next + "'"));
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
  await page.waitForSelector('#updbar.show', { timeout: 15000 }).catch(() => {});
  s.check('the update bar appears', await page.evaluate(() => document.getElementById('updbar').classList.contains('show')));
  s.check('the page has not reloaded on its own', await page.evaluate(() => !!navigator.serviceWorker.controller));

  s.section('4. accepting it activates the new worker and reloads');
  const nav = page.waitForNavigation({ timeout: 15000 }).catch(() => null);
  await page.click('#updGo');
  await nav;
  await page.waitForTimeout(1200);
  const ver = await page.evaluate(() => new Promise(res => {
    navigator.serviceWorker.ready.then(reg => {
      navigator.serviceWorker.addEventListener('message', e => {
        if (e.data && e.data.type === 'VERSION') res(e.data.version);
      });
      (reg.active || navigator.serviceWorker.controller).postMessage({ type: 'VERSION' });
      setTimeout(() => res('timed out'), 4000);
    });
  }));
  s.check('the new worker is active', ver === next, [ver, next]);
  const caches = await page.evaluate(() => window.caches.keys());
  s.check('the old cache is evicted', caches.length === 1 && caches[0] === 'bodime-v' + next, caches);

  await b.close();
  server.close();
  fs.rmSync(DIR, { recursive: true, force: true });
  s.finish();
})();
