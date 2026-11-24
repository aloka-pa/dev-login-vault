import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLib } from './helpers/loadLib.mjs';

const DLV = await loadLib('crypto');
const C = DLV.crypto;
const FAST = 1000;

test('round-trips an object', async () => {
  const key = await C.deriveKey('master pw', C.randomSaltB64(), FAST);
  const box = await C.encryptJson(key, { a: 1, list: ['x'] });
  assert.deepEqual(await C.decryptJson(key, box), { a: 1, list: ['x'] });
});

test('round-trips unicode and long secrets', async () => {
  const key = await C.deriveKey('Pässwörd 🔒 ', C.randomSaltB64(), FAST);
  const value = { p: 'Pässwörd 🔒 ', long: 'ab'.repeat(600) };
  assert.deepEqual(await C.decryptJson(key, await C.encryptJson(key, value)), value);
});

test('wrong password throws WrongPasswordError', async () => {
  const salt = C.randomSaltB64();
  const box = await C.encryptJson(await C.deriveKey('right', salt, FAST), { a: 1 });
  const wrong = await C.deriveKey('wrong', salt, FAST);
  await assert.rejects(C.decryptJson(wrong, box), C.WrongPasswordError);
});

test('two encryptions of the same value use different IVs', async () => {
  const key = await C.deriveKey('pw', C.randomSaltB64(), FAST);
  const a = await C.encryptJson(key, { a: 1 });
  const b = await C.encryptJson(key, { a: 1 });
  assert.notEqual(a.iv, b.iv);
  assert.equal(Buffer.from(a.iv, 'base64').length, 12);
});

test('salt is 16 random bytes', () => {
  assert.equal(Buffer.from(C.randomSaltB64(), 'base64').length, 16);
  assert.notEqual(C.randomSaltB64(), C.randomSaltB64());
});

test('exported key re-imports and decrypts', async () => {
  const key = await C.deriveKey('pw', C.randomSaltB64(), FAST);
  const box = await C.encryptJson(key, { ok: true });
  const again = await C.importKeyB64(await C.exportKeyB64(key));
  assert.deepEqual(await C.decryptJson(again, box), { ok: true });
});

test('default iterations is 600000 and derivation uses it', async () => {
  assert.equal(C.ITERATIONS, 600000);
  const salt = C.randomSaltB64();
  const byDefault = await C.exportKeyB64(await C.deriveKey('pw', salt));
  const explicit = await C.exportKeyB64(await C.deriveKey('pw', salt, 600000));
  assert.equal(byDefault, explicit);
});
