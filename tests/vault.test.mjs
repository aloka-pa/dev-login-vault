import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLib } from './helpers/loadLib.mjs';

const DLV = await loadLib('env', 'vault');
const V = DLV.vault;
const SITE = 'https://hrmmainphdev01.phrsandbox.dev';
const T1 = '2026-11-24T08:00:00.000Z';
const T2 = '2026-11-24T09:00:00.000Z';
const T3 = '2026-11-24T10:00:00.000Z';
const login = (o = {}) => ({ origin: SITE, env: 'local', username: 'ava', password: 'pw1', ...o });

function deepFreeze(o) {
  if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
  return o;
}

test('emptyVault has the default shape', () => {
  assert.deepEqual(V.emptyVault(), {
    version: 1, entries: [], neverSave: [], envLabels: {}, settings: { autoLockMinutes: 30, submitAfterFill: false },
  });
});

test('upsert adds then reports unchanged for same password', () => {
  const a = V.upsertLogin(V.emptyVault(), login(), T1);
  assert.equal(a.outcome, 'added');
  assert.equal(a.vault.entries.length, 1);
  assert.equal(a.entry.createdAt, T1);
  const b = V.upsertLogin(a.vault, login(), T2);
  assert.equal(b.outcome, 'unchanged');
  assert.equal(b.vault.entries.length, 1);
});

test('upsert with new password reports updated and keeps id', () => {
  const a = V.upsertLogin(V.emptyVault(), login(), T1);
  const b = V.upsertLogin(a.vault, login({ password: 'pw2' }), T2);
  assert.equal(b.outcome, 'updated');
  assert.equal(b.entry.id, a.entry.id);
  assert.equal(b.entry.password, 'pw2');
  assert.equal(b.entry.updatedAt, T2);
});

test('username is trimmed, match is case-sensitive', () => {
  const a = V.upsertLogin(V.emptyVault(), login({ username: '  ava  ' }), T1);
  assert.equal(a.entry.username, 'ava');
  assert.equal(V.upsertLogin(a.vault, login({ username: 'ava ' }), T2).outcome, 'unchanged');
  assert.equal(V.upsertLogin(a.vault, login({ username: 'Ava' }), T2).outcome, 'added');
});

test('origins differing by port or scheme are separate', () => {
  let v = V.upsertLogin(V.emptyVault(), login({ origin: 'http://localhost:5042' }), T1).vault;
  v = V.upsertLogin(v, login({ origin: 'https://localhost:7229' }), T1).vault;
  v = V.upsertLogin(v, login({ origin: 'https://localhost:5042' }), T1).vault;
  assert.equal(v.entries.length, 3);
  assert.equal(V.findForSite(v, 'http://localhost:5042', 'local').current.length, 1);
});

test('local and remote entries for the same origin are separate', () => {
  let v = V.upsertLogin(V.emptyVault(), login({ password: 'localpw' }), T1).vault;
  v = V.upsertLogin(v, login({ env: 'remote', password: 'serverpw' }), T1).vault;
  const local = V.findForSite(v, SITE, 'local');
  assert.deepEqual(local.current.map((e) => e.password), ['localpw']);
  assert.deepEqual(local.other.map((e) => e.password), ['serverpw']);
});

test('classifyPending: save, update, none, never', () => {
  const v = V.upsertLogin(V.emptyVault(), login(), T1).vault;
  assert.equal(V.classifyPending(v, login({ username: 'bob' })), 'save');
  assert.equal(V.classifyPending(v, login({ password: 'new' })), 'update');
  assert.equal(V.classifyPending(v, login()), 'none');
  assert.equal(V.classifyPending(v, login({ env: 'remote' })), 'save');
  assert.equal(V.classifyPending(V.addNeverSave(v, SITE), login({ username: 'bob' })), 'never');
});

test('classifyPending with unknown env is save unless never', () => {
  const v = V.upsertLogin(V.emptyVault(), login(), T1).vault;
  assert.equal(V.classifyPending(v, login({ env: 'unknown' })), 'save');
});

test('findForSite unknown env puts everything in other', () => {
  let v = V.upsertLogin(V.emptyVault(), login(), T1).vault;
  v = V.upsertLogin(v, login({ env: 'remote', username: 'srv' }), T1).vault;
  const r = V.findForSite(v, SITE, 'unknown');
  assert.equal(r.current.length, 0);
  assert.equal(r.other.length, 2);
});

test('findForSite sorts by lastUsedAt desc', () => {
  const v1 = V.upsertLogin(V.emptyVault(), login({ username: 'a' }), T1).vault;
  const b = V.upsertLogin(v1, login({ username: 'b' }), T1);
  const v = V.markUsed(b.vault, b.entry.id, T3);
  assert.deepEqual(V.findForSite(v, SITE, 'local').current.map((e) => e.username), ['b', 'a']);
});

test('updateEntry and removeEntry', () => {
  const a = V.upsertLogin(V.emptyVault(), login(), T1);
  const u = V.updateEntry(a.vault, a.entry.id, { note: 'QA admin', password: 'x', env: 'remote' }, T2);
  assert.equal(u.entries[0].note, 'QA admin');
  assert.equal(u.entries[0].env, 'remote');
  assert.equal(u.entries[0].updatedAt, T2);
  assert.equal(V.removeEntry(u, a.entry.id).entries.length, 0);
});

test('never-save add and remove', () => {
  const v = V.addNeverSave(V.addNeverSave(V.emptyVault(), SITE), SITE);
  assert.deepEqual(v.neverSave, [SITE]);
  assert.deepEqual(V.removeNeverSave(v, SITE).neverSave, []);
});

test('labelFor falls back to defaults; empty label resets', () => {
  let v = V.emptyVault();
  assert.equal(V.labelFor(v, SITE, 'local'), 'Local IIS');
  assert.equal(V.labelFor(v, SITE, 'remote'), 'Server');
  v = V.setLabel(v, SITE, 'local', 'Local IIS – philippinesdev');
  assert.equal(V.labelFor(v, SITE, 'local'), 'Local IIS – philippinesdev');
  assert.equal(V.labelFor(V.setLabel(v, SITE, 'local', '  '), SITE, 'local'), 'Local IIS');
});

test('merge: newer wins, older ignored, new added, none removed, counts correct', () => {
  const base = V.upsertLogin(V.emptyVault(), login({ username: 'a', password: 'old' }), T2);
  let local = V.upsertLogin(base.vault, login({ username: 'keep' }), T2).vault;
  let incoming = V.upsertLogin(V.emptyVault(), login({ username: 'a', password: 'newer' }), T3).vault;
  incoming = V.upsertLogin(incoming, login({ username: 'keep', password: 'older' }), T1).vault;
  incoming = V.upsertLogin(incoming, login({ username: 'fresh' }), T1).vault;
  incoming = V.setLabel(V.addNeverSave(incoming, 'https://x.test'), SITE, 'local', 'Imported label');
  local = V.setLabel(local, SITE, 'remote', 'Mine');

  const { vault, counts } = V.mergeVaults(local, incoming);
  assert.deepEqual(counts, { added: 1, updated: 1, unchanged: 1 });
  const byName = Object.fromEntries(vault.entries.map((e) => [e.username, e.password]));
  assert.deepEqual(byName, { a: 'newer', keep: 'pw1', fresh: 'pw1' });
  assert.deepEqual(vault.neverSave, ['https://x.test']);
  assert.equal(V.labelFor(vault, SITE, 'local'), 'Imported label');
  assert.equal(V.labelFor(vault, SITE, 'remote'), 'Mine');
  assert.deepEqual(vault.settings, local.settings);
});

test('functions do not mutate input', () => {
  const a = V.upsertLogin(V.emptyVault(), login(), T1);
  const frozen = deepFreeze(structuredClone(a.vault));
  const id = frozen.entries[0].id;
  V.upsertLogin(frozen, login({ password: 'z' }), T2);
  V.updateEntry(frozen, id, { note: 'n' }, T2);
  V.removeEntry(frozen, id);
  V.markUsed(frozen, id, T2);
  V.addNeverSave(frozen, SITE);
  V.setLabel(frozen, SITE, 'local', 'x');
  V.mergeVaults(frozen, deepFreeze(structuredClone(a.vault)));
});

test('merge gives an added entry a new id when its id is already used', () => {
  const a = V.upsertLogin(V.emptyVault(), login({ username: 'renamed' }), T1);
  const incoming = { ...a.vault, entries: [{ ...a.entry, username: 'original' }] };
  const { vault } = V.mergeVaults(a.vault, incoming);
  const ids = vault.entries.map((e) => e.id);
  assert.equal(vault.entries.length, 2);
  assert.equal(new Set(ids).size, 2);
});
