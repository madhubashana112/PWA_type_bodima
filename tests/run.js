#!/usr/bin/env node
/* Serves the app on a local port and runs each suite against it.

   node tests/run.js            all suites
   node tests/run.js auth csv   just those
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.BODIME_PORT || 8099);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
                '.png': 'image/png', '.css': 'text/css' };

const ALL = ['auth', 'sync', 'rejoin', 'history', 'recurring', 'report', 'personal', 'csv', 'service-worker'];
const want = process.argv.slice(2).length ? process.argv.slice(2) : ALL;

function serve(dir, port) {
  const server = http.createServer((req, res) => {
    const name = (req.url === '/' ? '/index.html' : req.url).split('?')[0];
    const file = path.join(dir, path.basename(name));
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain',
                           'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  });
  return new Promise(r => server.listen(port, () => r(server)));
}

function run(file, env) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [file], { stdio: 'inherit', env });
    child.on('exit', code => resolve(code === 0));
  });
}

(async () => {
  const server = await serve(ROOT, PORT);
  const env = Object.assign({}, process.env, { BODIME_URL: 'http://localhost:' + PORT });
  const failed = [];
  for (const name of want) {
    const file = path.join(__dirname, name + '.test.js');
    if (!fs.existsSync(file)) { console.log('\n=== ' + name + ' — no such suite ==='); failed.push(name); continue; }
    console.log('\n=== ' + name + ' ===');
    if (!await run(file, env)) failed.push(name);
  }
  server.close();
  console.log('\n' + (failed.length ? 'FAILED: ' + failed.join(', ')
                                    : 'all ' + want.length + ' suites passed'));
  process.exit(failed.length ? 1 : 0);
})();
