// Simulated extension backend for previewing the popup/options pages outside the browser's extension system.
// Uses the REAL VaultService + router with in-memory storage and test-only data. Load after src/lib/*.js and worker.js.
(function () {
  function memoryArea() {
    let data = {};
    const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    return {
      async get(keys) {
        if (keys == null) return clone(data);
        const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        const out = {};
        for (const k of list) if (k in data) out[k] = clone(data[k]);
        return out;
      },
      async set(obj) { for (const [k, v] of Object.entries(obj)) data[k] = clone(v); },
      async remove(keys) { for (const k of typeof keys === 'string' ? [keys] : keys) delete data[k]; },
      async clear() { data = {}; },
    };
  }

  const params = new URLSearchParams(parent !== window ? parent.location.search : location.search);
  const SITE = params.get('site') || 'https://hrmmainphdev01.phrsandbox.dev';
  const TAB = { id: 1, url: SITE + '/hr/security/login' };
  const service = new DLV.VaultService({ local: memoryArea(), session: memoryArea(), iterations: 1000 });
  const log = (window.simLog = []);
  const route = DLV.createRouter(service, {
    tabUrl: async () => TAB.url,
    injectFill: async (tabId, username) => { log.push(`filled ${username}`); return true; },
    setBadge: async () => {}, nudgeTopFrame: async () => {}, applyIdle: async () => {},
    extensionOrigin: location.origin,
  });

  window.simReady = (async () => {
    const mode = params.get('state') || 'list';
    if (mode === 'new') return;
    await service.setup('test-master-pw');
    if (mode !== 'empty') {
      await service.addEntry({ origin: SITE, env: 'local', username: '00001774', password: 'fixture-pw-1', note: 'Aloka (admin)' });
      await service.addEntry({ origin: SITE, env: 'local', username: 'ava.qa', password: 'fixture-pw-2' });
      await service.addEntry({ origin: SITE, env: 'remote', username: 'server.user', password: 'fixture-pw-3', note: 'read-only DB' });
      await service.setLabel(SITE, 'local', 'Local IIS – philippinesdev');
    }
    const ip = { local: '127.0.0.1', remote: '52.1.2.3' }[params.get('env') || 'local'];
    await service.setTabEnv(TAB.id, SITE, ip);
    if (mode === 'locked') await service.lock();
  })();

  window.chrome = {
    runtime: {
      id: 'sim',
      sendMessage: async (message) => { await window.simReady; return route(message, { id: 'sim', url: location.href, origin: location.origin }); },
      openOptionsPage: () => log.push('openOptionsPage'),
      onMessage: { addListener() {} },
    },
    tabs: { query: async () => [TAB] },
  };
  window.close = () => log.push('popup closed');
})();
