/** In-memory stand-in for a chrome.storage area (promise API). Values are JSON-cloned like the real one. */
export function createFakeStorage() {
  let data = {};
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  return {
    async get(keys) {
      if (keys == null) return clone(data);
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out = {};
      for (const k of list) if (k in data) out[k] = clone(data[k]);
      return out;
    },
    async set(obj) { for (const [k, v] of Object.entries(obj)) data[k] = clone(v); },
    async remove(keys) { for (const k of typeof keys === 'string' ? [keys] : keys) delete data[k]; },
    async clear() { data = {}; },
    dump() { return clone(data); },
  };
}
