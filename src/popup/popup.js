// Popup: unlock, list the current site's logins for the detected environment, fill on click, add/edit/delete.
(function (DLV) {
  const $ = (id) => document.getElementById(id);
  const ENVS = ['local', 'remote'];
  const I = DLV.icons;
  const state = { tab: null, origin: null, env: 'unknown', list: null, editingId: null };

  async function send(message) {
    try { return (await chrome.runtime.sendMessage(message)) || { ok: false, error: 'NO_REPLY' }; }
    catch { return { ok: false, error: 'NO_REPLY' }; }
  }

  function show(viewId) {
    for (const id of ['setupView', 'recoveryKeyView', 'lockedView', 'recoverView', 'noSiteView', 'listView']) $(id).hidden = id !== viewId;
    $('lockBtn').hidden = ['setupView', 'lockedView', 'recoverView'].includes(viewId);
  }

  function say(id, text, kind) {
    const node = $(id);
    node.textContent = text || '';
    node.className = `dlv-msg ${kind || ''}`;
    node.hidden = !text;
  }

  function el(tag, props = {}, text) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k === 'icon') node.innerHTML = v; // static icon markup from icons.js only
      else if (k.startsWith('aria') || k.startsWith('data-')) node.setAttribute(k.replace(/^aria/, 'aria-').toLowerCase(), v);
      else node[k] = v;
    }
    if (text !== undefined) node.append(document.createTextNode(text));
    return node;
  }

  // Static icons
  $('optionsBtn').innerHTML = I.settings;
  $('lockBtn').innerHTML = I.lock;
  $('lockArt').innerHTML = I.lock;
  $('searchIcon').innerHTML = I.search;
  $('otherChev').innerHTML = I.chevron;
  $('addBtn').innerHTML = I.plus;
  $('addBtn').append(document.createTextNode('Add a login'));
  $('switchUserBtn').innerHTML = I.switchUser;
  $('switchUserBtn').append(document.createTextNode('Switch user'));

  // ---- Start ----
  async function start() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tab = tab || null;
    try {
      const url = new URL(tab && tab.url);
      state.origin = url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
    } catch { state.origin = null; }

    const status = await send({ type: 'status' });
    if (!status.ok) { show('noSiteView'); $('noSiteText').textContent = 'Login Vault is not responding. Reload the extension.'; return; }
    if (!status.data.initialized) { show('setupView'); $('setupPw').focus(); return; }
    if (!status.data.unlocked) { show('lockedView'); $('unlockPw').focus(); return; }
    await showList();
  }

  // ---- Setup / unlock / lock ----
  $('setupForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const pw = $('setupPw').value;
    if (pw.length < 8) return say('setupMsg', 'Use at least 8 characters.', 'err');
    if (pw !== $('setupPw2').value) return say('setupMsg', 'The two passwords are different.', 'err');
    const reply = await send({ type: 'setup', password: pw });
    if (!reply.ok) return say('setupMsg', 'Could not create the vault.', 'err');
    $('setupPw').value = $('setupPw2').value = '';
    showRecoveryKey(reply.data.recoveryKey);
  });

  // ---- Recovery key ----
  // Line breaks only at the dashes; Copy/Download use the exact key from data-key.
  const displayKey = (key) => key.replace(/-/g, '-​');

  function showRecoveryKey(key) {
    $('recoveryKeyText').dataset.key = key;
    $('recoveryKeyText').textContent = displayKey(key);
    $('recoverySaved').checked = false;
    $('recoveryContinue').disabled = true;
    say('recoveryKeyMsg', '');
    show('recoveryKeyView');
  }

  $('recoverySaved').addEventListener('change', () => { $('recoveryContinue').disabled = !$('recoverySaved').checked; });
  $('recoveryContinue').addEventListener('click', () => {
    $('recoveryKeyText').textContent = '';
    delete $('recoveryKeyText').dataset.key;
    showList();
  });

  $('recoveryCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('recoveryKeyText').dataset.key);
      say('recoveryKeyMsg', 'Copied. Paste it somewhere safe, then clear your clipboard.', 'ok');
    } catch { say('recoveryKeyMsg', 'Could not copy. Select the key and copy it, or use Download.', 'err'); }
  });

  $('recoveryDownload').addEventListener('click', () => {
    const text = `Login Vault recovery key\r\n\r\n${$('recoveryKeyText').dataset.key}\r\n\r\n`
      + `Created ${new Date().toLocaleString()}.\r\nUse it on the unlock screen: "Forgot master password?".\r\n`
      + 'Anyone with this key can open your vault. Keep it offline and safe.\r\n';
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = el('a', { href: url, download: 'login-vault-recovery-key.txt' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    say('recoveryKeyMsg', 'Downloaded. Move the file somewhere safe and offline.', 'ok');
  });

  $('recoveryCreate').addEventListener('click', async () => {
    const reply = await send({ type: 'createRecoveryKey' });
    if (reply.ok) showRecoveryKey(reply.data);
    else if (reply.error === 'LOCKED') show('lockedView');
  });

  $('forgotBtn').addEventListener('click', () => { say('recoverMsg', ''); show('recoverView'); $('recoverKey').focus(); });
  $('recoverBack').addEventListener('click', () => { show('lockedView'); $('unlockPw').focus(); });

  $('recoverForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const pw = $('recoverPw').value;
    if (pw.length < 8) return say('recoverMsg', 'Use at least 8 characters for the new master password.', 'err');
    if (pw !== $('recoverPw2').value) return say('recoverMsg', 'The two passwords are different.', 'err');
    $('recoverBtn').disabled = true;
    $('recoverBtn').textContent = 'Checking…';
    const reply = await send({ type: 'recoverWithKey', recoveryKey: $('recoverKey').value, newPassword: pw });
    $('recoverBtn').disabled = false;
    $('recoverBtn').textContent = 'Recover and unlock';
    if (reply.ok && reply.data === true) {
      $('recoverForm').reset();
      say('listMsg', 'Recovered. Your new master password is set.', 'ok');
      await showList();
      return;
    }
    say('recoverMsg', 'That recovery key does not match this vault. Check it and try again.', 'err');
  });

  $('unlockForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('unlockBtn').disabled = true;
    $('unlockBtn').textContent = 'Unlocking…';
    say('unlockMsg', '');
    const reply = await send({ type: 'unlock', password: $('unlockPw').value });
    $('unlockBtn').disabled = false;
    $('unlockBtn').textContent = 'Unlock';
    if (reply.ok && reply.data === true) { $('unlockPw').value = ''; await showList(); return; }
    say('unlockMsg', 'Wrong password.', 'err');
    $('unlockPw').select();
  });

  $('lockBtn').addEventListener('click', async () => { await send({ type: 'lock' }); show('lockedView'); $('unlockPw').focus(); });
  $('optionsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());

  // ---- List ----
  async function showList() {
    if (!state.origin) { show('noSiteView'); return; }
    show('listView');
    const recovery = await send({ type: 'recoveryStatus' });
    $('recoveryNudge').hidden = !(recovery.ok && !recovery.data.hasRecoveryKey);
    const envReply = await send({ type: 'tabEnv', tabId: state.tab.id, origin: state.origin });
    state.env = envReply.ok ? envReply.data : 'unknown';
    const reply = await send({ type: 'listForSite', origin: state.origin, env: state.env });
    if (!reply.ok) { if (reply.error === 'LOCKED') { show('lockedView'); return; } say('listMsg', 'Could not read the vault.', 'err'); return; }
    state.list = reply.data;
    render();
  }

  const labelOf = (env) => state.list.labels[env] || env;

  function render() {
    const { current, other, envMatters } = state.list;
    const known = ENVS.includes(state.env);
    $('siteHost').textContent = new URL(state.origin).host;
    $('siteHost').title = state.origin;
    // The Local/Server chip only shows on sites where hosting matters (served from this computer, or with Local/Server logins).
    const badge = $('envBadge');
    badge.hidden = !envMatters;
    badge.className = `dlv-badge ${known ? state.env : 'unknown'}`;
    badge.textContent = known ? labelOf(state.env) : 'Unknown';
    $('envHint').hidden = known || !envMatters;
    $('switchUserBtn').hidden = !DLV.sites.signOutUrl(state.tab.url);

    const q = $('search').value.trim().toLowerCase();
    const match = (e) => !q || e.username.toLowerCase().includes(q) || (e.note || '').toLowerCase().includes(q);

    const cur = current.filter(match);
    $('currentList').replaceChildren(...cur.map((e) => row(e, false)));
    $('currentList').hidden = cur.length === 0;
    $('emptyHint').hidden = cur.length > 0 || !!q || (!known && envMatters);

    const oth = other.filter(match);
    $('otherBlock').hidden = oth.length === 0;
    $('otherTitle').textContent = known
      ? `${labelOf(state.env === 'local' ? 'remote' : 'local')} logins (${oth.length})`
      : `Local and Server logins (${oth.length})`;
    if (!known || q) $('otherBlock').open = true;
    $('otherList').replaceChildren(...oth.map((e) => row(e, true)));
  }

  function row(entry, showEnv) {
    const li = el('li', { class: 'login' });
    const fill = el('button', { type: 'button', class: 'fill', title: `Fill ${entry.username}` });
    fill.append(el('span', { class: `avatar ${entry.env}` }, (entry.username || '?').slice(0, 1)));
    const who = el('span', { class: 'who' });
    who.append(el('span', { class: 'user' }, entry.username || '(no username)'));
    const noteText = [showEnv && entry.env !== 'na' ? labelOf(entry.env) : '', entry.note].filter(Boolean).join(' · ');
    if (noteText) who.append(el('span', { class: 'note' }, noteText));
    const secret = el('span', { class: 'secret', hidden: true });
    who.append(secret);
    fill.append(who);
    fill.addEventListener('click', () => doFill(entry));

    const actions = el('span', { class: 'actions' });
    const showBtn = el('button', { type: 'button', class: 'act', title: 'Show password', ariaLabel: `Show password for ${entry.username}`, icon: I.eye });
    showBtn.addEventListener('click', async () => {
      if (!secret.hidden) { secret.hidden = true; secret.textContent = ''; showBtn.innerHTML = I.eye; showBtn.title = 'Show password'; return; }
      const r = await send({ type: 'getPassword', id: entry.id });
      if (r.ok) { secret.textContent = r.data; secret.hidden = false; showBtn.innerHTML = I.eyeOff; showBtn.title = 'Hide password'; }
    });

    const copyBtn = el('button', { type: 'button', class: 'act', title: 'Copy password', ariaLabel: `Copy password for ${entry.username}`, icon: I.copy });
    copyBtn.addEventListener('click', async () => {
      const r = await send({ type: 'getPassword', id: entry.id });
      if (!r.ok) return say('listMsg', 'Could not read the password.', 'err');
      try {
        await navigator.clipboard.writeText(r.data);
        say('listMsg', `Copied. It stays on the clipboard until you copy something else.`, 'ok');
      } catch {
        say('listMsg', 'Could not copy. Use the eye button to show the password instead.', 'err');
      }
    });

    const editBtn = el('button', { type: 'button', class: 'act', title: 'Edit', ariaLabel: `Edit ${entry.username}`, icon: I.edit });
    editBtn.addEventListener('click', () => openForm(entry));

    const delBtn = el('button', { type: 'button', class: 'act danger', title: 'Delete', ariaLabel: `Delete ${entry.username}`, icon: I.trash });
    delBtn.addEventListener('click', () => {
      const confirm = el('span', { class: 'confirm' }, 'Delete?');
      const yes = el('button', { type: 'button', class: 'dlv-btn small danger' }, 'Yes');
      const no = el('button', { type: 'button', class: 'dlv-btn small ghost' }, 'No');
      yes.addEventListener('click', async () => { await send({ type: 'deleteEntry', id: entry.id }); say('listMsg', `Deleted "${entry.username}".`, 'ok'); await showList(); });
      no.addEventListener('click', () => confirm.replaceWith(actions));
      confirm.append(yes, no);
      actions.replaceWith(confirm);
      no.focus();
    });

    actions.append(showBtn, copyBtn, editBtn, delBtn);
    li.append(fill, actions);
    return li;
  }

  async function doFill(entry) {
    const reply = await send({ type: 'fill', tabId: state.tab.id, id: entry.id });
    if (reply.ok && reply.data) { window.close(); return; }
    if (reply.ok) say('listMsg', 'No login fields found on this page.', 'err');
    else if (reply.error === 'LOCKED') show('lockedView');
    else if (reply.error === 'ORIGIN_MISMATCH') say('listMsg', 'This login belongs to another site.', 'err');
    else say('listMsg', 'Could not fill this page. Reload it and try again.', 'err');
  }

  $('search').addEventListener('input', () => state.list && render());

  // Quick switch user: sign out of EHRM in this tab; EHRM returns to its sign-in page, then pick the next login here.
  $('switchUserBtn').addEventListener('click', async () => {
    const url = DLV.sites.signOutUrl(state.tab.url);
    if (!url) return;
    await chrome.tabs.update(state.tab.id, { url });
    window.close();
  });

  // ---- Add / edit ----
  function openForm(entry) {
    state.editingId = entry ? entry.id : null;
    $('entryTitle').textContent = entry ? `Edit ${entry.username}` : 'Add a login';
    $('entryUser').value = entry ? entry.username : '';
    $('entryPw').value = '';
    $('entryPw').required = !entry;
    $('entryPw').placeholder = entry ? 'Leave empty to keep the current password' : '';
    $('entryNote').value = entry ? entry.note || '' : '';
    $('entryEnv').replaceChildren(...[...ENVS, 'na'].map((env) =>
      el('option', { value: env }, env === 'na' ? `${labelOf('na')} (not environment-specific)` : labelOf(env))));
    $('entryEnv').value = entry ? entry.env : !state.list.envMatters ? 'na' : ENVS.includes(state.env) ? state.env : 'local';
    say('entryMsg', '');
    $('entryForm').hidden = false;
    $('addBtn').hidden = true;
    $('entryUser').focus();
  }

  function closeForm() {
    $('entryForm').hidden = true;
    $('addBtn').hidden = false;
    $('entryPw').value = '';
    state.editingId = null;
  }

  $('addBtn').addEventListener('click', () => openForm(null));
  $('entryCancel').addEventListener('click', closeForm);

  $('entryForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = $('entryUser').value.trim();
    if (!username) return say('entryMsg', 'Enter a username.', 'err');
    const password = $('entryPw').value;
    const note = $('entryNote').value.trim();
    const env = $('entryEnv').value;
    const reply = state.editingId
      ? await send({ type: 'updateEntry', id: state.editingId, changes: { username, note, env, ...(password ? { password } : {}) } })
      : await send({ type: 'addEntry', entry: { origin: state.origin, env, username, password, note } });
    if (!reply.ok) return say('entryMsg', reply.error === 'LOCKED' ? 'The vault locked. Unlock it again.' : 'Could not save.', 'err');
    closeForm();
    say('listMsg', `Saved "${username}".`, 'ok');
    await showList();
  });

  start();
})(globalThis.DLV);
