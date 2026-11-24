import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const libDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/lib');

/** Runs src/lib/<name>.js (classic scripts) in this context, ns.js first, and returns globalThis.DLV. */
export async function loadLib(...names) {
  for (const name of ['ns', ...names.filter((n) => n !== 'ns')]) {
    const file = path.join(libDir, `${name}.js`);
    vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file });
  }
  return globalThis.DLV;
}
