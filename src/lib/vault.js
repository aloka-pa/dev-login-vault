// The decrypted vault: saved logins, never-save sites, environment labels, settings.
// Pure functions; every change returns a new vault and never mutates the input.
(function (DLV) {
  const ENVS = ['local', 'remote'];

  function emptyVault() {
    return { version: 1, entries: [], neverSave: [], envLabels: {}, settings: { autoLockMinutes: 30, submitAfterFill: false } };
  }

  const cleanName = (username) => String(username ?? '').trim();
  const sameKey = (e, origin, env, username) => e.origin === origin && e.env === env && e.username === username;
  const byLastUsedDesc = (a, b) => (b.lastUsedAt || '').localeCompare(a.lastUsedAt || '');
  const withEntries = (vault, entries) => ({ ...vault, entries });

  function findForSite(vault, origin, env) {
    const site = vault.entries.filter((e) => e.origin === origin);
    if (!ENVS.includes(env)) return { current: [], other: [...site].sort(byLastUsedDesc) };
    return {
      current: site.filter((e) => e.env === env).sort(byLastUsedDesc),
      other: site.filter((e) => e.env !== env).sort(byLastUsedDesc),
    };
  }

  /** @returns {"save"|"update"|"none"|"never"} */
  function classifyPending(vault, { origin, env, username, password }) {
    if (vault.neverSave.includes(origin)) return 'never';
    const match = vault.entries.find((e) => sameKey(e, origin, env, cleanName(username)));
    if (!match) return 'save';
    return match.password === password ? 'none' : 'update';
  }

  function upsertLogin(vault, { origin, env, username, password, note }, nowIso) {
    const name = cleanName(username);
    const existing = vault.entries.find((e) => sameKey(e, origin, env, name));
    if (existing && existing.password === password && (note === undefined || note === existing.note)) {
      return { vault, entry: existing, outcome: 'unchanged' };
    }
    if (existing) {
      const entry = { ...existing, password, note: note ?? existing.note, updatedAt: nowIso };
      return { vault: withEntries(vault, vault.entries.map((e) => (e.id === existing.id ? entry : e))), entry, outcome: 'updated' };
    }
    const entry = {
      id: globalThis.crypto.randomUUID(), origin, env, username: name, password, note: note ?? '',
      createdAt: nowIso, updatedAt: nowIso, lastUsedAt: nowIso,
    };
    return { vault: withEntries(vault, [...vault.entries, entry]), entry, outcome: 'added' };
  }

  function updateEntry(vault, id, changes, nowIso) {
    const allowed = {};
    for (const k of ['username', 'password', 'note', 'env']) if (changes[k] !== undefined) allowed[k] = changes[k];
    if (allowed.username !== undefined) allowed.username = cleanName(allowed.username);
    return withEntries(vault, vault.entries.map((e) => (e.id === id ? { ...e, ...allowed, updatedAt: nowIso } : e)));
  }

  const removeEntry = (vault, id) => withEntries(vault, vault.entries.filter((e) => e.id !== id));
  const markUsed = (vault, id, nowIso) => withEntries(vault, vault.entries.map((e) => (e.id === id ? { ...e, lastUsedAt: nowIso } : e)));

  const addNeverSave = (vault, origin) => (vault.neverSave.includes(origin) ? vault : { ...vault, neverSave: [...vault.neverSave, origin] });
  const removeNeverSave = (vault, origin) => ({ ...vault, neverSave: vault.neverSave.filter((o) => o !== origin) });

  function labelFor(vault, origin, env) {
    return vault.envLabels[origin]?.[env] || DLV.env.DEFAULT_LABELS[env] || 'Unknown';
  }

  function setLabel(vault, origin, env, label) {
    const site = { ...(vault.envLabels[origin] || {}) };
    const text = String(label ?? '').trim();
    if (text) site[env] = text; else delete site[env];
    const envLabels = { ...vault.envLabels, [origin]: site };
    if (!Object.keys(site).length) delete envLabels[origin];
    return { ...vault, envLabels };
  }

  function mergeVaults(local, incoming) {
    const counts = { added: 0, updated: 0, unchanged: 0 };
    const entries = [...local.entries];
    for (const inc of incoming.entries) {
      const i = entries.findIndex((e) => sameKey(e, inc.origin, inc.env, cleanName(inc.username)));
      if (i < 0) {
        // An entry renamed in the other browser keeps its id there; never let two entries share one.
        const id = entries.some((e) => e.id === inc.id) ? globalThis.crypto.randomUUID() : inc.id;
        entries.push({ ...inc, id });
        counts.added++;
      }
      else if ((inc.updatedAt || '') > (entries[i].updatedAt || '')) { entries[i] = { ...inc, id: entries[i].id }; counts.updated++; }
      else counts.unchanged++;
    }
    const neverSave = [...new Set([...local.neverSave, ...incoming.neverSave])];
    const envLabels = { ...local.envLabels };
    for (const [origin, labels] of Object.entries(incoming.envLabels || {})) {
      envLabels[origin] = { ...labels, ...(local.envLabels[origin] || {}) };
    }
    return { vault: { ...local, entries, neverSave, envLabels }, counts };
  }

  DLV.vault = {
    emptyVault, findForSite, classifyPending, upsertLogin, updateEntry, removeEntry, markUsed,
    addNeverSave, removeNeverSave, labelFor, setLabel, mergeVaults,
  };
})(globalThis.DLV);
