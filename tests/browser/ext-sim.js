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
    // Fake hosts helper: ?hosts=missing | cancel | (default) works.
    async native(message) {
      const mode = params.get('hosts');
      if (mode === 'missing') throw new Error('Specified native messaging host not found.');
      const lines = (window.simHosts = window.simHosts || [
        { line: 5, ip: '127.0.0.1', hosts: [new URL(SITE).hostname], active: (params.get('env') || 'local') === 'local' },
        { line: 4, ip: '127.0.0.1', hosts: ['echoengineers.phrsandbox.dev'], active: false },
      ]);
      if (message.type === 'list') return { ok: true, entries: lines };
      if (mode === 'cancel') return { ok: false, error: 'CANCELLED' };
      const entry = lines.find((l) => l.hosts.includes(message.host));
      entry.active = message.local;
      log.push(`hosts ${message.host} -> ${message.local ? 'local' : 'server'}`);
      return { ok: true, changed: true, affected: entry.hosts, entries: lines };
    },
  });

  window.simReady = (async () => {
    const mode = params.get('state') || 'list';
    if (mode === 'new') return;
    window.simRecoveryKey = (await service.setup('test-master-pw')).recoveryKey;
    if (mode === 'na') {
      await service.addEntry({ origin: SITE, env: 'na', username: 'aloka.pa@example.test', password: 'fixture-pw-5', note: 'work account' });
      await service.addEntry({ origin: SITE, env: 'na', username: 'second@example.test', password: 'fixture-pw-6' });
    } else if (mode !== 'empty') {
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
    tabs: {
      query: async () => [TAB],
      update: async (id, props) => { log.push(`tab ${id} -> ${props.url}`); },
      reload: async (id) => { log.push(`tab ${id} reloaded`); },
    },
  };
  window.close = () => log.push('popup closed');
})();
