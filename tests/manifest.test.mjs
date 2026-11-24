import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = () => JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('manifest is valid MV3', () => {
  assert.equal(read().manifest_version, 3);
});

test('permissions are exactly storage, webRequest, scripting, idle', () => {
  const m = read();
  assert.deepEqual([...m.permissions].sort(), ['idle', 'scripting', 'storage', 'webRequest']);
  assert.deepEqual(m.host_permissions, ['<all_urls>']);
});

test('no web_accessible_resources', () => {
  assert.equal(read().web_accessible_resources, undefined);
});

test('every referenced file exists', () => {
  const m = read();
  const files = [
    m.background.service_worker,
    m.action.default_popup,
    m.options_page,
    ...m.content_scripts.flatMap((c) => c.js),
    ...Object.values(m.icons),
    ...Object.values(m.action.default_icon),
  ];
  assert.equal(Object.keys(m.icons).length, 4);
  for (const f of files) assert.ok(existsSync(path.join(root, f)), `missing ${f}`);
});
