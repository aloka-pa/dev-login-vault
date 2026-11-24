// Service worker: wires Chrome events and messages to DLV.VaultService. Classic worker (importScripts).
if (typeof importScripts === 'function') {
  importScripts('../lib/ns.js', '../lib/env.js', '../lib/crypto.js', '../lib/vault.js', '../lib/exportFile.js', '../lib/service.js');
}

(function (DLV) {
  // Messages a content script (a web page's frame) may send. Everything else is for extension pages only.
  const CONTENT_TYPES = new Set(['pendingCapture', 'pendingStep1', 'pendingNudge', 'pendingForTab', 'savePending',
    'dismissPending', 'neverForPending', 'pageShown']);

  const ERROR_CODES = {
    LockedError: 'LOCKED', OriginMismatchError: 'ORIGIN_MISMATCH', EnvRequiredError: 'ENV_REQUIRED',
    InvalidFileError: 'INVALID_FILE', WrongPasswordError: 'WRONG_PASSWORD', AlreadyInitializedError: 'ALREADY_INITIALIZED',
    ForbiddenError: 'FORBIDDEN',
  };

  const clampMinutes = (n) => Math.min(240, Math.max(5, Math.round(Number(n) || 30)));
  const originOf = (url) => { try { return new URL(url).origin; } catch { return null; } };

  /**
   * deps: { tabUrl(tabId), injectFill(tabId, username, password, origin, submit) -> boolean,
   *         setBadge(tabId, text), nudgeTopFrame(tabId), applyIdle(minutes) }
   */
  function createRouter(service, deps) {
    const forbidden = () => Object.assign(new Error('Not allowed from this frame'), { name: 'ForbiddenError' });

    async function pendingTabIds() {
      const all = await service.session.get(null);
      return Object.keys(all).filter((k) => k.startsWith('pending:')).map((k) => Number(k.slice(8)));
    }

    const content = {
      async pendingCapture(m, tabId, origin) {
        await service.putPending(tabId, { origin, username: m.username, password: m.password });
        if (!(await service.isUnlocked())) await deps.setBadge(tabId, '!');
      },
      pendingStep1: (m, tabId, origin) => service.rememberStep1User(tabId, origin, m.username),
      pendingNudge: (m, tabId) => deps.nudgeTopFrame(tabId),
      pendingForTab: (m, tabId, origin, frameId) => (frameId === 0 ? service.getPending(tabId) : null),
      async savePending(m, tabId, origin, frameId) {
        if (frameId !== 0) throw forbidden();
        const r = await service.savePending(tabId, m.env);
        await deps.setBadge(tabId, '');
        return r;
      },
      async dismissPending(m, tabId, origin, frameId) {
        if (frameId !== 0) throw forbidden();
        await service.dismissPending(tabId);
        await deps.setBadge(tabId, '');
      },
      async neverForPending(m, tabId, origin, frameId) {
        if (frameId !== 0) throw forbidden();
        await service.neverForPending(tabId);
        await deps.setBadge(tabId, '');
      },
      pageShown: (m, tabId, origin) => (m.backForward ? service.setTabEnv(tabId, origin, null) : undefined),
    };

    const pages = {
      status: () => service.status(),
      setup: (m) => service.setup(m.password),
      async unlock(m) {
        const ok = await service.unlock(m.password);
        if (ok) for (const tabId of await pendingTabIds()) { await deps.setBadge(tabId, ''); await deps.nudgeTopFrame(tabId); }
        return ok;
      },
      async lock() {
        const tabs = await pendingTabIds();
        await service.lock();
        for (const tabId of tabs) await deps.setBadge(tabId, '');
      },
      tabEnv: (m) => service.getTabEnv(m.tabId, m.origin),
      listForSite: (m) => service.listForSite(m.origin, m.env),
      async fill(m) {
        const origin = originOf(await deps.tabUrl(m.tabId));
        const { username, password } = await service.getFillData(m.id, origin);
        const { submitAfterFill } = await service.getSettings();
        return deps.injectFill(m.tabId, username, password, origin, !!submitAfterFill);
      },
      pendingForTab: (m) => service.getPending(m.tabId),
      savePending: async (m) => { const r = await service.savePending(m.tabId, m.env); await deps.setBadge(m.tabId, ''); return r; },
      addEntry: (m) => service.addEntry(m.entry),
      updateEntry: (m) => service.updateEntry(m.id, m.changes),
      deleteEntry: (m) => service.deleteEntry(m.id),
      getPassword: async (m) => (await service.getVault()).entries.find((e) => e.id === m.id)?.password ?? null,
      setLabel: (m) => service.setLabel(m.origin, m.env, m.label),
      removeNeverSave: (m) => service.removeNeverSave(m.origin),
      getSettings: () => service.getSettings(),
      async setSettings(m) {
        const settings = { ...m.settings };
        if (settings.autoLockMinutes !== undefined) settings.autoLockMinutes = clampMinutes(settings.autoLockMinutes);
        await service.setSettings(settings);
        if (settings.autoLockMinutes !== undefined) await deps.applyIdle(settings.autoLockMinutes);
      },
      async getOverview() {
        const v = await service.getVault();
        return { neverSave: v.neverSave, envLabels: v.envLabels, sites: [...new Set(v.entries.map((e) => e.origin))].sort() };
      },
      changePassword: (m) => service.changePassword(m.oldPassword, m.newPassword),
      exportVaultPlain: () => service.exportVaultPlain(),
      importVault: (m) => service.importVault(m.vault),
      deleteAll: () => service.deleteAll(),
    };

    // An extension page (popup, or the options page, which opens in a tab) is recognised by its origin; anything else
    // that comes from a tab is a content script in a web page.
    const isExtensionPage = (sender) => !!deps.extensionOrigin
      && (sender.origin === deps.extensionOrigin || String(sender.url || '').startsWith(deps.extensionOrigin + '/'));

    /** Clears the "!" badge of waiting logins that have expired (getPending drops expired ones). */
    async function sweep() {
      for (const tabId of await pendingTabIds()) {
        if (!(await service.getPending(tabId))) await deps.setBadge(tabId, '');
      }
    }

    async function route(message, sender) {
      try {
        const type = message && message.type;
        if (!isExtensionPage(sender)) {
          if (!sender.tab) return { ok: false, error: 'FORBIDDEN' };
          if (!CONTENT_TYPES.has(type)) return { ok: false, error: pages[type] ? 'FORBIDDEN' : 'UNKNOWN_MESSAGE' };
          const origin = sender.origin && sender.origin !== 'null' ? sender.origin : originOf(sender.url);
          const data = await content[type](message, sender.tab.id, origin, sender.frameId);
          return { ok: true, data: data ?? null };
        }
        if (!pages[type]) return { ok: false, error: 'UNKNOWN_MESSAGE' };
        const data = await pages[type](message);
        return { ok: true, data: data ?? null };
      } catch (err) {
        const code = ERROR_CODES[err && err.name];
        return code ? { ok: false, error: code } : { ok: false, error: 'ERROR', message: String((err && err.message) || err) };
      }
    }

    route.sweep = sweep;
    route.lock = pages.lock;
    return route;
  }

  /** From executeScript results that returned each frame's location.origin, the documents a login may be filled into. */
  function matchingDocumentIds(results, origin) {
    return results.filter((r) => r && r.result === origin && r.documentId).map((r) => r.documentId);
  }

  DLV.createRouter = createRouter;
  DLV.matchingDocumentIds = matchingDocumentIds;

  // ---- Chrome wiring (skipped when loaded by Node tests) ----
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) return;

  const service = new DLV.VaultService({ local: chrome.storage.local, session: chrome.storage.session });

  function fillInPage(username, password, origin, submit) {
    const F = globalThis.DLV && globalThis.DLV.forms;
    if (location.origin !== origin || !F) return false;
    const pw = F.findPasswordField(document);
    const user = F.findUsernameField(pw, document);
    if (!pw && !user) return false;
    if (user) F.setValue(user, username);
    if (pw) F.setValue(pw, password);
    if (submit && pw) {
      const button = F.findSubmit(pw);
      if (button) button.click(); else if (pw.form && pw.form.requestSubmit) pw.form.requestSubmit();
    }
    return true;
  }

  async function applyIdle(minutes) {
    const value = clampMinutes(minutes);
    await chrome.storage.local.set({ lockMinutes: value });
    chrome.idle.setDetectionInterval(value * 60);
  }

  const deps = {
    tabUrl: async (tabId) => (await chrome.tabs.get(tabId)).url,
    async injectFill(tabId, username, password, origin, submit) {
      // First learn each frame's origin, then send the password only to documents of the entry's origin.
      const probe = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => location.origin });
      const documentIds = matchingDocumentIds(probe, origin);
      if (!documentIds.length) return false;
      const target = { tabId, documentIds };
      await chrome.scripting.executeScript({ target, files: ['src/lib/ns.js', 'src/lib/forms.js'] });
      const results = await chrome.scripting.executeScript({ target, func: fillInPage, args: [username, password, origin, submit] });
      return results.some((r) => r.result === true);
    },
    async setBadge(tabId, text) {
      try {
        await chrome.action.setBadgeText({ tabId, text });
        if (text) {
          await chrome.action.setBadgeBackgroundColor({ tabId, color: '#FEA832' });
          // Best effort while the worker is awake; the sweep at worker start covers the rest.
          setTimeout(() => route.sweep(), DLV.VaultService.PENDING_MS + 1000);
        }
      } catch { /* tab already closed */ }
    },
    async nudgeTopFrame(tabId) {
      try { await chrome.tabs.sendMessage(tabId, { type: 'checkPending' }, { frameId: 0 }); } catch { /* no content script there */ }
    },
    applyIdle,
    extensionOrigin: new URL(chrome.runtime.getURL('')).origin,
  };

  const route = createRouter(service, deps);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    route(message, sender).then(sendResponse);
    return true;
  });

  chrome.webRequest.onResponseStarted.addListener((details) => {
    if (details.tabId < 0) return;
    const origin = originOf(details.url);
    if (origin) service.setTabEnv(details.tabId, origin, details.fromCache ? null : details.ip);
  }, { urls: ['<all_urls>'], types: ['main_frame', 'sub_frame'] });

  chrome.tabs.onRemoved.addListener((tabId) => { service.clearTab(tabId); });

  chrome.windows.onRemoved.addListener(async () => {
    if ((await chrome.windows.getAll()).length === 0) await route.lock();
  });

  chrome.idle.onStateChanged.addListener((state) => { if (state === 'idle' || state === 'locked') route.lock(); });
  chrome.storage.local.get('lockMinutes').then(({ lockMinutes }) => chrome.idle.setDetectionInterval(clampMinutes(lockMinutes) * 60));
  route.sweep();
})(globalThis.DLV);
