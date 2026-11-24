import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLib } from './helpers/loadLib.mjs';
import { createFakeStorage } from './helpers/fakeStorage.mjs';

const DLV = await loadLib('env', 'crypto', 'vault', 'exportFile', 'service');
const SITE = 'https://hrmmainphdev01.phrsandbox.dev';
const SECRET = 'S3cret-Pässwörd';

function make({ local = createFakeStorage(), session = createFakeStorage(), clock = { t: Date.parse('2026-11-24T08:00:00Z') } } = {}) {
  const service = new DLV.VaultService({ local, session, now: () => new Date(clock.t), iterations: 1000 });
  return { service, local, session, clock };
}

async function ready(opts) {
  const ctx = make(opts);
  await ctx.service.setup('master pw');
  return ctx;
}

test('setup then status unlocked', async () => {
  const { service } = make();
  assert.deepEqual(await service.status(), { initialized: false, unlocked: false });
  await service.setup('master pw');
  assert.deepEqual(await service.status(), { initialized: true, unlocked: true });
  await assert.rejects(service.setup('again'));
});

test('unlock with wrong password returns false and stays locked', async () => {
  const { service } = await ready();
  await service.lock();
  assert.equal(await service.unlock('nope'), false);
  assert.deepEqual(await service.status(), { initialized: true, unlocked: false });
  await assert.rejects(service.getVault(), DLV.VaultService.LockedError);
  assert.equal(await service.unlock('master pw'), true);
});

test('vault on disk never contains the password text', async () => {
  const { service, local } = await ready();
  await service.addEntry({ origin: SITE, env: 'local', username: 'ava', password: SECRET });
  const disk = JSON.stringify(local.dump());
  assert.ok(!disk.includes(SECRET));
  assert.ok(!disk.includes('ava'));
});

test('lock removes key and pendings', async () => {
  const { service, session } = await ready();
  await service.setTabEnv(7, SITE, '127.0.0.1');
  await service.putPending(7, { origin: SITE, username: 'ava', password: SECRET });
  await service.lock();
  const keys = Object.keys(session.dump());
  assert.ok(!keys.includes('keyB64'));
  assert.ok(!keys.some((k) => k.startsWith('pending:')));
});

test('new service instance resumes unlocked state and pending login', async () => {
  const first = await ready();
  await first.service.setTabEnv(7, SITE, '127.0.0.1');
  await first.service.putPending(7, { origin: SITE, username: 'ava', password: SECRET });
  const second = make({ local: first.local, session: first.session, clock: first.clock });
  assert.deepEqual(await second.service.status(), { initialized: true, unlocked: true });
  assert.equal((await second.service.getPending(7)).kind, 'save');
  await second.service.savePending(7);
  assert.equal((await second.service.listForSite(SITE, 'local')).current.length, 1);
});

test('pending expires after 120 s', async () => {
  const { service, clock } = await ready();
  await service.setTabEnv(7, SITE, '127.0.0.1');
  await service.putPending(7, { origin: SITE, username: 'ava', password: SECRET });
  clock.t += 119_000;
  assert.ok(await service.getPending(7));
  clock.t += 2_000;
  assert.equal(await service.getPending(7), null);
});

test('getPending never exposes the password', async () => {
  const { service } = await ready();
  await service.setTabEnv(7, SITE, '127.0.0.1');
  await service.putPending(7, { origin: SITE, username: 'ava', password: SECRET });
  const pending = await service.getPending(7);
  assert.ok(!JSON.stringify(pending).includes(SECRET));
  assert.equal(pending.username, 'ava');
  assert.equal(pending.env, 'local');
  assert.deepEqual(pending.labels, { local: 'Local IIS', remote: 'Server', na: 'N/A' });
});

test('pending is "update" for known username with new password', async () => {
  const { service } = await ready();
  await service.addEntry({ origin: SITE, env: 'local', username: 'ava', password: 'old' });
  await service.setTabEnv(7, SITE, '127.0.0.1');
  await service.putPending(7, { origin: SITE, username: 'ava', password: 'new' });
  assert.equal((await service.getPending(7)).kind, 'update');
});

test('pending for an already saved login is dropped', async () => {
  const { service } = await ready();
  await service.addEntry({ origin: SITE, env: 'local', username: 'ava', password: SECRET });
  await service.setTabEnv(7, SITE, '127.0.0.1');
  await service.putPending(7, { origin: SITE, username: 'ava', password: SECRET });
  assert.equal(await service.getPending(7), null);
});

test('pending for unknown env requires env on save', async () => {
  const { service } = await ready();
  await service.addEntry({ origin: SITE, env: 'local', username: 'someone', password: 'x' }); // hosting matters here
  await service.putPending(7, { origin: SITE, username: 'ava', password: SECRET });
  assert.equal((await service.getPending(7)).env, 'unknown');
  await assert.rejects(service.savePending(7), DLV.VaultService.EnvRequiredError);
  await service.savePending(7, 'remote');
  assert.equal((await service.listForSite(SITE, 'remote')).current.length, 1);
});

test('environment comes from the latest response only', async () => {
  const { service } = await ready();
  await service.setTabEnv(7, SITE, '127.0.0.1');
  assert.equal(await service.getTabEnv(7, SITE), 'local');
  await service.setTabEnv(7, SITE, undefined);
  assert.equal(await service.getTabEnv(7, SITE), 'unknown');
  await service.setTabEnv(7, SITE, '52.1.2.3');
  assert.equal(await service.getTabEnv(7, SITE), 'remote');
  assert.equal(await service.getTabEnv(8, SITE), 'unknown');
});

test('locked pending reports kind locked and saves after unlock', async () => {
  const { service } = await ready();
  await service.lock();
  await service.setTabEnv(7, SITE, '127.0.0.1');
  await service.putPending(7, { origin: SITE, username: 'ava', password: SECRET });
  assert.equal((await service.getPending(7)).kind, 'locked');
  await assert.rejects(service.savePending(7), DLV.VaultService.LockedError);
  await service.unlock('master pw');
  assert.equal((await service.getPending(7)).kind, 'save');
  await service.savePending(7);
  assert.equal((await service.listForSite(SITE, 'local')).current[0].username, 'ava');
});

test('never for pending stops later prompts', async () => {
  const { service } = await ready();
  await service.setTabEnv(7, SITE, '127.0.0.1');
  await service.putPending(7, { origin: SITE, username: 'ava', password: SECRET });
  await service.neverForPending(7);
  await service.putPending(7, { origin: SITE, username: 'bob', password: SECRET });
  assert.equal(await service.getPending(7), null);
});

test('dismissPending removes it', async () => {
  const { service } = await ready();
  await service.putPending(7, { origin: SITE, username: 'ava', password: SECRET });
  await service.dismissPending(7);
  assert.equal(await service.getPending(7), null);
});

test('step-1 username pairs with the step-2 password', async () => {
  const { service } = await ready();
  await service.setTabEnv(7, SITE, '127.0.0.1');
  await service.rememberStep1User(7, SITE, 'ava@qa.test');
  await service.putPending(7, { origin: SITE, username: '', password: SECRET });
  assert.equal((await service.getPending(7)).username, 'ava@qa.test');
});

test('step-1 username is cleared when the pending login is dismissed', async () => {
  const { service } = await ready();
  await service.rememberStep1User(7, SITE, 'ava@qa.test');
  await service.putPending(7, { origin: SITE, username: '', password: SECRET });
  await service.dismissPending(7);
  assert.equal(await service.takeStep1User(7, SITE), null);
});

test('listForSite hides passwords and includes labels', async () => {
  const { service } = await ready();
  await service.addEntry({ origin: SITE, env: 'local', username: 'ava', password: SECRET, note: 'admin' });
  await service.addEntry({ origin: SITE, env: 'remote', username: 'srv', password: SECRET });
  await service.setLabel(SITE, 'local', 'Local IIS – philippinesdev');
  const list = await service.listForSite(SITE, 'local');
  assert.ok(!JSON.stringify(list).includes(SECRET));
  assert.deepEqual(list.current.map((e) => [e.username, e.note, e.env]), [['ava', 'admin', 'local']]);
  assert.deepEqual(list.other.map((e) => e.username), ['srv']);
  assert.deepEqual(list.labels, { local: 'Local IIS – philippinesdev', remote: 'Server', na: 'N/A' });
});

test('getFillData refuses a different origin', async () => {
  const { service } = await ready();
  const { id } = await service.addEntry({ origin: SITE, env: 'local', username: 'ava', password: SECRET });
  await assert.rejects(service.getFillData(id, 'https://evil.test'), DLV.VaultService.OriginMismatchError);
  assert.deepEqual(await service.getFillData(id, SITE), { username: 'ava', password: SECRET });
});

test('getFillData marks the entry used', async () => {
  const { service, clock } = await ready();
  const a = await service.addEntry({ origin: SITE, env: 'local', username: 'a', password: 'x' });
  await service.addEntry({ origin: SITE, env: 'local', username: 'b', password: 'x' });
  clock.t += 60_000;
  await service.getFillData(a.id, SITE);
  assert.deepEqual((await service.listForSite(SITE, 'local')).current.map((e) => e.username), ['a', 'b']);
});

test('update and delete entries', async () => {
  const { service } = await ready();
  const { id } = await service.addEntry({ origin: SITE, env: 'local', username: 'ava', password: 'x' });
  await service.updateEntry(id, { password: 'y', note: 'n' });
  assert.deepEqual(await service.getFillData(id, SITE), { username: 'ava', password: 'y' });
  await service.deleteEntry(id);
  assert.equal((await service.listForSite(SITE, 'local')).current.length, 0);
});

test('settings are stored in the vault', async () => {
  const { service } = await ready();
  assert.deepEqual(await service.getSettings(), { autoLockMinutes: 30, submitAfterFill: false });
  await service.setSettings({ submitAfterFill: true });
  assert.deepEqual(await service.getSettings(), { autoLockMinutes: 30, submitAfterFill: true });
});

test('changePassword re-locks the vault key, old password fails', async () => {
  const { service, local } = await ready();
  await service.addEntry({ origin: SITE, env: 'local', username: 'ava', password: 'x' });
  const oldSalt = local.dump().vaultBox.wraps.password.salt;
  assert.equal(await service.changePassword('wrong', 'new pw'), false);
  assert.equal(await service.changePassword('master pw', 'new pw'), true);
  assert.notEqual(local.dump().vaultBox.wraps.password.salt, oldSalt);
  await service.lock();
  assert.equal(await service.unlock('master pw'), false);
  assert.equal(await service.unlock('new pw'), true);
  assert.equal((await service.listForSite(SITE, 'local')).current.length, 1);
});

test('import merges and reports counts', async () => {
  const { service } = await ready();
  await service.addEntry({ origin: SITE, env: 'local', username: 'ava', password: 'x' });
  const other = await ready();
  await other.service.addEntry({ origin: SITE, env: 'remote', username: 'srv', password: 'y' });
  const counts = await service.importVault(await other.service.exportVaultPlain());
  assert.deepEqual(counts, { added: 1, updated: 0, unchanged: 0 });
  assert.equal((await service.listForSite(SITE, 'remote')).current.length, 1);
});

test('failed import leaves vault untouched', async () => {
  const { service, local } = await ready();
  await service.addEntry({ origin: SITE, env: 'local', username: 'ava', password: 'x' });
  const before = JSON.stringify(local.dump());
  await assert.rejects(service.importVault({ hello: 1 }), DLV.exportFile.InvalidFileError);
  await assert.rejects(service.importVault({ version: 1, entries: [{ origin: SITE }], neverSave: [], envLabels: {} }), DLV.exportFile.InvalidFileError);
  assert.equal(JSON.stringify(local.dump()), before);
});

test('concurrent changes are all kept', async () => {
  const { service } = await ready();
  await Promise.all(['a', 'b', 'c', 'd'].map((u) => service.addEntry({ origin: SITE, env: 'local', username: u, password: 'x' })));
  assert.equal((await service.listForSite(SITE, 'local')).current.length, 4);
});

test('clearTab forgets the tab', async () => {
  const { service, session } = await ready();
  await service.setTabEnv(7, SITE, '127.0.0.1');
  await service.putPending(7, { origin: SITE, username: 'ava', password: SECRET });
  await service.rememberStep1User(7, SITE, 'x');
  await service.clearTab(7);
  assert.deepEqual(Object.keys(session.dump()), ['keyB64']);
});

test('deleteAll clears everything', async () => {
  const { service, local, session } = await ready();
  await service.deleteAll();
  assert.deepEqual(local.dump(), {});
  assert.deepEqual(session.dump(), {});
  assert.deepEqual(await service.status(), { initialized: false, unlocked: false });
});

test('a duplicate capture with an empty username keeps the step-1 username', async () => {
  const { service } = await ready();
  await service.setTabEnv(7, SITE, '127.0.0.1');
  await service.rememberStep1User(7, SITE, 'ava@qa.test');
  await Promise.all([
    service.putPending(7, { origin: SITE, username: '', password: SECRET }),
    service.putPending(7, { origin: SITE, username: '', password: SECRET }),
  ]);
  await service.putPending(7, { origin: SITE, username: '', password: SECRET });
  assert.equal((await service.getPending(7)).username, 'ava@qa.test');
});

test('an empty-username capture never replaces a named pending login', async () => {
  const { service } = await ready();
  await service.setTabEnv(7, SITE, '127.0.0.1');
  await service.putPending(7, { origin: SITE, username: 'ava', password: SECRET });
  await service.putPending(7, { origin: SITE, username: '', password: SECRET });
  assert.equal((await service.getPending(7)).username, 'ava');
});

test('step-1 username is cleared once the login is saved', async () => {
  const { service } = await ready();
  await service.setTabEnv(7, SITE, '127.0.0.1');
  await service.rememberStep1User(7, SITE, 'ava@qa.test');
  await service.putPending(7, { origin: SITE, username: '', password: SECRET });
  await service.savePending(7);
  assert.equal(await service.takeStep1User(7, SITE), null);
});

test('unlock racing a password change leaves a working vault', async () => {
  const session = createFakeStorage();
  const { service } = await ready({ session });
  await service.lock();
  // The unlock starts first but its key write is slow, so without serialising it would land after the password change.
  const realSet = session.set.bind(session);
  let first = true;
  session.set = async (obj) => {
    if ('keyB64' in obj && first) { first = false; await new Promise((r) => setTimeout(r, 200)); }
    return realSet(obj);
  };
  const unlocking = service.unlock('master pw');
  await new Promise((r) => setTimeout(r, 20));
  await Promise.all([unlocking, service.changePassword('master pw', 'new pw')]);
  assert.equal((await service.status()).unlocked, true);
  await service.addEntry({ origin: SITE, env: 'local', username: 'ava', password: 'x' });
  await service.lock();
  assert.equal(await service.unlock('new pw'), true);
});

test('import rejects entries with bad field types or a non-origin site', async () => {
  const { service, local } = await ready();
  const before = JSON.stringify(local.dump());
  const entry = { id: 'x', origin: SITE, env: 'local', username: 'a', password: 'p', note: '', createdAt: 'a', updatedAt: 'a', lastUsedAt: 'a' };
  const bad = [
    { ...entry, lastUsedAt: 5 },
    { ...entry, note: { x: 1 } },
    { ...entry, origin: 'not a url' },
    { ...entry, origin: SITE + '/hr/login' },
  ];
  for (const e of bad) {
    await assert.rejects(service.importVault({ version: 1, entries: [e], neverSave: [], envLabels: {} }), DLV.exportFile.InvalidFileError, JSON.stringify(e));
  }
  await assert.rejects(service.importVault({ version: 1, entries: [], neverSave: ['nope'], envLabels: {} }), DLV.exportFile.InvalidFileError);
  await assert.rejects(service.importVault({ version: 1, entries: [], neverSave: [], envLabels: { 'bad': { local: 'x' } } }), DLV.exportFile.InvalidFileError);
  await assert.rejects(service.importVault({ version: 1, entries: [], neverSave: [], envLabels: { [SITE]: { local: 7 } } }), DLV.exportFile.InvalidFileError);
  assert.equal(JSON.stringify(local.dump()), before);
});

test('signing in with an already saved login moves it to the top', async () => {
  const { service, clock } = await ready();
  await service.addEntry({ origin: SITE, env: 'local', username: 'a', password: 'pa' });
  clock.t += 1_000;
  await service.addEntry({ origin: SITE, env: 'local', username: 'b', password: 'pb' });
  assert.deepEqual((await service.listForSite(SITE, 'local')).current.map((e) => e.username), ['b', 'a']);
  clock.t += 60_000;
  await service.setTabEnv(7, SITE, '127.0.0.1');
  await service.putPending(7, { origin: SITE, username: 'a', password: 'pa' });
  assert.equal(await service.getPending(7), null);
  assert.deepEqual((await service.listForSite(SITE, 'local')).current.map((e) => e.username), ['a', 'b']);
});

test('with an unknown environment an already saved login is not offered again', async () => {
  const { service } = await ready();
  await service.addEntry({ origin: SITE, env: 'remote', username: 'srv', password: 'p' });
  await service.putPending(7, { origin: SITE, username: 'srv', password: 'p' });
  assert.equal(await service.getPending(7), null);
  await service.putPending(7, { origin: SITE, username: 'srv', password: 'changed' });
  assert.equal((await service.getPending(7)).kind, 'save');
});

test('a site with no Local/Server logins defaults new saves to N/A and hides the environment', async () => {
  const { service } = await ready();
  const WEB = 'https://login.microsoftonline.com';
  await service.setTabEnv(7, WEB, '20.190.1.1');
  await service.putPending(7, { origin: WEB, username: 'aloka', password: SECRET });
  assert.equal((await service.getPending(7)).env, 'na');
  assert.equal((await service.listForSite(WEB, 'remote')).envMatters, false);
  await service.savePending(7, 'na');
  await service.setTabEnv(8, WEB, '20.190.1.2');
  await service.putPending(8, { origin: WEB, username: 'aloka', password: SECRET });
  assert.equal(await service.getPending(8), null);
  const list = await service.listForSite(WEB, 'remote');
  assert.deepEqual(list.current.map((e) => [e.username, e.env]), [['aloka', 'na']]);
  assert.equal(list.labels.na, 'N/A');
});

test('a site served from this computer, or with Local/Server logins, keeps its environment', async () => {
  const { service } = await ready();
  await service.setTabEnv(7, SITE, '127.0.0.1');
  await service.putPending(7, { origin: SITE, username: 'ava', password: SECRET });
  assert.equal((await service.getPending(7)).env, 'local');
  assert.equal((await service.listForSite(SITE, 'local')).envMatters, true);
  await service.addEntry({ origin: 'https://qa.test', env: 'remote', username: 'q', password: 'x' });
  await service.setTabEnv(9, 'https://qa.test', '52.1.2.3');
  await service.putPending(9, { origin: 'https://qa.test', username: 'other', password: SECRET });
  assert.equal((await service.getPending(9)).env, 'remote');
  assert.equal((await service.listForSite('https://qa.test', 'remote')).envMatters, true);
});

test('updating the password of an N/A login keeps it N/A', async () => {
  const { service } = await ready();
  await service.addEntry({ origin: SITE, env: 'na', username: 'ava', password: 'old' });
  await service.addEntry({ origin: SITE, env: 'remote', username: 'srv', password: 'x' });
  await service.setTabEnv(7, SITE, '52.1.2.3');
  await service.putPending(7, { origin: SITE, username: 'ava', password: 'new' });
  const p = await service.getPending(7);
  assert.deepEqual([p.kind, p.env], ['update', 'na']);
  await service.savePending(7, p.env);
  const list = await service.listForSite(SITE, 'remote');
  assert.deepEqual(list.current.map((e) => [e.username, e.env]).sort(), [['ava', 'na'], ['srv', 'remote']]);
});

test('import accepts N/A logins', async () => {
  const { service } = await ready();
  const entry = { id: 'x', origin: SITE, env: 'na', username: 'a', password: 'p', note: '', createdAt: 'a', updatedAt: 'a', lastUsedAt: 'a' };
  assert.deepEqual(await service.importVault({ version: 1, entries: [entry], neverSave: [], envLabels: {} }), { added: 1, updated: 0, unchanged: 0 });
});

// ---- Recovery key ----

const RECOVERY_FORMAT = /^DLV(-[0-9A-HJKMNP-TV-Z]{4}){8}$/;

test('setup returns a recovery key', async () => {
  const { service } = make();
  const { recoveryKey } = await service.setup('master pw');
  assert.match(recoveryKey, RECOVERY_FORMAT);
  assert.equal((await service.recoveryStatus()).hasRecoveryKey, true);
});

test('the recovery key unlocks the vault and sets a new master password', async () => {
  const { service } = make();
  const { recoveryKey } = await service.setup('master pw');
  await service.addEntry({ origin: SITE, env: 'local', username: 'ava', password: SECRET });
  await service.lock();
  assert.equal(await service.recoverWithKey(recoveryKey.toLowerCase().replace(/-/g, ' '), 'new pw'), true);
  assert.equal((await service.status()).unlocked, true);
  assert.equal((await service.listForSite(SITE, 'local')).current[0].username, 'ava');
  await service.lock();
  assert.equal(await service.unlock('master pw'), false);
  assert.equal(await service.unlock('new pw'), true);
});

test('a wrong recovery key changes nothing', async () => {
  const { service, local } = make();
  await service.setup('master pw');
  await service.lock();
  const before = JSON.stringify(local.dump());
  assert.equal(await service.recoverWithKey(DLV.crypto.newRecoveryKey(), 'new pw'), false);
  assert.equal(await service.recoverWithKey('nonsense', 'new pw'), false);
  assert.equal((await service.status()).unlocked, false);
  assert.equal(JSON.stringify(local.dump()), before);
  assert.equal(await service.unlock('master pw'), true);
});

test('changing the master password keeps the recovery key working', async () => {
  const { service } = make();
  const { recoveryKey } = await service.setup('master pw');
  assert.equal(await service.changePassword('master pw', 'second pw'), true);
  await service.lock();
  assert.equal(await service.recoverWithKey(recoveryKey, 'third pw'), true);
});

test('a new recovery key replaces the old one and needs an unlocked vault', async () => {
  const { service } = make();
  const { recoveryKey: oldKey } = await service.setup('master pw');
  const newKey = await service.createRecoveryKey();
  assert.notEqual(newKey, oldKey);
  await service.lock();
  await assert.rejects(service.createRecoveryKey(), DLV.VaultService.LockedError);
  assert.equal(await service.recoverWithKey(oldKey, 'x pw'), false);
  assert.equal(await service.recoverWithKey(newKey, 'x pw'), true);
});

test('neither the recovery key nor the vault key is stored readable', async () => {
  const { service, local, session } = make();
  const { recoveryKey } = await service.setup('master pw');
  const disk = JSON.stringify(local.dump());
  assert.ok(!disk.includes(DLV.crypto.normalizeRecoveryKey(recoveryKey)));
  assert.ok(!disk.includes(recoveryKey));
  assert.ok(!disk.includes(session.dump().keyB64));
});

test('a vault saved by the earlier version is upgraded on unlock without losing logins', async () => {
  const local = createFakeStorage();
  const salt = DLV.crypto.randomSaltB64();
  const oldKey = await DLV.crypto.deriveKey('master pw', salt, 1000);
  const oldVault = DLV.vault.upsertLogin(DLV.vault.emptyVault(), { origin: SITE, env: 'local', username: 'ava', password: SECRET }, '2026-11-24T08:00:00.000Z').vault;
  await local.set({ vaultBox: { salt, iterations: 1000, ...(await DLV.crypto.encryptJson(oldKey, oldVault)) } });

  const { service } = make({ local });
  assert.deepEqual(await service.status(), { initialized: true, unlocked: false });
  assert.equal(await service.unlock('wrong'), false);
  assert.equal(await service.unlock('master pw'), true);
  assert.equal((await service.listForSite(SITE, 'local')).current[0].username, 'ava');
  assert.equal(local.dump().vaultBox.version, 2);
  assert.equal((await service.recoveryStatus()).hasRecoveryKey, false);
  const key = await service.createRecoveryKey();
  await service.lock();
  assert.equal(await service.recoverWithKey(key, 'new pw'), true);
  assert.equal((await service.listForSite(SITE, 'local')).current[0].username, 'ava');
});

test('an upgraded vault without a recovery key cannot be recovered', async () => {
  const local = createFakeStorage();
  const salt = DLV.crypto.randomSaltB64();
  const oldKey = await DLV.crypto.deriveKey('master pw', salt, 1000);
  await local.set({ vaultBox: { salt, iterations: 1000, ...(await DLV.crypto.encryptJson(oldKey, DLV.vault.emptyVault())) } });
  const { service } = make({ local });
  assert.equal(await service.recoverWithKey(DLV.crypto.newRecoveryKey(), 'new pw'), false);
  assert.equal(await service.unlock('master pw'), true);
});

// ---- Environment banner ----

test('banner shows the environment name on sites where hosting matters', async () => {
  const { service } = await ready();
  await service.addEntry({ origin: SITE, env: 'local', username: 'ava', password: 'x' });
  await service.setLabel(SITE, 'local', 'Local IIS – philippinesdev');
  await service.setLabel(SITE, 'remote', 'Server – hrmmain_philippines (read-only)');
  await service.setTabEnv(7, SITE, '127.0.0.1');
  assert.deepEqual(await service.bannerInfo(7, SITE), { env: 'local', label: 'Local IIS – philippinesdev' });
  await service.setTabEnv(7, SITE, '52.1.2.3');
  assert.deepEqual(await service.bannerInfo(7, SITE), { env: 'remote', label: 'Server – hrmmain_philippines (read-only)' });
  await service.setTabEnv(7, SITE, null);
  assert.deepEqual(await service.bannerInfo(7, SITE), { env: 'unknown', label: 'Environment unknown – reload the page' });
});

test('no banner on ordinary sites', async () => {
  const { service } = await ready();
  const WEB = 'https://login.microsoftonline.com';
  await service.addEntry({ origin: WEB, env: 'na', username: 'a', password: 'x' });
  await service.setTabEnv(7, WEB, '20.190.1.1');
  assert.equal(await service.bannerInfo(7, WEB), null);
});

test('while locked the banner only shows pages served from this computer, with the default name', async () => {
  const { service } = await ready();
  await service.addEntry({ origin: SITE, env: 'local', username: 'ava', password: 'x' });
  await service.setLabel(SITE, 'local', 'Local IIS – philippinesdev');
  await service.lock();
  await service.setTabEnv(7, SITE, '127.0.0.1');
  assert.deepEqual(await service.bannerInfo(7, SITE), { env: 'local', label: 'Local IIS' });
  await service.setTabEnv(7, SITE, '52.1.2.3');
  assert.equal(await service.bannerInfo(7, SITE), null);
});

test('the banner can be turned off', async () => {
  const { service } = await ready();
  await service.setSettings({ showBanner: false });
  await service.setTabEnv(7, SITE, '127.0.0.1');
  assert.equal(await service.bannerInfo(7, SITE), null);
});
