import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLib } from './helpers/loadLib.mjs';

const DLV = await loadLib('env', 'crypto', 'vault', 'exportFile');
const X = DLV.exportFile;
const FAST = 1000;

const sample = () =>
  DLV.vault.upsertLogin(DLV.vault.emptyVault(),
    { origin: 'https://qa.test', env: 'remote', username: 'üser', password: 'Pässwörd 🔒 ' + 'x'.repeat(1100) },
    '2026-11-24T08:00:00.000Z').vault;

test('export round-trips unicode', async () => {
  const vault = sample();
  const text = await X.build(vault, 'export pw', FAST);
  assert.deepEqual(await X.parse(text, 'export pw'), vault);
});

test('file has the documented shape and no plaintext', async () => {
  const text = await X.build(sample(), 'export pw', FAST);
  const file = JSON.parse(text);
  assert.equal(file.format, 'dev-login-vault');
  assert.equal(file.version, 1);
  assert.deepEqual(Object.keys(file.kdf).sort(), ['iterations', 'name', 'salt']);
  assert.equal(file.kdf.name, 'PBKDF2-SHA-256');
  assert.equal(file.kdf.iterations, FAST);
  assert.ok(file.iv && file.ciphertext);
  assert.ok(!text.includes('Pässwörd') && !text.includes('qa.test'));
});

test('default iterations are 600000', async () => {
  const file = JSON.parse(await X.build(DLV.vault.emptyVault(), 'pw'));
  assert.equal(file.kdf.iterations, 600000);
});

test('rejects corrupt file', async () => {
  const good = JSON.parse(await X.build(sample(), 'pw', FAST));
  for (const text of ['{', '{"format":"x"}', JSON.stringify({ ...good, version: 2 }), JSON.stringify({ ...good, iv: undefined }), 'null']) {
    await assert.rejects(X.parse(text, 'pw'), X.InvalidFileError, text.slice(0, 30));
  }
});

test('wrong password throws WrongPasswordError', async () => {
  const text = await X.build(sample(), 'right', FAST);
  await assert.rejects(X.parse(text, 'wrong'), DLV.crypto.WrongPasswordError);
});

test('decrypted content that is not a vault is rejected', async () => {
  const salt = DLV.crypto.randomSaltB64();
  const key = await DLV.crypto.deriveKey('pw', salt, FAST);
  const box = await DLV.crypto.encryptJson(key, { hello: 1 });
  const text = JSON.stringify({ format: 'dev-login-vault', version: 1, kdf: { name: 'PBKDF2-SHA-256', iterations: FAST, salt }, ...box });
  await assert.rejects(X.parse(text, 'pw'), X.InvalidFileError);
});

test('fileName pads month, day, hour, minute', () => {
  assert.equal(X.fileName(new Date(2026, 0, 5, 7, 3)), 'dev-login-vault-20260105-0703.dlv.json');
});

test('damaged iv or ciphertext is an invalid file, not a wrong password', async () => {
  const good = JSON.parse(await X.build(sample(), 'pw', FAST));
  for (const bad of [{ iv: 'not base64 !!' }, { ciphertext: '%%%%' }]) {
    await assert.rejects(X.parse(JSON.stringify({ ...good, ...bad }), 'pw'), X.InvalidFileError, JSON.stringify(bad));
  }
});

test('absurd iteration counts are refused before deriving', async () => {
  const good = JSON.parse(await X.build(sample(), 'pw', FAST));
  const text = JSON.stringify({ ...good, kdf: { ...good.kdf, iterations: 50_000_000 } });
  await assert.rejects(X.parse(text, 'pw'), X.InvalidFileError);
});
