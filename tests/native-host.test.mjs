import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeMessage, createDecoder } from '../native/protocol.mjs';
import { handle } from '../native/commands.mjs';

const HOSTS = '#127.0.0.1 echo.test\r\n127.0.0.1 main.test\r\n';

function fakeDeps(result = 'ok') {
  let text = HOSTS;
  const writes = [];
  return {
    writes,
    deps: {
      readHosts: async () => text,
      writeHostsElevated: async (next, before) => { writes.push({ next, before }); if (result === 'ok') text = next; return result; },
    },
  };
}

test('native messages round-trip with a 4-byte little-endian length', () => {
  const got = [];
  const decoder = createDecoder((m) => got.push(m));
  const a = encodeMessage({ type: 'list' });
  const b = encodeMessage({ type: 'set', host: 'é.test', local: true });
  assert.equal(a.readUInt32LE(0), a.length - 4);
  const both = Buffer.concat([a, b]);
  decoder.push(both.subarray(0, 3));
  decoder.push(both.subarray(3, 20));
  decoder.push(both.subarray(20));
  assert.deepEqual(got, [{ type: 'list' }, { type: 'set', host: 'é.test', local: true }]);
});

test('list returns the loopback lines', async () => {
  const { deps } = fakeDeps();
  const r = await handle({ type: 'list' }, deps);
  assert.deepEqual(r.entries.map((e) => [e.hosts[0], e.active]), [['echo.test', false], ['main.test', true]]);
});

test('set switches a line through the elevated writer and reports the new state', async () => {
  const { deps, writes } = fakeDeps();
  const r = await handle({ type: 'set', host: 'main.test', local: false }, deps);
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  assert.equal(writes[0].before, HOSTS);
  assert.equal(writes[0].next, '#127.0.0.1 echo.test\r\n#127.0.0.1 main.test\r\n');
  assert.equal(r.entries.find((e) => e.hosts[0] === 'main.test').active, false);
});

test('set to the current state does not ask Windows for permission', async () => {
  const { deps, writes } = fakeDeps();
  const r = await handle({ type: 'set', host: 'main.test', local: true }, deps);
  assert.deepEqual([r.ok, r.changed, writes.length], [true, false, 0]);
});

test('a cancelled Windows prompt or a failed write changes nothing and says so', async () => {
  for (const [result, error] of [['cancelled', 'CANCELLED'], ['changed-meanwhile', 'HOSTS_CHANGED'], ['failed', 'WRITE_FAILED']]) {
    const { deps } = fakeDeps(result);
    const r = await handle({ type: 'set', host: 'main.test', local: false }, deps);
    assert.deepEqual([r.ok, r.error], [false, error], result);
    assert.equal((await deps.readHosts()), HOSTS);
  }
});

test('bad requests are refused', async () => {
  const { deps, writes } = fakeDeps();
  assert.equal((await handle({ type: 'set', host: 'nope.test', local: true }, deps)).error, 'HOST_NOT_FOUND');
  assert.equal((await handle({ type: 'set', host: 'main.test', local: 'yes' }, deps)).error, 'BAD_REQUEST');
  assert.equal((await handle({ type: 'set', host: 'main.test\r\n127.0.0.1 evil.test', local: true }, deps)).error, 'BAD_REQUEST');
  assert.equal((await handle({ type: 'rm -rf' }, deps)).error, 'UNKNOWN_COMMAND');
  assert.equal((await handle(null, deps)).error, 'UNKNOWN_COMMAND');
  assert.equal(writes.length, 0);
});

test('ping answers with the helper version', async () => {
  assert.deepEqual(await handle({ type: 'ping' }, fakeDeps().deps), { ok: true, version: 1 });
});

test('the helper process answers ping and list over stdin/stdout (reading a test copy of the hosts file)', async () => {
  const { spawn } = await import('node:child_process');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = mkdtempSync(path.join(tmpdir(), 'dlv-host-'));
  const fake = path.join(dir, 'hosts');
  writeFileSync(fake, HOSTS);
  const { fileURLToPath } = await import('node:url');
  const child = spawn(process.execPath, [fileURLToPath(new URL('../native/host.mjs', import.meta.url))],
    { env: { ...process.env, DLV_HOSTS_FILE_FOR_TESTS: fake } });
  const replies = [];
  const decoder = createDecoder((m) => replies.push(m));
  child.stdout.on('data', (d) => decoder.push(d));
  child.stdin.write(encodeMessage({ type: 'ping' }));
  child.stdin.write(encodeMessage({ type: 'list' }));
  child.stdin.end();
  await new Promise((r) => child.on('close', r));
  assert.deepEqual(replies[0], { ok: true, version: 1 });
  assert.deepEqual(replies[1].entries.map((e) => e.hosts[0]), ['echo.test', 'main.test']);
});
