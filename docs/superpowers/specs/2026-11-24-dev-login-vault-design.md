# Dev Login Vault — design

Date: 24 November 2026. Status: **approved by Aloka 24/11/2026** (with icon and colour theme, section 6.6).

## 1. Intent

Aloka works across many PeoplesHR instances (locally hosted on IIS, server-hosted, dev, QA), each with several user accounts.
Finding the right username and password for the right instance is slow and error-prone. Dev Login Vault is a personal browser
extension that:

- offers **"Save login?"** when Aloka signs in on a site, and stores the site, username and password;
- on a login page, shows the saved usernames for that site; **clicking a username fills the username and password fields**.

It is a personal tool, for one user, installed with "Load unpacked". It is not published to any store.

## 2. Goals, non-goals, anti-goals

**Goals**

- One extension that runs unchanged in **Microsoft Edge** (158) and **Google Chrome** (157), both Chromium, Manifest V3.
- Many accounts per site, listed in the popup.
- Tells apart **two copies of the same URL**: the local IIS copy and the server copy (section 5).
- Passwords are stored encrypted, unlocked with one master password.
- Moving logins between Edge and Chrome through an **encrypted export/import file** (chosen option 2).

**Non-goals**

- Live sync between the browsers (would need a native helper program; rejected).
- Telling apart two *different remote* servers behind the same URL (only local vs remote).
- Password generation, breach checks, passkeys, TOTP codes, credit cards, form-filling beyond username + password.
- Firefox / Safari.

**Anti-goals** (failure even if it "works")

- Credentials leave the machine in any way: no `chrome.storage.sync`, no network calls, no analytics, no remote code.
- A password is ever written unencrypted to disk, to the console, or to a log.
- The extension fills a form by itself without a click (silent auto-fill on page load can leak into a wrong or look-alike page).
- A local-IIS login is offered as the main choice on the server copy, or the reverse.

## 3. Constraints

- Plain JavaScript (ES modules), HTML and CSS. **No build step and no npm dependencies** in the extension, so the folder can be
  loaded as-is. Node 24 is on the machine and is used only to run unit tests (`node --test`), with no packages.
- Cryptography uses the browser's built-in Web Crypto API only.
- Location: `C:\Github aloka-pa\dev-login-vault\` (the parent folder holds other projects).
- **No git commits or pushes** in this project (Aloka's instruction).

## 4. Approaches considered

### 4.1 Sharing logins between Edge and Chrome (decided by Aloka)

| Option | Trade-off | Decision |
|---|---|---|
| 1. Separate lists per browser | Simplest; save each login twice | Rejected |
| **2. Separate lists + encrypted export/import file** | Little extra work; manual sync when wanted | **Chosen** |
| 3. One live shared list through a Windows helper program | Most convenient; much more to build and install | Rejected |

### 4.2 Telling the local IIS copy from the server copy (decided by Aloka)

`https://hrmmainphdev01.phrsandbox.dev/hr/...` is either the local IIS copy (hosts file maps the name to `127.0.0.1`, database
`hrmmain_philippinesdev`) or the server copy (hosts line commented out, database `hrmmain_philippines`). The user accounts differ.

| Option | Trade-off | Decision |
|---|---|---|
| **Automatic, by the IP address the page was served from** | No effort; correct after flipping the hosts file | **Chosen** |
| Pick the environment by hand on every save and fill | Simple to build; easy to get wrong | Rejected |

## 5. Environment detection

- The background service worker listens to `chrome.webRequest.onResponseStarted` for `main_frame` and `sub_frame` requests
  (observe only, never blocking) and records `details.ip` per tab and origin.
- Classification: `127.0.0.0/8` and `::1` → **`local`**; anything else → **`remote`**.
- The class is taken from the **current tab's latest response for that origin** only. There is **no fallback** to an older value:
  after a hosts-file flip, a remembered class would be wrong. If the page has no IP (served from the HTTP cache, or restored with
  Back/Forward, which fires no webRequest event), the environment is **unknown**:
  - the save bar requires Aloka to pick Local IIS or Server before Save is enabled;
  - the popup shows both environments' logins in two labelled sections with no main list, and a hint "Reload the page to detect
    the environment".
- If a proxy is configured, `details.ip` is the proxy's address. Loopback hosts bypass the proxy by default, so the local copy
  is still detected; documented in the README.
- Each saved login carries `env: "local" | "remote"`. Default labels: **"Local IIS"** and **"Server"**; Aloka can rename them
  per site (e.g. "Local IIS – philippinesdev").
- Works for any host, not only `hrmmainphdev01` (e.g. `echoengineers`, `hrmv102phqaupgrade` when their hosts lines are on).

## 6. Behaviour

### 6.1 Saving

1. A content script on every page (top frame and same-origin frames) watches for sign-in: a form submit, a click on a submit-like
   button, or Enter in a password field, where the form has a visible password field.
2. It takes the **username** (the nearest visible text/email input before the password field) and the **password**, and sends
   them to the background worker, which keeps them as the tab's pending login (with origin and env) in
   **`chrome.storage.session`**: held in memory, never written to disk, and kept at the default access level
   (`TRUSTED_CONTEXTS`) so content scripts and web pages cannot read it. (Plain worker memory is not enough: an MV3 service worker
   is stopped after about 30 seconds without events.) The pending login is deleted when saved, dismissed or expired.
3. Because a login page usually navigates away, the prompt appears on the **next page in the same tab** (or straight away if the
   page did not navigate after 2 seconds). Pending logins expire after 2 minutes.
4. The prompt is a small bar at the top of the page (inside a Shadow DOM so the site's CSS cannot touch it):
   `Save login "00001774" for hrmmainphdev01.phrsandbox.dev (Local IIS)?  [Save] [Change environment ▾] [Never for this site] [Not now]`
5. Cases:
   - Same origin + env + username + password already saved → no prompt (update `lastUsedAt` only).
   - Same origin + env + username, different password → **"Update password?"**.
   - Site is on the "never" list → no prompt.
   - Vault locked → the bar says **"Unlock Dev Login Vault to save"**; the pending login waits (2 minutes) and the icon shows a
     badge. Saving completes after unlocking from the popup.

### 6.2 Filling

1. Clicking the toolbar icon opens the popup. It shows the current site and an environment badge (**Local IIS** / **Server**).
2. It lists the saved usernames for **this origin + this env**, most recently used first, with a search box. Logins for the other
   environment of the same site sit in a collapsed section "Other environment (Server)" and can still be used deliberately.
3. **Clicking a username fills** the username and password fields in the page (top frame, plus same-origin frames). Values are
   set with the native value setter and `input`/`change` events so framework-driven forms see them.
4. A setting **"Submit after filling"** (default **off**) presses the form's submit button after a fill.
5. Per entry: show/copy password, edit, delete. A **"+ Add"** button adds a login manually for the current site.
6. Filling only happens on click. Credentials are only sent to a page whose origin equals the entry's origin.

### 6.3 Lock and master password

- First run: the popup asks Aloka to set a master password (entered twice).
- The key is derived with **PBKDF2-SHA-256, 600,000 iterations, 16-byte random salt** → **AES-GCM 256** key.
- The whole vault is one JSON document, encrypted with AES-GCM (fresh 12-byte IV per write), stored in `chrome.storage.local`.
- While unlocked, the derived key is kept in `chrome.storage.session` (memory only, `TRUSTED_CONTEXTS`) so the service worker
  can restart without re-asking. A `CryptoKey` cannot be stored there, so the key is derived as extractable, stored as base64
  raw bytes, and re-imported after a worker restart.
- `storage.session` is **not** reliably cleared when the last window closes (Edge Startup Boost / "continue running background
  apps" keep the browser process alive), so locking is explicit. The vault locks:
  - when the **last browser window closes** (`chrome.windows.onRemoved` with no windows left);
  - when **Windows is locked** (`chrome.idle` state `locked`);
  - after **30 minutes with no keyboard or mouse input on the computer** (`chrome.idle`, setting);
  - from the **Lock** button.
  Locking deletes the key and any pending logins from session storage.
- A forgotten master password cannot be recovered. The export file is the backup.
- Change master password: re-encrypts the vault with a new salt and key.

### 6.4 Export / import (moving between Edge and Chrome)

- **Export** (options page): asks for an export password (default: same as master), writes
  `dev-login-vault-YYYYMMDD-HHmm.dlv.json` = `{ format: "dev-login-vault", version: 1, kdf: { name, iterations, salt },
  iv, ciphertext }`. The file is built in the **options page** (a service worker has no `URL.createObjectURL`) and saved with a
  Blob URL and `<a download>`, so no `downloads` permission is needed.
- **Import**: pick the file, enter its password, then merge: entries match on origin + env + username; the newer `updatedAt`
  wins; new entries are added; nothing is deleted. A summary shows added / updated / unchanged counts.
- Never-save list and environment labels are merged too.

### 6.5 Options page

Export, import, change master password, auto-lock minutes, "Submit after filling", never-save list, environment labels per
site, "Delete all data" (with confirmation).

### 6.6 Icon and colour theme (Aloka's choice)

> **Update 24/11/2026 (Aloka):** the UI is a **dark, modern theme**: blue-black surfaces (`#0E131A`, `#151C25`), the icon's
> orange as the primary accent, a light navy (`#8DB4DE`) for "Server", green for success, rounded cards and line icons.
> The save prompt is a floating card in the top-right corner. The table below lists the original accent colours.

- **Icon:** the open padlock with a green tick, supplied by Aloka, kept as `icons/icon-source.png` (512 × 512). The 16, 32, 48 and
  128 px icons are resized from it with high-quality scaling.
- **Colours**, taken from the icon:

  | Role | Colour | Use |
  |---|---|---|
  | Lock orange | `#FEA832` | primary buttons (Save, Fill, Unlock), selected item, "Local IIS" badge |
  | Shackle navy | `#2F5274` | popup/options header and save-bar background (white text), "Server" badge |
  | Tick green | `#70DA40` | success messages ("Saved", "Imported"), unlocked indicator |
  | Ink | `#000000` | text on orange/green, 2 px rounded outlines on buttons and cards (the icon's thick-outline style) |
  | Keyhole light | `#F1F1F1` | page background of popup and options |
  | White | `#FFFFFF` | cards, inputs, text on navy |

  All text pairs meet WCAG AA contrast (white on navy, black on orange, black on green). Errors use a red (`#C62828`) outside the
  icon's palette, as red is reserved for problems.

## 7. Data model (decrypted vault)

```json
{
  "version": 1,
  "entries": [
    { "id": "uuid", "origin": "https://hrmmainphdev01.phrsandbox.dev", "env": "local",
      "username": "00001774", "password": "…", "note": "",
      "createdAt": "ISO", "updatedAt": "ISO", "lastUsedAt": "ISO" }
  ],
  "neverSave": ["https://example.test"],
  "envLabels": { "https://hrmmainphdev01.phrsandbox.dev": { "local": "Local IIS – philippinesdev", "remote": "Server" } },
  "settings": { "autoLockMinutes": 30, "submitAfterFill": false }
}
```

A site is identified by its **origin** (scheme + host + port), not the path: `/hr/security/login` and `/hr/home` are the same site.

## 8. Structure

```
dev-login-vault/
  manifest.json            MV3; permissions: storage, webRequest, scripting, idle; host_permissions <all_urls>
  icons/                   16/32/48/128 px
  src/lib/                 pure, testable code as CLASSIC scripts (no import/export) that attach to globalThis.DLV;
                           loaded by content_scripts (listed before content.js), by the worker (importScripts, classic worker),
                           by popup/options (<script> tags), and by Node tests (executed, then read from globalThis.DLV).
                           Content scripts cannot use ES modules without a build step or exposing files to web pages.
    crypto.js              derive key, encrypt, decrypt
    vault.js               entries: add/update/find/merge, never-save, labels
    env.js                 IP → local/remote
    forms.js               find username/password fields, decide "is this a sign-in"
    exportFile.js          build/parse export file
  src/background/worker.js service worker: vault state, lock, pending logins, IP tracking, message routing
  src/content/content.js   detect sign-in, show save bar, fill
  src/popup/               popup.html / .js / .css
  src/options/             options.html / .js / .css
  tests/                   node --test unit tests for src/lib, plus a local fixture login page for manual checks
  docs/superpowers/specs/  this document
  README.md                how to load unpacked in Edge and Chrome, how to export/import
```

## 9. Testing

- **Unit tests** (`node --test`, no packages): crypto round-trip and wrong-password failure, vault merge rules, IP
  classification (IPv4/IPv6 loopback, private, public, missing), form detection against HTML fixtures, export file round-trip.
- **Local smoke** on a fixture login page served from `localhost` with test-only accounts: save prompt, update prompt, never-save,
  fill, fill + submit, lock/unlock, export from Chrome and import into Edge.
- **Real-site check by Aloka** on `hrmmainphdev01` with the hosts line on (Local IIS) and off (Server): each shows only its own
  logins.
## 10. Design calls (open to change)

- Name "Dev Login Vault" and the folder `dev-login-vault`.
- Plain JS, no build step; unit tests with Node's built-in runner.
- Master password + PBKDF2 600k + AES-GCM; auto-lock 30 minutes.
- Save prompt shown on the page after sign-in, as a bar at the top.
- Fill only on click; "submit after filling" off by default.
- Site = origin; environment = local vs remote only.
- Import merges (newer wins), never deletes.
- A pending login (plaintext, before Save) waits in `chrome.storage.session` (memory, not disk) for up to 2 minutes.
- Unknown environment (no IP) means "ask", never "reuse the last one".
- Idle lock = no keyboard/mouse on the computer for 30 minutes, plus lock on Windows lock and on last window closed.
- Shared code as classic scripts on `globalThis.DLV`, not ES modules, so content scripts can use it without a build step.

## 11. Left to the builder

Exact popup layout and styling, icon artwork, heuristics for unusual login forms (multi-step username-then-password pages are
handled best-effort: remember the username from step 1 for the same tab and origin), message names between scripts.
