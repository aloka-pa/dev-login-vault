// Content script: notices sign-ins, shows the "Save login?" bar in the top frame, and asks the worker for nothing else.
// Filling is done by the worker injecting a function after a click in the popup (see worker.js fillInPage).
(function (DLV) {
  if (!DLV || !DLV.forms || DLV.content) return;
  const F = DLV.forms;
  const isTop = window === window.top;
  const STEP_TEXT = /\b(next|continue|log ?in|sign ?in|submit)\b/i;
  const NO_NAVIGATION_MS = 2000;

  async function send(message) {
    try { return await chrome.runtime.sendMessage(message); } catch { return null; }
  }

  // ---- Capture ----
  let showTimer = null;

  /** scope: the form (or document) the sign-in happened in; the step-1 username is only read from there. */
  function capture(scope) {
    const creds = F.readCredentials(document);
    if (creds) {
      send({ type: 'pendingCapture', username: creds.username, password: creds.password }).then(() => {
        if (!isTop) { send({ type: 'pendingNudge' }); return; }
        clearTimeout(showTimer);
        showTimer = setTimeout(checkPending, NO_NAVIGATION_MS);
      });
      return;
    }
    if (F.findPasswordField(document)) return;
    const user = F.findUsernameField(null, scope instanceof Element || scope instanceof Document ? scope : document);
    const name = user && user.value.trim();
    if (name) send({ type: 'pendingStep1', username: name });
  }

  function onClick(event) {
    const el = event.target instanceof Element && event.target.closest('button, input[type="submit"], input[type="button"], [role="button"], a');
    if (!el) return;
    const pw = F.findPasswordField(document);
    if (pw) { if (el === F.findSubmit(pw)) capture(); return; }
    const text = el.tagName === 'INPUT' ? el.value : el.textContent;
    if (STEP_TEXT.test(text || '') || el.type === 'submit') capture(el.form || el.closest('form') || document);
  }

  function onKeydown(event) {
    if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return;
    capture(event.target.form || document);
  }

  document.addEventListener('submit', (event) => capture(event.target), true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeydown, true);

  // ---- Save bar (top frame only) ----
  let lastBar = null;

  function removeBar() {
    if (lastBar) lastBar.host.remove();
    lastBar = null;
    api.lastBar = null;
  }

  async function checkPending() {
    if (!isTop) return;
    const reply = await send({ type: 'pendingForTab' });
    if (reply && reply.ok && reply.data) showBar(reply.data);
  }

  const STYLE = `
    :host { all: initial; }
    .bar { position: fixed; top: 16px; right: 16px; z-index: 2147483647; width: min(380px, calc(100vw - 32px));
      box-sizing: border-box; padding: 14px; border-radius: 16px; background: rgba(21, 28, 37, 0.97); color: #E8EDF3;
      border: 1px solid #2D3A4C; box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(254, 168, 50, 0.08);
      font: 13.5px/1.45 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; -webkit-font-smoothing: antialiased;
      animation: dlv-in 0.18s ease-out; }
    @keyframes dlv-in { from { transform: translateY(-8px); } to { transform: none; } }
    .head { display: flex; gap: 12px; align-items: flex-start; }
    .logo { flex: none; width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center;
      background: rgba(254, 168, 50, 0.14); color: #FEA832; }
    .logo svg { width: 18px; height: 18px; }
    .text { flex: 1; min-width: 0; }
    .brand { display: block; font-size: 11px; font-weight: 650; letter-spacing: 0.6px; text-transform: uppercase; color: #6F7D8F; }
    .msg { display: block; font-weight: 600; overflow-wrap: anywhere; margin-top: 2px; }
    .msg.ok { color: #A6EE85; }
    .msg.err { color: #FFB3B3; }
    .controls { display: grid; gap: 10px; margin-top: 12px; }
    .buttons { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
    button, select { font: inherit; font-size: 12.5px; font-weight: 600; border-radius: 9px; cursor: pointer;
      border: 1px solid #344358; background: #1B2430; color: #E8EDF3; padding: 7px 12px; transition: background .15s, border-color .15s; }
    button:hover:not(:disabled) { background: #222D3B; border-color: #45566E; }
    button.ghost { background: transparent; border-color: transparent; color: #A5B1C0; margin-right: auto; padding-left: 4px; }
    button.ghost:hover:not(:disabled) { background: transparent; color: #E8EDF3; text-decoration: underline; }
    button.primary { background: #FEA832; border-color: #FEA832; color: #17120A; }
    button.primary:hover:not(:disabled) { background: #FFB547; border-color: #FFB547; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    select { width: 100%; padding: 8px 10px; background: #0E131A; }
    button:focus-visible, select:focus-visible { outline: 2px solid #FEA832; outline-offset: 2px; }
    .x { flex: none; width: 28px; height: 28px; padding: 0; display: grid; place-items: center; border: 0; background: transparent; color: #6F7D8F; }
    .x:hover:not(:disabled) { background: #222D3B; color: #E8EDF3; }
    .x svg { width: 15px; height: 15px; }`;

  // Static, trusted icon markup (no page data).
  const LOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>';
  const X_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';

  function el(tag, props = {}, text) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v; else if (k.startsWith('data-')) node.setAttribute(k, v); else node[k] = v;
    }
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function message(p, env) {
    const host = new URL(p.origin).host;
    // N/A logins are not tied to Local/Server, so the message names no environment for them.
    const suffix = env === 'na' ? '' : ` (${env === 'local' || env === 'remote' ? p.labels[env] : 'choose environment'})`;
    if (p.kind === 'locked') return `Unlock Dev Login Vault to save "${p.username}". Click the padlock in the toolbar.`;
    if (p.kind === 'update') return `Update password for "${p.username}" on ${host}${suffix}?`;
    return `Save login "${p.username}" for ${host}${suffix}?`;
  }

  function showBar(p) {
    removeBar();
    const host = el('div');
    const root = host.attachShadow({ mode: 'closed' });
    root.appendChild(el('style', {}, STYLE));
    const bar = el('div', { class: 'bar', role: 'dialog', ariaLabel: 'Dev Login Vault' });
    const msg = el('span', { class: 'msg' }, message(p, p.env));
    const logo = el('span', { class: 'logo' });
    logo.innerHTML = LOCK_SVG;
    const text = el('div', { class: 'text' });
    text.append(el('span', { class: 'brand' }, 'Dev Login Vault'), msg);
    const head = el('div', { class: 'head' });
    head.append(logo, text);
    bar.append(head);

    const close = (type) => async () => { removeBar(); if (type) await send({ type }); };

    if (p.kind === 'locked') {
      const x = el('button', { type: 'button', class: 'x', 'data-action': 'close', title: 'Close', ariaLabel: 'Close', onclick: close(null) });
      x.innerHTML = X_SVG;
      head.append(x);
    } else {
      const controls = el('div', { class: 'controls' });
      const select = el('select', { ariaLabel: 'Environment', title: 'Change environment' });
      const ENV_CHOICES = ['local', 'remote', 'na'];
      if (!ENV_CHOICES.includes(p.env)) select.append(el('option', { value: '', selected: true, disabled: true }, 'Choose environment…'));
      for (const env of ENV_CHOICES) {
        const text = env === 'na' ? `${p.labels.na || 'N/A'} (not environment-specific)` : p.labels[env];
        select.append(el('option', { value: env, selected: env === p.env }, text));
      }
      const save = el('button', { type: 'button', class: 'primary', 'data-action': 'save', disabled: !select.value }, p.kind === 'update' ? 'Update' : 'Save');
      select.addEventListener('change', () => { save.disabled = !select.value; msg.textContent = message(p, select.value); });
      save.addEventListener('click', async () => {
        save.disabled = true;
        const reply = await send({ type: 'savePending', env: select.value });
        if (reply && reply.ok) {
          msg.textContent = 'Saved to Dev Login Vault';
          msg.className = 'msg ok';
          controls.remove();
          setTimeout(removeBar, 2000);
        } else {
          msg.textContent = reply && reply.error === 'LOCKED' ? 'The vault locked. Unlock it from the toolbar, then try again.' : 'Could not save this login.';
          msg.className = 'msg err';
          save.disabled = false;
        }
      });
      const buttons = el('div', { class: 'buttons' });
      buttons.append(
        el('button', { type: 'button', class: 'ghost', 'data-action': 'never', onclick: close('neverForPending') }, 'Never for this site'),
        el('button', { type: 'button', 'data-action': 'dismiss', onclick: close('dismissPending') }, 'Not now'),
        save);
      controls.append(select, buttons);
      bar.append(controls);
    }

    root.appendChild(bar);
    (document.body || document.documentElement).appendChild(host);
    lastBar = { host, root };
    api.lastBar = lastBar;
  }

  // ---- Page lifecycle ----
  chrome.runtime.onMessage.addListener((m) => {
    if (m && m.type === 'checkPending') { checkPending(); refreshBanner(); }
    if (m && m.type === 'refreshBanner') refreshBanner();
  });

  // ---- Environment banner (top frame only): a thin strip and a small name tab; never blocks clicks ----
  let lastBanner = null;

  const BANNER_STYLE = `
    :host { all: initial; }
    .wrap { position: fixed; top: 0; left: 0; right: 0; z-index: 2147483646; pointer-events: none;
      font: 600 11px/1.2 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; }
    .strip { height: 3px; }
    .tag { position: absolute; top: 3px; left: 50%; transform: translateX(-50%); padding: 3px 12px 4px; white-space: nowrap;
      border-radius: 0 0 8px 8px; letter-spacing: 0.3px; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25); opacity: 0.94; }
    .local, .local + .tag { background: #FEA832; color: #17120A; }
    .remote, .remote + .tag { background: #2F5274; color: #FFFFFF; }
    .unknown, .unknown + .tag { background: #5B6675; color: #FFFFFF; }`;

  function removeBanner() {
    if (lastBanner) lastBanner.host.remove();
    lastBanner = null;
    api.lastBanner = null;
  }

  function showBanner(info) {
    removeBanner();
    const host = el('div');
    const root = host.attachShadow({ mode: 'closed' });
    root.appendChild(el('style', {}, BANNER_STYLE));
    const wrap = el('div', { class: 'wrap', ariaHidden: 'true' });
    const kind = info.env === 'local' || info.env === 'remote' ? info.env : 'unknown';
    wrap.append(el('div', { class: `strip ${kind}` }), el('div', { class: 'tag' }, String(info.label).replace(/\s+[–-]\s+/g, ' · ')));
    root.appendChild(wrap);
    (document.body || document.documentElement).appendChild(host);
    lastBanner = { host, root };
    api.lastBanner = lastBanner;
  }

  async function refreshBanner() {
    if (!isTop) return;
    const reply = await send({ type: 'bannerInfo' });
    if (reply && reply.ok && reply.data) showBanner(reply.data); else removeBanner();
  }

  const onPageReady = () => { checkPending(); refreshBanner(); };

  if (isTop) {
    window.addEventListener('pageshow', (event) => {
      const nav = performance.getEntriesByType('navigation')[0];
      const backForward = event.persisted || (nav && nav.type === 'back_forward');
      send({ type: 'pageShown', backForward: !!backForward }).then(onPageReady);
    });
    if (document.readyState === 'complete') {
      const nav = performance.getEntriesByType('navigation')[0];
      send({ type: 'pageShown', backForward: !!(nav && nav.type === 'back_forward') }).then(onPageReady);
    }
  }

  const api = { capture, checkPending, showBar, removeBar, lastBar: null, refreshBanner, showBanner, removeBanner, lastBanner: null };
  DLV.content = api;
})(globalThis.DLV);
