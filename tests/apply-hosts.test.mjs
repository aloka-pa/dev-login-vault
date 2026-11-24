// Runs native/apply-hosts.ps1 WITHOUT elevation against temporary files (never the real hosts file).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../native/apply-hosts.ps1', import.meta.url));
const sha = (text) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex').toUpperCase();
const skip = process.platform !== 'win32';

function run(args) {
  return spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args, '-SkipFlush'], { encoding: 'utf8' }).status;
}

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'dlv-apply-'));
  const target = path.join(dir, 'hosts');
  const source = path.join(dir, 'next.txt');
  writeFileSync(target, '127.0.0.1 a.test\r\n');
  writeFileSync(source, '#127.0.0.1 a.test\r\n');
  return { dir, target, source };
}

test('writes the new file, keeps a backup', { skip }, () => {
  const { target, source } = setup();
  const code = run(['-Source', source, '-Sha256', sha('#127.0.0.1 a.test\r\n'), '-BeforeSha256', sha('127.0.0.1 a.test\r\n'), '-Target', target]);
  assert.equal(code, 0);
  assert.equal(readFileSync(target, 'utf8'), '#127.0.0.1 a.test\r\n');
  assert.equal(readFileSync(`${target}.dev-login-vault.bak`, 'utf8'), '127.0.0.1 a.test\r\n');
});

test('refuses a source file that was altered after it was prepared', { skip }, () => {
  const { target, source } = setup();
  const code = run(['-Source', source, '-Sha256', sha('something else'), '-BeforeSha256', sha('127.0.0.1 a.test\r\n'), '-Target', target]);
  assert.equal(code, 2);
  assert.equal(readFileSync(target, 'utf8'), '127.0.0.1 a.test\r\n');
  assert.equal(existsSync(`${target}.dev-login-vault.bak`), false);
});

test('refuses when the hosts file changed in the meantime', { skip }, () => {
  const { target, source } = setup();
  const code = run(['-Source', source, '-Sha256', sha('#127.0.0.1 a.test\r\n'), '-BeforeSha256', sha('other'), '-Target', target]);
  assert.equal(code, 3);
  assert.equal(readFileSync(target, 'utf8'), '127.0.0.1 a.test\r\n');
});
