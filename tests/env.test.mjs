import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLib } from './helpers/loadLib.mjs';

const DLV = await loadLib('env');

test('loopback addresses are local', () => {
  for (const ip of ['127.0.0.1', '127.5.6.7', '::1', '[::1]', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1'])
    assert.equal(DLV.env.classifyIp(ip), 'local', ip);
});

test('other addresses are remote', () => {
  for (const ip of ['10.1.2.3', '192.168.1.5', '52.1.2.3', '2001:db8::1', '::ffff:52.1.2.3', '128.0.0.1'])
    assert.equal(DLV.env.classifyIp(ip), 'remote', ip);
});

test('missing address is unknown', () => {
  for (const ip of ['', undefined, null, '   ']) assert.equal(DLV.env.classifyIp(ip), 'unknown', String(ip));
});

test('default labels', () => {
  assert.deepEqual({ ...DLV.env.DEFAULT_LABELS }, { local: 'Local IIS', remote: 'Server' });
});
