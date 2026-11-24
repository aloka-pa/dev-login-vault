// All vault, lock and pending-login rules. The service worker wires Chrome events to this class.
// `local` and `session` follow the chrome.storage promise API, so Node tests can pass in-memory fakes.
(function (DLV) {
  const PENDING_MS = 120_000;
  const V = () => DLV.vault;

  class LockedError extends Error { constructor() { super('The vault is locked'); this.name = 'LockedError'; } }
  class OriginMismatchError extends Error { constructor() { super('This login belongs to another site'); this.name = 'OriginMismatchError'; } }
  class EnvRequiredError extends Error { constructor() { super('Choose Local IIS or Server first'); this.name = 'EnvRequiredError'; } }
  class AlreadyInitializedError extends Error { constructor() { super('The vault already exists'); this.name = 'AlreadyInitializedError'; } }

  const pendingKey = (tabId) => `pending:${tabId}`;
  const tabEnvKey = (tabId, origin) => `tabEnv:${tabId}:${origin}`;
  const step1Key = (tabId, origin) => `step1User:${tabId}:${origin}`;
  const ENVS = ['local', 'remote'];

  /** True for a bare web origin such as "https://host:port" (no path). */
  function isOrigin(value) {
    if (typeof value !== 'string') return false;
    try {
      const url = new URL(value);
      return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
    } catch { return false; }
  }

  const optionalString = (v) => v === undefined || typeof v === 'string';
  const SAVED_ENVS = DLV.env.SAVED_ENVS;

  /** Local/Server only matters on a site served from this computer, or one that already has Local/Server logins. */
  const envMatters = (vault, origin, env) =>
    env === 'local' || vault.entries.some((e) => e.origin === origin && (e.env === 'local' || e.env === 'remote'));

  const labelsFor = (vault, origin) => ({
    local: DLV.vault.labelFor(vault, origin, 'local'),
    remote: DLV.vault.labelFor(vault, origin, 'remote'),
    na: DLV.env.DEFAULT_LABELS.na,
  });

  function assertValidVault(v) {
    const isEntry = (e) => e && typeof e === 'object' && typeof e.id === 'string' && isOrigin(e.origin) && SAVED_ENVS.includes(e.env)
      && typeof e.username === 'string' && typeof e.password === 'string' && typeof e.updatedAt === 'string'
      && optionalString(e.note) && optionalString(e.createdAt) && optionalString(e.lastUsedAt);
    const isLabels = (labels) => labels && typeof labels === 'object' && Object.values(labels).every((l) => typeof l === 'string');
    const ok = v && typeof v === 'object' && v.version === 1 && Array.isArray(v.entries) && Array.isArray(v.neverSave)
      && v.entries.every(isEntry)
      && v.neverSave.every(isOrigin)
      && (v.envLabels === undefined || (v.envLabels && typeof v.envLabels === 'object'
        && Object.entries(v.envLabels).every(([origin, labels]) => isOrigin(origin) && isLabels(labels))));
    if (!ok) throw new DLV.exportFile.InvalidFileError('no vault inside');
  }

  class VaultService {
    constructor({ local, session, now = () => new Date(), iterations = DLV.crypto.ITERATIONS }) {
      this.local = local;
      this.session = session;
      this.now = now;
      this.iterations = iterations;
      this.queue = Promise.resolve();
    }

    /** Runs vault changes one at a time so concurrent messages never overwrite each other. */
    serial(fn) {
      const run = this.queue.then(fn, fn);
      this.queue = run.catch(() => {});
      return run;
    }

    nowIso() { return this.now().toISOString(); }

    async readBox() { return (await this.local.get('vaultBox')).vaultBox || null; }

    async key() {
      const { keyB64 } = await this.session.get('keyB64');
      if (!keyB64) throw new LockedError();
      return DLV.crypto.importKeyB64(keyB64);
    }

    async status() {
      const [box, { keyB64 }] = await Promise.all([this.readBox(), this.session.get('keyB64')]);
      return { initialized: !!box, unlocked: !!box && !!keyB64 };
    }

    async isUnlocked() { return (await this.status()).unlocked; }

    async writeVault(vault, key, salt, iterations) {
      const box = await DLV.crypto.encryptJson(key, vault);
      await this.local.set({ vaultBox: { salt, iterations, ...box } });
    }

    async save(vault) {
      const box = await this.readBox();
      await this.writeVault(vault, await this.key(), box.salt, box.iterations);
    }

    async getVault() {
      const key = await this.key();
      return DLV.crypto.decryptJson(key, await this.readBox());
    }

    /** Applies fn(vault) -> vault | { vault, result } and saves, serialised. */
    change(fn) {
      return this.serial(async () => {
        const out = await fn(await this.getVault());
        const vault = out && out.vault ? out.vault : out;
        await this.save(vault);
        return out && out.vault ? out.result : undefined;
      });
    }

    setup(password) {
      return this.serial(async () => {
        if (await this.readBox()) throw new AlreadyInitializedError();
        const salt = DLV.crypto.randomSaltB64();
        const key = await DLV.crypto.deriveKey(password, salt, this.iterations);
        await this.writeVault(V().emptyVault(), key, salt, this.iterations);
        await this.session.set({ keyB64: await DLV.crypto.exportKeyB64(key) });
      });
    }

    /** Serialised with password changes, so a slow unlock can never store a key for an older salt. */
    unlock(password) {
      return this.serial(async () => {
        const box = await this.readBox();
        if (!box) return false;
        const key = await DLV.crypto.deriveKey(password, box.salt, box.iterations);
        try { await DLV.crypto.decryptJson(key, box); } catch (err) {
          if (err instanceof DLV.crypto.WrongPasswordError) return false;
          throw err;
        }
        await this.session.set({ keyB64: await DLV.crypto.exportKeyB64(key) });
        return true;
      });
    }

    async lock() {
      const all = await this.session.get(null);
      await this.session.remove(['keyB64', ...Object.keys(all).filter((k) => k.startsWith('pending:'))]);
    }

    async setTabEnv(tabId, origin, ip) {
      await this.session.set({ [tabEnvKey(tabId, origin)]: DLV.env.classifyIp(ip) });
    }

    async getTabEnv(tabId, origin) {
      return (await this.session.get(tabEnvKey(tabId, origin)))[tabEnvKey(tabId, origin)] || 'unknown';
    }

    async clearTab(tabId) {
      const all = await this.session.get(null);
      const keys = Object.keys(all).filter((k) =>
        k === pendingKey(tabId) || k.startsWith(`tabEnv:${tabId}:`) || k.startsWith(`step1User:${tabId}:`));
      if (keys.length) await this.session.remove(keys);
    }

    async rememberStep1User(tabId, origin, username) {
      const name = String(username || '').trim();
      if (name) await this.session.set({ [step1Key(tabId, origin)]: { username: name, expiresAt: this.now().getTime() + PENDING_MS } });
    }

    async takeStep1User(tabId, origin) {
      const key = step1Key(tabId, origin);
      const item = (await this.session.get(key))[key];
      if (!item) return null;
      await this.session.remove(key);
      return item.expiresAt > this.now().getTime() ? item.username : null;
    }

    async peekStep1User(tabId, origin) {
      const item = (await this.session.get(step1Key(tabId, origin)))[step1Key(tabId, origin)];
      return item && item.expiresAt > this.now().getTime() ? item.username : null;
    }

    /**
     * One sign-in can be captured more than once (click + submit, Enter + submit, a retry after a wrong password), so the
     * step-1 username is only read here and cleared when the pending login is saved or dismissed, and a capture with no
     * username never replaces a pending login of the same site that has one.
     */
    async putPending(tabId, { origin, username, password }) {
      if (!password) return;
      let name = String(username || '').trim();
      if (!name) name = (await this.peekStep1User(tabId, origin)) || '';
      if (!name) {
        const existing = (await this.session.get(pendingKey(tabId)))[pendingKey(tabId)];
        if (existing && existing.origin === origin) name = existing.username;
      }
      const env = await this.getTabEnv(tabId, origin);
      await this.session.set({ [pendingKey(tabId)]: { origin, env, username: name, password, expiresAt: this.now().getTime() + PENDING_MS } });
    }

    async readPending(tabId) {
      const item = (await this.session.get(pendingKey(tabId)))[pendingKey(tabId)];
      if (!item) return null;
      if (item.expiresAt <= this.now().getTime()) { await this.dismissPending(tabId); return null; }
      return item;
    }

    async getPending(tabId) {
      const item = await this.readPending(tabId);
      if (!item) return null;
      const view = { origin: item.origin, env: item.env, username: item.username };
      if (!(await this.isUnlocked())) return { ...view, kind: 'locked', labels: { ...DLV.env.DEFAULT_LABELS } };
      const vault = await this.getVault();
      // Already saved (this environment, an N/A login, or any one when the environment is unknown): no prompt, mark it used.
      const saved = vault.entries.find((e) => e.origin === item.origin && e.username === item.username && e.password === item.password
        && (e.env === item.env || e.env === 'na' || !ENVS.includes(item.env)));
      if (saved) {
        await this.change((v) => V().markUsed(v, saved.id, this.nowIso()));
        await this.dismissPending(tabId);
        return null;
      }
      const kind = V().classifyPending(vault, item);
      if (kind === 'none' || kind === 'never') { await this.dismissPending(tabId); return null; }
      // Suggest N/A when the username is saved as N/A, or when hosting does not matter on this site.
      const match = V().findMatch(vault, item);
      const env = (match && match.env === 'na') || !envMatters(vault, item.origin, item.env) ? 'na' : item.env;
      return { ...view, env, kind, labels: labelsFor(vault, item.origin) };
    }

    async savePending(tabId, env) {
      const item = await this.readPending(tabId);
      if (!item) return null;
      const chosen = SAVED_ENVS.includes(env) ? env : item.env;
      if (!(await this.isUnlocked())) throw new LockedError();
      if (!SAVED_ENVS.includes(chosen)) throw new EnvRequiredError();
      const outcome = await this.change((vault) => {
        const r = V().upsertLogin(vault, { ...item, env: chosen }, this.nowIso());
        return { vault: r.vault, result: r.outcome };
      });
      await this.dismissPending(tabId);
      return outcome;
    }

    async dismissPending(tabId) {
      const item = (await this.session.get(pendingKey(tabId)))[pendingKey(tabId)];
      await this.session.remove(item ? [pendingKey(tabId), step1Key(tabId, item.origin)] : [pendingKey(tabId)]);
    }

    async neverForPending(tabId) {
      const item = await this.readPending(tabId);
      if (!item) return;
      await this.change((vault) => V().addNeverSave(vault, item.origin));
      await this.dismissPending(tabId);
    }

    async listForSite(origin, env) {
      const vault = await this.getVault();
      const strip = ({ id, username, env: e, note, lastUsedAt }) => ({ id, username, env: e, note, lastUsedAt });
      const { current, other } = V().findForSite(vault, origin, env);
      return {
        current: current.map(strip),
        other: other.map(strip),
        labels: labelsFor(vault, origin),
        envMatters: envMatters(vault, origin, env),
      };
    }

    getFillData(id, tabOrigin) {
      return this.change((vault) => {
        const entry = vault.entries.find((e) => e.id === id);
        if (!entry || entry.origin !== tabOrigin) throw new OriginMismatchError();
        return { vault: V().markUsed(vault, id, this.nowIso()), result: { username: entry.username, password: entry.password } };
      });
    }

    addEntry(login) {
      return this.change((vault) => {
        const r = V().upsertLogin(vault, login, this.nowIso());
        return { vault: r.vault, result: { id: r.entry.id, outcome: r.outcome } };
      });
    }

    updateEntry(id, changes) { return this.change((vault) => V().updateEntry(vault, id, changes, this.nowIso())); }
    deleteEntry(id) { return this.change((vault) => V().removeEntry(vault, id)); }
    removeNeverSave(origin) { return this.change((vault) => V().removeNeverSave(vault, origin)); }
    setLabel(origin, env, label) { return this.change((vault) => V().setLabel(vault, origin, env, label)); }
    setSettings(partial) { return this.change((vault) => ({ ...vault, settings: { ...vault.settings, ...partial } })); }
    async getSettings() { return (await this.getVault()).settings; }

    changePassword(oldPassword, newPassword) {
      return this.serial(async () => {
        const box = await this.readBox();
        const oldKey = await DLV.crypto.deriveKey(oldPassword, box.salt, box.iterations);
        let vault;
        try { vault = await DLV.crypto.decryptJson(oldKey, box); } catch { return false; }
        const salt = DLV.crypto.randomSaltB64();
        const key = await DLV.crypto.deriveKey(newPassword, salt, this.iterations);
        await this.writeVault(vault, key, salt, this.iterations);
        await this.session.set({ keyB64: await DLV.crypto.exportKeyB64(key) });
        return true;
      });
    }

    exportVaultPlain() { return this.getVault(); }

    async importVault(incoming) {
      assertValidVault(incoming);
      return this.change((vault) => {
        const r = V().mergeVaults(vault, { envLabels: {}, ...incoming });
        return { vault: r.vault, result: r.counts };
      });
    }

    async deleteAll() {
      await this.serial(async () => { await this.local.clear(); await this.session.clear(); });
    }
  }

  VaultService.LockedError = LockedError;
  VaultService.OriginMismatchError = OriginMismatchError;
  VaultService.EnvRequiredError = EnvRequiredError;
  VaultService.AlreadyInitializedError = AlreadyInitializedError;
  VaultService.PENDING_MS = PENDING_MS;
  DLV.VaultService = VaultService;
})(globalThis.DLV);
