# Login Vault

A personal browser extension for Microsoft Edge and Google Chrome that remembers your logins (work dev/QA instances,
university, any other site), encrypted on this device.

- When you sign in, it offers **Save login?** and stores the site, username and password, encrypted with your master password.
- On a login page, click the padlock in the toolbar and **click a username to fill** the username and password.
- It tells apart the **local IIS copy** of a site (the hosts file points the name at `127.0.0.1`) from the **server copy**
  of the same URL, and keeps their logins separate.
- Logins never leave your computer. To move them between Edge and Chrome, use an encrypted **export file**.

## Install (both browsers)

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose this folder (`C:\Github aloka-pa\dev-login-vault`).
4. Pin the padlock icon to the toolbar.

After changing any file, click the reload arrow on the extension's card.

## First use

Click the padlock and set a **master password** (at least 8 characters). It cannot be recovered. If you forget it, the saved
logins are lost, so keep an export file as a backup.

## Recovery key (if you forget the master password)

When you create the vault, the extension shows a **recovery key** like `DLV-7KQ2-…-M9X4`. Copy or download it and keep it
somewhere safe and offline. If you forget the master password, click **Forgot master password?** on the unlock screen,
enter the recovery key and choose a new master password. Your logins stay as they are.

- Vaults made before this feature are upgraded the first time you unlock them; the popup then reminds you to create a key.
- **Settings → Recovery key** makes a new key; the old one stops working.
- Anyone with the recovery key can open the vault, just like with the master password.
- Without the master password and without the recovery key, the vault cannot be opened by anyone.

## Saving a login

Sign in as usual. A dark card appears in the top-right corner of the next page:

> Save login "00001774" for hrmmainphdev01.phrsandbox.dev (Local IIS)?
> [environment ▾]  Never for this site · [Not now] [Save]

- **Update password** appears when the username is saved already with a different password.
- If the vault is locked, the bar asks you to unlock first, and the toolbar icon shows **!**. Unlock from the padlock within
  2 minutes and the bar comes back.
- Login pages that ask for the username and the password on separate screens are supported.

## Filling a login

Open the login page and click the padlock. The popup shows the site, an environment badge and the saved usernames for that
environment, most recently used first. Click a username to fill. Logins of the other environment are under
**Other environment**. Per login you can show or copy the password, edit it or delete it. **+ Add** adds one by hand.

Filling only happens when you click. **Submit the form after filling** can be turned on in Settings.

## Local IIS or Server

The extension looks at the IP address each page came from:

| Address | Environment | Default name |
|---|---|---|
| `127.x.x.x` or `::1` | Local | Local IIS |
| anything else | Server | Server |

So with `127.0.0.1 hrmmainphdev01.phrsandbox.dev` switched on in `C:\Windows\System32\drivers\etc\hosts` you get the
`hrmmain_philippinesdev` logins, and with the line commented out you get the `hrmmain_philippines` (server) logins.

- After changing the hosts file, **reload the page** (browsers cache DNS for a short while; if the badge is still wrong,
  open `chrome://net-internals/#dns` / `edge://net-internals/#dns` and click **Clear host cache**).
- When a page comes from the browser cache or Back/Forward, the address is not known. The badge says **Unknown**, the
  popup lists all logins for the site, and the save bar asks you to pick the environment. Reload the page to detect it.
- If your browser uses a proxy, the address seen is the proxy's. Local (`127.0.0.1`) sites normally bypass the proxy.
- Rename the environments per site in **Settings** (e.g. "Local IIS – philippinesdev").

### Environment banner

On sites where Local/Server matters, a thin coloured strip with a small name tab sits at the top of every page:
orange for **Local IIS**, navy for **Server**, grey when the environment is unknown. It never blocks clicks. Give the names
your database, e.g. "Local IIS – philippinesdev" and "Server – hrmmain_philippines (read-only)", in Settings →
Environment names, and the tab shows them as "Local IIS · philippinesdev". While the vault is locked, only pages served
from this computer show the strip (with the default name). Turn it off in Settings → Filling.

### Switch user (EHRM)

On EHRM pages the popup shows **Switch user**. It signs you out (`<app>/security/logoff`, e.g. `/hr/security/logoff`);
EHRM returns to its sign-in page, where you open the padlock and click the next user.

### N/A: sites where hosting does not matter

For ordinary websites (Microsoft sign-in, Azure DevOps, …) choose **N/A (not environment-specific)** when saving or adding
a login. N/A logins are offered on that site whatever its address is, and they never show a Local/Server label.

The Local/Server chip in the popup only appears on sites where it matters: a site served from this computer, or one that
already has Local IIS or Server logins. On other sites the chip and the "Environment unknown" message are hidden, and new
logins default to N/A.

## Moving logins between Edge and Chrome

1. In the browser that has the logins: padlock → **Settings, export and import** → **Export**, choose a password for the
   file, **Download export file**.
2. In the other browser: Settings → **Import**, choose the file, enter its password, **Import**.

Import merges: when the same site, environment and username exist on both sides, the newer one wins. Nothing is deleted.
Delete the export file when you are done with it.

## Locking

The vault locks after 30 minutes with no keyboard or mouse use (change it in Settings), when Windows locks, when you close
the last browser window, and when you click **Lock**.

## Security notes

- The vault is encrypted with AES-GCM 256; the key comes from your master password with PBKDF2-SHA-256 (600,000 rounds).
- While unlocked, the key is held in the browser's session storage (memory only, not readable by web pages).
- A login you just typed waits in memory for up to 2 minutes until you click Save; it is never written to disk unencrypted.
- No network calls, no browser sync, no remote code.
- **Copy password** puts the password on the Windows clipboard, where it stays until you copy something else. If Windows
  clipboard history or cloud clipboard is on, it may be kept there too. Prefer clicking the username to fill.

## Development

No build step and no npm packages. Node 24 is used only for tests.

```powershell
node --test "tests/**/*.test.mjs"
```

Browser tests and previews (served on `http://localhost:5599`):

```powershell
node scripts/serve.mjs
```

- `tests/browser/run.html`: form detection and save-bar tests; shows `ALL PASS (n)`.
- `tests/browser/preview.html?page=popup&env=local` (or `page=options`, `env=remote|unknown`, `state=locked|new|empty`):
  the real popup and settings pages running on the real vault code with in-memory, test-only data.
- `tests/browser/login-*.html`: fixture login pages (single step, two step, iframe, no navigation) for trying the installed
  extension with made-up accounts.

Icons are made from `icons/icon-source.png` with `scripts/make-icons.ps1`.

Design: `docs/superpowers/specs/2026-11-24-dev-login-vault-design.md`. Plan: `docs/superpowers/plans/2026-11-24-dev-login-vault.md`.
