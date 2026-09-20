/* Shared plumbing for the browser tests: finding Chromium, opening the app
   with a stubbed database, and counting assertions. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firebase.js'), 'utf8');
const BASE = process.env.BODIME_URL || 'http://localhost:8099';

/* Playwright's own browser folder is pinned to the version it shipped with,
   which is often not the one installed here. Prefer whatever is actually on
   disk over what the library expects. */
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch (e) { /* fall through */ }
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (fs.existsSync(root)) {
    const dirs = fs.readdirSync(root).filter(d => d.startsWith('chromium-')).sort().reverse();
    for (const d of dirs) {
      const exe = path.join(root, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return undefined;   // let Playwright try its default and report properly
}

function suite(name) {
  let pass = 0, fail = 0;
  return {
    name,
    section(title) { console.log('\n  ' + title); },
    check(what, ok, detail) {
      if (ok) { pass++; console.log('    ok   ' + what); }
      else { fail++; console.log('    FAIL ' + what + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); }
    },
    countFailure(msg) { fail++; console.log('    FAIL ' + msg); },
    get failed() { return fail; },
    get passed() { return pass; },
    finish() {
      console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
      process.exit(fail ? 1 : 0);
    }
  };
}

function launch() { return chromium.launch({ executablePath: chromePath() }); }

/* index.html carries a real Firebase config, so a test that slipped past the
   stub would talk to the live database. Nothing is allowed off localhost. */
async function context(browser, opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 412, height: 900 } }, opts));
  await ctx.route('**/*', route => {
    const u = route.request().url();
    const ok = u.startsWith(BASE + '/') || u.startsWith('data:') || u.startsWith('blob:');
    return ok ? route.continue() : route.abort();
  });
  return ctx;
}

/* Loads the app and installs the stub. `store` seeds the fake database. */
async function open(browser, s, store) {
  const ctx = await context(browser);
  const page = await ctx.newPage();
  page.on('pageerror', e => s.countFailure('uncaught page error: ' + e.message));
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await install(page, store);
  return { ctx, page };
}

async function install(page, store) {
  await page.evaluate(FAKE);
  if (store) await page.evaluate(seed => {
    window.__store = seed;
    if (!seed['.info']) seed['.info'] = { connected: true };
  }, store);
  await page.waitForTimeout(250);
}

async function register(page, house, pass, members) {
  await page.click('.seg button:nth-child(3)');
  await page.waitForTimeout(150);
  await page.fill('#s_house', house);
  await page.fill('#s_pass', pass);
  await page.fill('#s_pass2', pass);
  for (const m of members || []) { await page.fill('#s_mem', m); await page.press('#s_mem', 'Enter'); }
  await page.click('#authBody .btn-primary');
  await page.waitForTimeout(700);
}

async function login(page, house, pass) {
  await page.click('.seg button:nth-child(2)');
  await page.waitForTimeout(150);
  await page.fill('#l_house', house);
  await page.fill('#l_pass', pass);
  await page.click('#authBody .btn-primary');
  await page.waitForTimeout(800);
}

/* A freshly registered house asks "which of these is you?" before anything
   else can be clicked. */
async function settleIn(page) {
  await page.evaluate(() => { if (S.members.length) setMeId(S.members[0].id); closeSheet(); drawView(); });
  await page.waitForTimeout(300);
}

const loggedIn = page => page.evaluate(() => !!document.querySelector('.nav'));
const authError = page => page.evaluate(() => {
  const e = document.getElementById('authErr'); return e ? e.textContent : '';
});
const dump = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__store)));
const houseNode = page => page.evaluate(() => {
  const k = Object.keys(window.__store.h || {})[0];
  return k ? JSON.parse(JSON.stringify(window.__store.h[k])) : null;
});

module.exports = { BASE, FAKE, chromePath, suite, launch, context, open, install,
                   register, login, settleIn, loggedIn, authError, dump, houseNode };
