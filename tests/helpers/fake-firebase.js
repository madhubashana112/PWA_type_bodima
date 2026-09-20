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
    set(v) { return commit(() => setPath(path, v)); },
    update(obj) { return commit(() => Object.keys(obj).forEach(k => setPath(path + '/' + k, obj[k]))); }
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
