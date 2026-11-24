import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadLib } from './helpers/loadLib.mjs';
import { createFakeStorage } from './helpers/fakeStorage.mjs';

const DLV = await loadLib('env', 'crypto', 'vault', 'exportFile', 'service');
vm.runInThisContext(readFileSync(new URL('../src/background/worker.js', import.meta.url), 'utf8'));

const SITE = 'https://hrmmainphdev01.phrsandbox.dev';
const tabSender = (url = SITE + '/hr/security/login', frameId = 0) => ({ id: 'ext', url, origin: new URL(url).origin, frameId, tab: { id: 7, url } });
const pageSender = { id: 'ext', url: 'chrome-extension://ext/src/popup/popup.html', origin: 'chrome-extension://ext' };
const optionsTabSender = {
  id: 'ext', url: 'chrome-extension://ext/src/options/options.html', origin: 'chrome-extension://ext', frameId: 0,
  tab: { id: 9, url: 'chrome-extension://ext/src/options/options.html' },
};

async function makeRouter() {
  const service = new DLV.VaultService({ local: createFakeStorage(), session: createFakeStorage(), iterations: 1000 });
  await service.setup('master pw');
  const calls = [];
  const deps = {
    tabUrl: async () => SITE + '/hr/security/login',
    injectFill: async (...args) => { calls.push(['fill', ...args]); return true; },
    setBadge: async (...args) => calls.push(['badge', ...args]),
    nudgeTopFrame: async (...args) => calls.push(['nudge', ...args]),
    applyIdle: async (...args) => calls.push(['idle', ...args]),
    extensionOrigin: 'chrome-extension://ext',
  };
  return { service, calls, route: DLV.createRouter(service, deps) };
}

test('router refuses page-only messages from a tab sender', async () => {
  const { route } = await makeRouter();
  for (const type of ['exportVaultPlain', 'importVault', 'changePassword', 'deleteAll', 'setup', 'unlock', 'listForSite', 'fill']) {
    assert.deepEqual(await route({ type }, tabSender()), { ok: false, error: 'FORBIDDEN' }, type);
  }
});

test('unknown type is refused', async () => {
  const { route } = await makeRouter();
  assert.deepEqual(await route({ type: 'nope' }, pageSender), { ok: false, error: 'UNKNOWN_MESSAGE' });
});

test('pendingCapture uses the sender origin, not the message', async () => {
  const { route, service } = await makeRouter();
  await route({ type: 'pendingCapture', origin: 'https://evil.test', username: 'ava', password: 'pw' }, tabSender());
  assert.equal((await service.getPending(7)).origin, SITE);
});

test('errors map to codes', async () => {
  const { route, service } = await makeRouter();
  await service.lock();
  assert.deepEqual(await route({ type: 'listForSite', origin: SITE, env: 'local' }, pageSender), { ok: false, error: 'LOCKED' });
  assert.deepEqual(await route({ type: 'unlock', password: 'bad' }, pageSender), { ok: true, data: false });
});

test('fill checks the tab origin and injects', async () => {
  const { route, service, calls } = await makeRouter();
  const { id } = await service.addEntry({ origin: SITE, env: 'local', username: 'ava', password: 'pw' });
  assert.deepEqual(await route({ type: 'fill', tabId: 7, id }, pageSender), { ok: true, data: true });
  assert.deepEqual(calls.find((c) => c[0] === 'fill'), ['fill', 7, 'ava', 'pw', SITE, false]);
  const other = await service.addEntry({ origin: 'https://other.test', env: 'local', username: 'x', password: 'y' });
  assert.deepEqual(await route({ type: 'fill', tabId: 7, id: other.id }, pageSender), { ok: false, error: 'ORIGIN_MISMATCH' });
});

test('back/forward page makes the environment unknown', async () => {
  const { route, service } = await makeRouter();
  await service.setTabEnv(7, SITE, '127.0.0.1');
  await route({ type: 'pageShown', backForward: true }, tabSender());
  assert.equal(await service.getTabEnv(7, SITE), 'unknown');
});

test('pendingForTab answers only the top frame', async () => {
  const { route } = await makeRouter();
  await route({ type: 'pendingCapture', username: 'ava', password: 'pw' }, tabSender());
  assert.deepEqual(await route({ type: 'pendingForTab' }, tabSender(undefined, 3)), { ok: true, data: null });
  assert.equal((await route({ type: 'pendingForTab' }, tabSender())).data.username, 'ava');
});

test('setSettings re-applies the idle lock interval', async () => {
  const { route, calls } = await makeRouter();
  await route({ type: 'setSettings', settings: { autoLockMinutes: 45 } }, pageSender);
  assert.deepEqual(calls.find((c) => c[0] === 'idle'), ['idle', 45]);
});

test('options page opened in a tab is treated as an extension page', async () => {
  const { route } = await makeRouter();
  assert.deepEqual(await route({ type: 'status' }, optionsTabSender), { ok: true, data: { initialized: true, unlocked: true } });
  assert.equal((await route({ type: 'exportVaultPlain' }, optionsTabSender)).ok, true);
});

test('a sender with no tab and a foreign origin is refused', async () => {
  const { route } = await makeRouter();
  assert.deepEqual(await route({ type: 'status' }, { id: 'ext', url: 'https://evil.test/', origin: 'https://evil.test' }), { ok: false, error: 'FORBIDDEN' });
});

test('fill targets only documents of the entry origin', () => {
  const results = [
    { frameId: 0, documentId: 'top', result: 'https://hrmmainphdev01.phrsandbox.dev' },
    { frameId: 3, documentId: 'ad', result: 'https://ads.example' },
    { frameId: 4, documentId: 'same', result: 'https://hrmmainphdev01.phrsandbox.dev' },
    { frameId: 5, documentId: 'gone', result: undefined },
  ];
  assert.deepEqual(DLV.matchingDocumentIds(results, 'https://hrmmainphdev01.phrsandbox.dev'), ['top', 'same']);
});

test('bar actions are accepted only from the top frame', async () => {
  const { route, service } = await makeRouter();
  await route({ type: 'pendingCapture', username: 'ava', password: 'pw' }, tabSender());
  for (const type of ['savePending', 'dismissPending', 'neverForPending']) {
    assert.deepEqual(await route({ type, env: 'local' }, tabSender(undefined, 3)), { ok: false, error: 'FORBIDDEN' }, type);
  }
  assert.ok(await service.getPending(7));
});

test('locking clears the "!" badges of waiting logins', async () => {
  const { route, service, calls } = await makeRouter();
  await service.lock();
  await route({ type: 'pendingCapture', username: 'ava', password: 'pw' }, tabSender());
  assert.deepEqual(calls.filter((c) => c[0] === 'badge').at(-1), ['badge', 7, '!']);
  await route({ type: 'lock' }, pageSender);
  assert.deepEqual(calls.filter((c) => c[0] === 'badge').at(-1), ['badge', 7, '']);
});

test('sweep clears the badge of an expired waiting login', async () => {
  const clock = { t: Date.parse('2026-11-24T08:00:00Z') };
  const service = new DLV.VaultService({ local: createFakeStorage(), session: createFakeStorage(), iterations: 1000, now: () => new Date(clock.t) });
  await service.setup('master pw');
  await service.lock();
  const calls = [];
  const route = DLV.createRouter(service, {
    tabUrl: async () => SITE, injectFill: async () => true, setBadge: async (...a) => calls.push(a),
    nudgeTopFrame: async () => {}, applyIdle: async () => {}, extensionOrigin: 'chrome-extension://ext',
  });
  await route({ type: 'pendingCapture', username: 'ava', password: 'pw' }, tabSender());
  clock.t += 121_000;
  await route.sweep();
  assert.deepEqual(calls.at(-1), [7, '']);
});

test('recovery messages work for extension pages only', async () => {
  const { route, service } = await makeRouter();
  for (const type of ['createRecoveryKey', 'recoveryStatus', 'recoverWithKey']) {
    assert.deepEqual(await route({ type }, tabSender()), { ok: false, error: 'FORBIDDEN' }, type);
  }
  const created = await route({ type: 'createRecoveryKey' }, pageSender);
  assert.equal(created.ok, true);
  assert.equal((await route({ type: 'recoveryStatus' }, pageSender)).data.hasRecoveryKey, true);
  await service.lock();
  assert.deepEqual(await route({ type: 'recoverWithKey', recoveryKey: 'wrong', newPassword: 'n' }, pageSender), { ok: true, data: false });
  assert.deepEqual(await route({ type: 'recoverWithKey', recoveryKey: created.data, newPassword: 'new pw' }, pageSender), { ok: true, data: true });
  assert.equal((await service.status()).unlocked, true);
});
