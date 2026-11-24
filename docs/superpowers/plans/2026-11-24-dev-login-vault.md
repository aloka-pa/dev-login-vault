# Dev Login Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A personal Manifest V3 extension for Edge and Chrome that offers to save a login on sign-in and fills a saved login
when its username is clicked, telling the local IIS copy of a site from the server copy by IP.

**Architecture:** Pure logic lives in classic scripts under `src/lib/` that attach to `globalThis.DLV`, so the content script,
the classic service worker (`importScripts`), the popup/options pages and Node tests all load the same files without a build
step. A `VaultService` (injected storage + clock) holds all vault/lock/pending rules and is unit-tested in Node; `worker.js`
only wires Chrome events to it. DOM code (`forms.js`, content script) is tested in a browser test page served from localhost.

**Tech Stack:** Plain JavaScript (ES2022, classic scripts), HTML, CSS, Web Crypto, Chrome extension APIs (MV3). Node 24
built-in test runner (`node --test`) and a Node built-in static server for browser tests. No npm packages.

**Spec:** `docs/superpowers/specs/2026-11-24-dev-login-vault-design.md` (read it before any task).

## Global Constraints

- Project root: `C:\Github aloka-pa\dev-login-vault\` (space in the parent folder name; always quote paths).
- **No git commits or pushes, and no `git init`** (Aloka's instruction). Tasks end with a test run, not a commit.
- No npm packages, no build step; the folder must load as-is with "Load unpacked" in Edge 158 and Chrome 157.
- No network calls, no `chrome.storage.sync`, no remote code, no `web_accessible_resources`.
- Never log a password, a key, or a decrypted vault (`console.*` included).
- Manifest permissions exactly: `storage`, `webRequest`, `scripting`, `idle`; `host_permissions`: `<all_urls>`.
- Crypto: PBKDF2-SHA-256, **600000** iterations, 16-byte salt, AES-GCM 256, 12-byte IV per encryption.
- Pending login lifetime **2 minutes**; save bar shown after navigation or after **2 seconds** without navigation.
- Default auto-lock **30** minutes of machine idle; also lock on Windows lock and on last window closed.
- Default labels `"Local IIS"` (env `local`) and `"Server"` (env `remote`).
- Colours: orange `#FEA832`, navy `#2F5274`, green `#70DA40`, ink `#000000`, light `#F1F1F1`, white `#FFFFFF`, error `#C62828`.
- Site identity = `URL.origin` (scheme + host + port). Usernames are trimmed; matching is case-sensitive.
- Session storage access level stays at the default `TRUSTED_CONTEXTS` (never call `setAccessLevel`).

## Review Focus

1. **Two-step sign-in pages** (username on one page, password on the next): the username from step 1 must be paired with the
   step-2 password for the same tab and origin. Test: Task 9 `two-step login pairs remembered username`.
2. **Passwords with Unicode, spaces or 1000+ characters** must round-trip exactly through save, encrypt, export and fill.
   Test: Task 3 `round-trips unicode and long secrets`, Task 5 `export round-trips unicode`.
3. **Same host, different port or scheme** (`http://localhost:5042` vs `https://localhost:7229`) are different sites and must
   not share logins. Test: Task 4 `origins differing by port or scheme are separate`.
4. **Corrupt, foreign or wrong-password import file** must change nothing and say why. Test: Task 5 `rejects corrupt file`,
   Task 7 `failed import leaves vault untouched`.
5. **Service worker restart while unlocked** (after ~30 s idle) must not lock the vault or lose a pending login.
   Test: Task 7 `new service instance resumes unlocked state and pending login`.

---

## File Structure

```
dev-login-vault/
  manifest.json
  README.md
  icons/icon-source.png (exists) icon16.png icon32.png icon48.png icon128.png
  scripts/make-icons.ps1        resize icon-source.png (System.Drawing, HighQualityBicubic)
  scripts/serve.mjs             static server on http://localhost:5599 serving the project root
  src/lib/ns.js                 creates globalThis.DLV = globalThis.DLV || {}
  src/lib/env.js                DLV.env
  src/lib/crypto.js             DLV.crypto
  src/lib/vault.js              DLV.vault (pure, immutable)
  src/lib/exportFile.js         DLV.exportFile
  src/lib/service.js            DLV.VaultService
  src/lib/forms.js              DLV.forms (DOM)
  src/ui/theme.css              colour variables + shared components (popup, options)
  src/background/worker.js      Chrome wiring
  src/content/content.js        sign-in detection, save bar, fill
  src/popup/popup.html|.js|.css
  src/options/options.html|.js|.css
  tests/helpers/loadLib.mjs     runs lib files in Node, returns globalThis.DLV
  tests/helpers/fakeStorage.mjs in-memory chrome.storage-like area
  tests/*.test.mjs              Node tests
  tests/browser/run.html        browser test runner for forms.js/content.js (prints "ALL PASS")
  tests/browser/login-*.html    fixture login pages (single step, two step, iframe, SPA)
```

Load order everywhere: `ns.js, env.js, crypto.js, vault.js, exportFile.js, service.js` (+ `forms.js` in pages with a DOM).

---

### Task 1: Scaffold, manifest, icons, test harness

**Files:**
- Create: `manifest.json`, `scripts/make-icons.ps1`, `scripts/serve.mjs`, `src/lib/ns.js`, `tests/helpers/loadLib.mjs`,
  `tests/helpers/fakeStorage.mjs`, `tests/manifest.test.mjs`, empty placeholders for `src/background/worker.js`,
  `src/content/content.js`, `src/popup/popup.html`, `src/options/options.html`
- Create (generated): `icons/icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`

**Interfaces:**
- Produces: `loadLib(...names: string[]): Promise<DLV>` — reads `src/lib/<name>.js` in order and runs each with
  `vm.runInThisContext`; `ns.js` is always loaded first. `createFakeStorage(): { get(keys), set(obj), remove(keys), clear(), dump() }`
  with the same promise-based shape as `chrome.storage.local`.
- Manifest: `manifest_version: 3`, `name: "Dev Login Vault"`, `version: "1.0.0"`, `background.service_worker:
  "src/background/worker.js"` (classic, no `"type"`), `action.default_popup: "src/popup/popup.html"`, `options_page:
  "src/options/options.html"`, `content_scripts`: matches `<all_urls>`, `all_frames: true`, `run_at: "document_idle"`,
  js `["src/lib/ns.js","src/lib/forms.js","src/content/content.js"]`, icons 16/32/48/128 for both `icons` and `action.default_icon`.

- [ ] **Step 1: Write `tests/manifest.test.mjs`**: `manifest is valid MV3` (parses, version 3), `permissions are exactly
  storage, webRequest, scripting, idle`, `no web_accessible_resources`, `every referenced file exists` (worker, popup, options,
  content scripts, four icons).
- [ ] **Step 2: Run** `node --test tests/` → FAIL (files missing).
- [ ] **Step 3: Create the files above.** `make-icons.ps1` writes the four PNGs from `icons/icon-source.png` with
  `InterpolationMode HighQualityBicubic`, `SmoothingMode HighQuality`, transparent background. Run it:
  `powershell -File scripts/make-icons.ps1`. `serve.mjs` serves the project root on `localhost:5599` with correct MIME types
  (`.html .js .css .png .json`).
- [ ] **Step 4: Run** `node --test tests/` → PASS. Ask Aloka to load the folder unpacked in Chrome and Edge and confirm the
  padlock icon shows with no errors on the extensions page.

### Task 2: Environment classification

**Files:** Create `src/lib/env.js`; Test `tests/env.test.mjs`

**Interfaces:**
- Produces: `DLV.env.classifyIp(ip: string | undefined | null): "local" | "remote" | "unknown"`;
  `DLV.env.DEFAULT_LABELS = { local: "Local IIS", remote: "Server" }`.

- [ ] **Step 1: Tests**: `127.0.0.1`, `127.5.6.7`, `::1`, `[::1]`, `0:0:0:0:0:0:0:1` → `local`; `10.1.2.3`, `192.168.1.5`,
  `52.1.2.3`, `2001:db8::1`, `::ffff:127.0.0.1`→`local`, `::ffff:52.1.2.3`→`remote`; `""`, `undefined`, `null` → `unknown`.
- [ ] **Step 2: Run** `node --test tests/env.test.mjs` → FAIL.
- [ ] **Step 3: Implement `classifyIp`.** Strip brackets; handle IPv4-mapped IPv6; loopback only = local.
- [ ] **Step 4: Run** → PASS.

### Task 3: Crypto

**Files:** Create `src/lib/crypto.js`; Test `tests/crypto.test.mjs`

**Interfaces:**
- Produces (all on `DLV.crypto`, base64 strings for bytes):
  - `ITERATIONS = 600000`
  - `randomSaltB64(): string` (16 bytes)
  - `deriveKey(password: string, saltB64: string, iterations = ITERATIONS): Promise<CryptoKey>` (AES-GCM 256, `extractable: true`)
  - `exportKeyB64(key: CryptoKey): Promise<string>`; `importKeyB64(b64: string): Promise<CryptoKey>`
  - `encryptJson(key: CryptoKey, value: unknown): Promise<{ iv: string, ciphertext: string }>`
  - `decryptJson(key: CryptoKey, box: { iv, ciphertext }): Promise<unknown>` — throws `DLV.crypto.WrongPasswordError` on
    authentication failure.

- [ ] **Step 1: Tests** (use `iterations = 1000` for speed except one test at the default): `round-trips an object`;
  `round-trips unicode and long secrets` (`"Pässwörd 🔒 "` and a 1200-char string, trailing space preserved);
  `wrong password throws WrongPasswordError`; `two encryptions of the same value use different IVs`;
  `exported key re-imports and decrypts`; `default iterations is 600000`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** with `crypto.subtle` (PBKDF2 → AES-GCM), `crypto.getRandomValues`, `btoa/atob` over bytes.
- [ ] **Step 4: Run** → PASS.

### Task 4: Vault model

**Files:** Create `src/lib/vault.js`; Test `tests/vault.test.mjs`

**Interfaces:**
- Consumes: `DLV.env.DEFAULT_LABELS`.
- Produces (pure; every function returns a new vault, never mutates):
  - `emptyVault(): Vault` — `{ version: 1, entries: [], neverSave: [], envLabels: {}, settings: { autoLockMinutes: 30, submitAfterFill: false } }`
  - `Entry = { id, origin, env: "local"|"remote", username, password, note, createdAt, updatedAt, lastUsedAt }` (ISO strings)
  - `findForSite(vault, origin, env: "local"|"remote"|"unknown"): { current: Entry[], other: Entry[] }` — `current` sorted by
    `lastUsedAt` desc; when `env` is `"unknown"`, `current` is empty and `other` holds both envs.
  - `classifyPending(vault, { origin, env, username, password }): "save" | "update" | "none" | "never"`
  - `upsertLogin(vault, { origin, env, username, password, note? }, nowIso): { vault, entry, outcome: "added"|"updated"|"unchanged" }`
  - `updateEntry(vault, id, changes: Partial<Pick<Entry,"username"|"password"|"note"|"env">>, nowIso): Vault`
  - `removeEntry(vault, id): Vault`; `markUsed(vault, id, nowIso): Vault`
  - `addNeverSave(vault, origin): Vault`; `removeNeverSave(vault, origin): Vault`
  - `labelFor(vault, origin, env): string`; `setLabel(vault, origin, env, label): Vault` (empty label → default)
  - `mergeVaults(local, incoming): { vault, counts: { added, updated, unchanged } }` — key = origin+env+username; newer
    `updatedAt` wins; nothing removed; `neverSave` union; `envLabels` incoming fills only missing labels; local settings kept.

- [ ] **Step 1: Tests**: `upsert adds then reports unchanged for same password`; `upsert with new password reports updated and
  keeps id`; `username is trimmed, match is case-sensitive`; `origins differing by port or scheme are separate`;
  `local and remote entries for the same origin are separate`; `classifyPending returns never for never-save origin`;
  `findForSite unknown env puts everything in other`; `findForSite sorts by lastUsedAt desc`; `merge: newer wins, older
  ignored, new added, none removed, counts correct`; `labelFor falls back to defaults`; `functions do not mutate input`
  (deep-freeze input).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** IDs with `crypto.randomUUID()`.
- [ ] **Step 4: Run** → PASS.

### Task 5: Export file

**Files:** Create `src/lib/exportFile.js`; Test `tests/exportFile.test.mjs`

**Interfaces:**
- Consumes: `DLV.crypto.*`.
- Produces: `DLV.exportFile.build(vault, password, iterations = DLV.crypto.ITERATIONS): Promise<string>` — JSON text
  `{ format: "dev-login-vault", version: 1, kdf: { name: "PBKDF2-SHA-256", iterations, salt }, iv, ciphertext }`;
  `DLV.exportFile.parse(text, password): Promise<Vault>` — throws `DLV.exportFile.InvalidFileError` (not JSON, wrong
  `format`, `version` ≠ 1, missing fields) or `DLV.crypto.WrongPasswordError`;
  `DLV.exportFile.fileName(date: Date): string` → `dev-login-vault-YYYYMMDD-HHmm.dlv.json` (local time).

- [ ] **Step 1: Tests**: `export round-trips unicode`; `rejects corrupt file` (`"{"`, `{"format":"x"}`, version 2);
  `wrong password throws WrongPasswordError`; `fileName pads month, day, hour, minute`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.

### Task 6: Forms (DOM)

**Files:** Create `src/lib/forms.js`, `tests/browser/run.html`, `tests/browser/forms.tests.js`,
`tests/browser/login-single.html`, `login-step1.html`, `login-step2.html`, `login-iframe.html`, `login-spa.html`

**Interfaces:**
- Produces on `DLV.forms`:
  - `isVisible(el: Element): boolean` (non-zero box, not `hidden`, not `display:none`/`visibility:hidden`)
  - `findPasswordField(root: Document | Element): HTMLInputElement | null` — first visible `input[type=password]`
  - `findUsernameField(passwordField: HTMLInputElement | null, root): HTMLInputElement | null` — nearest visible
    `input` of type `text|email|tel` or no type, before the password field in document order; prefer `autocomplete="username"`;
    with no password field, the visible username-like field in the form (step 1 of a two-step page).
  - `readCredentials(root): { username: string, password: string } | null` — null when the password is empty.
  - `setValue(input: HTMLInputElement, value: string): void` — native setter from `HTMLInputElement.prototype` +
    `input` and `change` events (bubbling).
  - `findSubmit(passwordField): HTMLElement | null` — submit button of the form, else nearest button/`input[type=submit]`
    whose text matches `/log ?in|sign ?in|submit|continue|next/i`.
- `run.html` loads `ns.js`, `forms.js`, the tests, and writes `ALL PASS` or the failures into `#result`.

- [ ] **Step 1: Write `forms.tests.js`** with tests: `finds fields on single-step page`; `ignores hidden decoy username`;
  `prefers autocomplete=username`; `step-1 page returns username field with no password`; `readCredentials null for empty
  password`; `setValue fires input and change`; `findSubmit finds button by text`. Fixture markup mirrors the EHRM login
  (`/hr/security/login`: username + password + "Login" button).
- [ ] **Step 2: Run** `node scripts/serve.mjs` (background), open `http://localhost:5599/tests/browser/run.html` in the
  built-in browser pane, read `#result` → failures.
- [ ] **Step 3: Implement `forms.js`.**
- [ ] **Step 4: Reload** → `ALL PASS`.

### Task 7: VaultService (all worker rules, testable in Node)

**Files:** Create `src/lib/service.js`; Test `tests/service.test.mjs`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces: `new DLV.VaultService({ local, session, now = () => new Date(), iterations = DLV.crypto.ITERATIONS })` where
  `local`/`session` have the `chrome.storage` promise API. Storage keys: local `vaultBox = { salt, iterations, iv, ciphertext }`;
  session `keyB64`, `pending:<tabId>`, `tabEnv:<tabId>:<origin>`, `step1User:<tabId>:<origin>`.
  Methods (all async):
  - `status(): { initialized: boolean, unlocked: boolean }`
  - `setup(password)` — fails if already initialized; creates empty vault, unlocks.
  - `unlock(password): boolean` — false on wrong password; `lock()` — removes `keyB64` and all `pending:*`.
  - `getVault(): Vault` (throws `DLV.VaultService.LockedError` when locked); private `save(vault)` re-encrypts with new IV.
  - `setTabEnv(tabId, origin, ip)`; `getTabEnv(tabId, origin): "local"|"remote"|"unknown"`; `clearTab(tabId)`.
  - `rememberStep1User(tabId, origin, username)`; `takeStep1User(tabId, origin): string | null`.
  - `putPending(tabId, { origin, username, password })` — stores with `env = getTabEnv`, `expiresAt = now + 120000`.
  - `getPending(tabId): { origin, env, username, kind: "save"|"update"|"locked" } | null` — never returns the password;
    expired → deleted and null; `classifyPending` `none`/`never` → deleted and null; locked → `kind: "locked"`.
  - `savePending(tabId, env?: "local"|"remote")` — env required when pending env is `unknown`; upserts, deletes pending.
  - `dismissPending(tabId)`; `neverForPending(tabId)`.
  - `listForSite(origin, env): { current, other, labels: { local, remote } }` (entries without passwords: `{ id, username, env, note, lastUsedAt }`)
  - `getFillData(id, tabOrigin): { username, password } ` — throws if `entry.origin !== tabOrigin`; marks used.
  - `addEntry`, `updateEntry`, `deleteEntry`, `setLabel`, `setSettings(partial)`, `getSettings()`
  - `changePassword(oldPw, newPw): boolean` — new salt.
  - `exportVaultPlain(): Vault` (options page only); `importVault(vault): counts` — merge + save.
  - `deleteAll()` — clears local and session.

- [ ] **Step 1: Tests** (`iterations: 1000`, fake storage, fixed clock): `setup then status unlocked`; `unlock with wrong
  password returns false and stays locked`; `vault on disk never contains the password text` (search `local.dump()` JSON for
  the plaintext); `lock removes key and pendings`; `new service instance resumes unlocked state and pending login` (same
  storages, new `VaultService`); `pending expires after 120 s`; `getPending never exposes the password`; `pending is "update"
  for known username with new password`; `pending for unknown env requires env on save`; `locked pending reports kind locked
  and saves after unlock`; `getFillData refuses a different origin`; `changePassword re-encrypts, old password fails`;
  `failed import leaves vault untouched` (import throws mid-way → stored box unchanged); `step-1 username is taken once`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `node --test tests/` → all PASS.

### Task 8: Service worker wiring

**Files:** Modify `src/background/worker.js`

**Interfaces:**
- Consumes: `VaultService` (Task 7). `importScripts("../lib/ns.js", "../lib/env.js", "../lib/crypto.js", "../lib/vault.js",
  "../lib/exportFile.js", "../lib/service.js")`; one service with `chrome.storage.local` / `chrome.storage.session`.
- Produces: `chrome.runtime.onMessage` router; every message is `{ type, ...args }`, every reply `{ ok: true, data } |
  { ok: false, error: "LOCKED" | "WRONG_PASSWORD" | "INVALID_FILE" | "ORIGIN_MISMATCH" | string }`. Types, mapped 1:1 to
  service methods: `status, setup, unlock, lock, listForSite, fill, pendingCapture, pendingStep1, pendingForTab,
  savePending, dismissPending, neverForPending, addEntry, updateEntry, deleteEntry, setLabel, getSettings, setSettings,
  changePassword, exportVaultPlain, importVault, deleteAll, tabEnv`. Tab id comes from `sender.tab.id` for content-script
  messages, from the message for popup messages. `exportVaultPlain`, `importVault`, `changePassword`, `deleteAll`,
  `setup`, `unlock` are refused when `sender.tab` is set (content scripts may only send `pendingCapture`, `pendingStep1`,
  `pendingForTab`, `savePending`, `dismissPending`, `neverForPending`).
- Events: `webRequest.onResponseStarted` (`main_frame`, `sub_frame`, `<all_urls>`) → `setTabEnv`; `tabs.onRemoved` →
  `clearTab`; `windows.onRemoved` with `windows.getAll()` empty → `lock`; `idle.setDetectionInterval(minutes*60)`,
  `idle.onStateChanged` `idle`/`locked` → `lock`; re-apply interval on start and on `setSettings`. Badge: `"!"` on a tab with a
  locked pending login (orange `#FEA832` background), cleared on save/dismiss/unlock.
- `fill`: service `getFillData`, then `chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func, args:
  [username, password, entryOrigin, submitAfterFill] })` where `func` only acts when `location.origin === entryOrigin` and
  calls `DLV.forms.setValue` (content script already loaded `forms.js`).

- [ ] **Step 1: Add a Node test `tests/worker.router.test.mjs`**: router refuses `exportVaultPlain` from a tab sender;
  unknown type → `{ ok: false }`. (Export the router as `DLV.createRouter(service, chromeLike)` from `worker.js` so it loads
  in Node with a stub `chrome`.)
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; reload the unpacked extension in Chrome and
  confirm no errors in the service-worker console.

### Task 9: Content script — capture, save bar, two-step

**Files:** Modify `src/content/content.js`; Create `tests/browser/content.tests.js` (stubbed `chrome.runtime.sendMessage`)

**Interfaces:**
- Consumes: `DLV.forms`, worker messages `pendingCapture { origin, username, password }`, `pendingStep1 { origin, username }`,
  `pendingForTab`, `savePending { env? }`, `dismissPending`, `neverForPending`.
- Behaviour: capture on `submit` (capture phase), on click of `findSubmit(...)`, and on Enter in the password field; if there is
  a password, send `pendingCapture` (username empty → worker uses step-1 username); if only a username field, send
  `pendingStep1`. Top frame only: on load and 2 s after a capture with no navigation, ask `pendingForTab`; if present, show the bar.
- Save bar: fixed top, full width, closed Shadow DOM, navy `#2F5274`, white text, inline styles (no external CSS). Text:
  `Save login "<username>" for <host> (<label>)?` / `Update password for "<username>" on <host> (<label>)?` /
  `Unlock Dev Login Vault to save "<username>"`. Buttons: `Save` (orange, black text, 2 px black outline), env select when
  env is `unknown` (Save disabled until chosen) or `Change environment`, `Never for this site`, `Not now`. Green `Saved` toast
  for 2 s after save. Username rendered with `textContent` only.

- [ ] **Step 1: Tests**: `submit sends pendingCapture with credentials`; `two-step login pairs remembered username` (step1
  page sends `pendingStep1`, step2 capture sends empty username); `bar shows update text for kind update`; `Save disabled until
  env chosen when env unknown`; `username with markup is shown as text`; `no bar inside iframes`.
- [ ] **Step 2: Run** in `run.html` → FAIL. **Step 3: Implement.** **Step 4: Reload** → `ALL PASS`.

### Task 10: Popup

**Files:** Create `src/ui/theme.css`, `src/popup/popup.html|.js|.css`

**Interfaces:**
- Consumes: messages `status, setup, unlock, lock, listForSite, fill, tabEnv, addEntry, updateEntry, deleteEntry,
  savePending, pendingForTab` (with `tabId` from `chrome.tabs.query({ active: true, currentWindow: true })`).
- `theme.css`: CSS variables `--dlv-orange #FEA832`, `--dlv-navy #2F5274`, `--dlv-green #70DA40`, `--dlv-ink #000`,
  `--dlv-light #F1F1F1`, `--dlv-white #FFF`, `--dlv-error #C62828`; buttons 2 px ink outline, 8 px radius; header navy with
  32 px icon and title.
- Views (one at a time): **Setup** (password twice, min 8 chars, mismatch error) → **Locked** (password, Unlock, error
  "Wrong password") → **List**: header with host and env badge (Local = orange, Server = navy, Unknown = grey "Unknown — reload
  the page"), search box, `current` rows (username, note; click = fill and close popup; icons: show, copy password, edit,
  delete with confirm), collapsed "Other environment (<label>)" section, `+ Add` form (username, password, note, env defaulting
  to current), `Lock` button, link to options. On non-http(s) tabs: "Open a website to see its logins".
  Width 360 px.

- [ ] **Step 1: Implement** the popup.
- [ ] **Step 2: Manual check** (Aloka reloads the extension; the fixture pages are driven at
  `http://localhost:5599/tests/browser/login-single.html` with test-only accounts): setup → save → lock → unlock → fill →
  fill + submit setting → edit → delete. Unknown env case: Back to a cached page.

### Task 11: Options page — settings, export, import

**Files:** Create `src/options/options.html|.js|.css`

**Interfaces:**
- Consumes: messages `getSettings, setSettings, changePassword, exportVaultPlain, importVault, setLabel, deleteAll,
  status, unlock`; `DLV.exportFile.build/parse/fileName` loaded in the page.
- Sections: Lock & security (auto-lock minutes 5–240, change master password), Filling (Submit after filling), Never-save list
  (remove), Environment labels per site (edit), **Export** (password, default "use master password" checkbox; builds the file in
  the page, saves via Blob URL + `<a download>`, then `URL.revokeObjectURL`), **Import** (file input + password; shows
  "Added N, updated N, unchanged N" in green or the error in red), Danger zone (Delete all data: type `DELETE` to confirm).
  Page locked → unlock form first.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Manual check**: export in Chrome → import in Edge → counts correct; import again → all unchanged; wrong
  password → error, nothing changed.

### Task 12: README and full check

**Files:** Create `README.md`

- [ ] **Step 1: README**: what it does; load unpacked in Chrome (`chrome://extensions`) and Edge (`edge://extensions`),
  Developer mode on; first-run master password (cannot be recovered; export is the backup); Local IIS vs Server detection
  and the hosts-file flip; moving logins between browsers; proxy note; how to run tests (`node --test tests/`,
  `node scripts/serve.mjs` + `tests/browser/run.html`).
- [ ] **Step 2: Run** `node --test tests/` → all PASS; browser `run.html` → `ALL PASS`.
- [ ] **Step 3: Aloka's real-site check** on `https://hrmmainphdev01.phrsandbox.dev/hr/security/login`: hosts line on →
  badge "Local IIS", save a philippinesdev login; hosts line off (+ reload) → badge "Server", that login only under "Other
  environment"; save a server login; flip back → each list shows only its own logins.