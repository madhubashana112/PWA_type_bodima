/* A small in-memory stand-in for firebase-database-compat.

   It is injected into the page AFTER load, because index.html bundles the real
   SDK and defines window.firebase itself. Tests must never touch the real
   database, so every suite also blocks requests off localhost.

   Real Firebase holds writes made while the socket is down and resolves them
   on reconnect; this does the same, otherwise an offline test proves nothing
   about what actually reaches the server. */
window.__store = { '.info': { connected: true } };

function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

function getPath(p) {
  let node = window.__store;
  for (const k of p.split('/').filter(Boolean)) {
    if (node === null || typeof node !== 'object') return null;
    node = node[k];
    if (node === undefined) return null;
  }
  return node === undefined ? null : node;
}

function setPath(p, v) {
  const parts = p.split('/').filter(Boolean);
  const last = parts.pop();
  let node = window.__store;
  for (const k of parts) {
    if (node[k] === null || typeof node[k] !== 'object') node[k] = {};
    node = node[k];
  }
  if (v === null) delete node[last]; else node[last] = clone(v);
}

/* The real SDK rejects these characters in a key, and a write containing one
   throws rather than being stored. Without the same check here a suite can
   pass on data no real database would accept — a set of deletion markers
   keyed "expenses/<id>" did exactly that. */
const BADKEY = /[.$#[\]/]/;
function checkKeys(v, where) {
  if (!v || typeof v !== 'object') return;
  if (Array.isArray(v)) return v.forEach(x => checkKeys(x, where));
  Object.keys(v).forEach(k => {
    if (k === '' || BADKEY.test(k))
      throw new Error('Invalid key "' + k + '" in ' + where + '. Keys must be non-empty and cannot contain ".", "#", "$", "/", "[", or "]"');
    checkKeys(v[k], where);
  });
}
/* update() takes paths as its keys, so a slash is fine there — but only as a
   separator, and every segment still has to be a legal key. */
function checkUpdatePath(p) {
  const segs = String(p).split('/');
  if (!segs.length || segs.some(x => x === '' || /[.$#[\]]/.test(x)))
    throw new Error('Invalid path "' + p + '" in update');
}

const listeners = [];
function fire() { listeners.slice().forEach(l => l.cb(snap(getPath(l.path)))); }
function snap(v) { return { val: () => clone(v), exists: () => v !== null && v !== undefined }; }

const queued = [];
function online() { return getPath('.info/connected') === true; }
function commit(apply) {
  window.__writes = (window.__writes || 0) + 1;
  if (!online()) return new Promise(res => queued.push({ apply, res }));
  apply(); fire(); return Promise.resolve();
}

function Ref(path) {
  return {
    _path: path,
    once() { window.__reads = (window.__reads || 0) + 1; return Promise.resolve(snap(getPath(path))); },
    on(ev, cb) { listeners.push({ path, cb }); cb(snap(getPath(path))); return cb; },
    off() { for (let i = listeners.length - 1; i >= 0; i--) if (listeners[i].path === path) listeners.splice(i, 1); },
    set(v) { checkKeys(v, 'set at ' + path); return commit(() => setPath(path, v)); },
    update(obj) {
      Object.keys(obj).forEach(k => { checkUpdatePath(k); checkKeys(obj[k], 'update of ' + path + '/' + k); });
      return commit(() => Object.keys(obj).forEach(k => setPath(path + '/' + k, obj[k])));
    }
  };
}

window.__queuedWrites = () => queued.length;
window.__setOnline = function (v) {
  setPath('.info/connected', v); fire();
  if (v) { const q = queued.splice(0); q.forEach(x => x.apply()); fire(); q.forEach(x => x.res()); }
};

window.firebase = {
  apps: [],
  initializeApp() { this.apps.push({}); return {}; },
  database() { return { ref: p => Ref(p) }; }
};
