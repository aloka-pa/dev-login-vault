// Settings page: auto-lock, master password, filling, environment names, never-save list, export, import, delete all.
(function (DLV) {
  const $ = (id) => document.getElementById(id);

  async function send(message) {
    try { return (await chrome.runtime.sendMessage(message)) || { ok: false, error: 'NO_REPLY' }; }
    catch { return { ok: false, error: 'NO_REPLY' }; }
  }

  function say(id, text, kind) {
    const el = $(id);
    el.textContent = text || '';
    el.className = `dlv-msg ${kind || ''}`;
    el.hidden = !text;
  }

  function el(tag, props = {}, text) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const lockedReply = (r) => !r.ok && r.error === 'LOCKED';

  async function start() {
    const status = await send({ type: 'status' });
    $('setupNote').hidden = !(status.ok && !status.data.initialized);
    $('unlockCard').hidden = !(status.ok && status.data.initialized && !status.data.unlocked);
    $('settings').hidden = !(status.ok && status.data.unlocked);
    $('lockBtn').hidden = $('settings').hidden;
    if (!$('settings').hidden) await load();
    else if (!$('unlockCard').hidden) $('unlockPw').focus();
  }

  async function load() {
    const [settings, overview] = await Promise.all([send({ type: 'getSettings' }), send({ type: 'getOverview' })]);
    if (lockedReply(settings) || lockedReply(overview)) { await start(); return; }
    $('lockMinutes').value = settings.data.autoLockMinutes;
    $('submitAfterFill').checked = !!settings.data.submitAfterFill;
    renderLabels(overview.data);
    renderNever(overview.data.neverSave);
  }

  function renderLabels({ sites, envLabels }) {
    const origins = [...new Set([...sites, ...Object.keys(envLabels)])].sort();
    $('labelsEmpty').hidden = origins.length > 0;
    $('labels').replaceChildren(...origins.map((origin) => {
      const form = el('form', { className: 'site-labels' });
      form.append(el('div', { className: 'site' }, new URL(origin).host + (new URL(origin).protocol === 'http:' ? ' (http)' : '')));
      const inputs = {};
      for (const env of ['local', 'remote']) {
        const id = `lbl-${env}-${btoa(origin).replace(/=/g, '')}`;
        const wrap = el('div');
        wrap.append(el('label', { htmlFor: id }, env === 'local' ? 'Local name' : 'Server name'));
        inputs[env] = el('input', { type: 'text', id, value: envLabels[origin]?.[env] || '', placeholder: DLV.env.DEFAULT_LABELS[env] });
        wrap.append(inputs[env]);
        form.append(wrap);
      }
      form.append(el('button', { type: 'submit', className: 'dlv-btn primary small' }, 'Save'));
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        for (const env of ['local', 'remote']) await send({ type: 'setLabel', origin, env, label: inputs[env].value });
        form.querySelector('button').textContent = 'Saved ✔';
        setTimeout(() => { form.querySelector('button').textContent = 'Save'; }, 1500);
      });
      return form;
    }));
  }

  function renderNever(list) {
    $('neverEmpty').hidden = list.length > 0;
    $('neverList').replaceChildren(...list.map((origin) => {
      const li = el('li');
      li.append(el('span', {}, origin));
      const btn = el('button', { type: 'button', className: 'dlv-btn small' }, 'Remove');
      btn.addEventListener('click', async () => { await send({ type: 'removeNeverSave', origin }); await load(); });
      li.append(btn);
      return li;
    }));
  }

  $('unlockForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const r = await send({ type: 'unlock', password: $('unlockPw').value });
    if (r.ok && r.data === true) { $('unlockPw').value = ''; say('unlockMsg', ''); await start(); }
    else say('unlockMsg', 'Wrong password.', 'err');
  });

  $('lockBtn').addEventListener('click', async () => { await send({ type: 'lock' }); await start(); });

  $('lockForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const minutes = Number($('lockMinutes').value);
    if (!(minutes >= 5 && minutes <= 240)) return say('lockMsg', 'Use a number from 5 to 240.', 'err');
    const r = await send({ type: 'setSettings', settings: { autoLockMinutes: minutes } });
    if (lockedReply(r)) return start();
    say('lockMsg', r.ok ? `Saved: locks after ${minutes} minutes.` : 'Could not save.', r.ok ? 'ok' : 'err');
  });

  $('pwForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if ($('newPw').value.length < 8) return say('pwMsg', 'Use at least 8 characters.', 'err');
    if ($('newPw').value !== $('newPw2').value) return say('pwMsg', 'The new passwords are different.', 'err');
    const r = await send({ type: 'changePassword', oldPassword: $('oldPw').value, newPassword: $('newPw').value });
    if (r.ok && r.data === true) { $('pwForm').reset(); say('pwMsg', 'Master password changed.', 'ok'); }
    else say('pwMsg', r.ok ? 'The current master password is wrong.' : 'Could not change the password.', 'err');
  });

  $('submitAfterFill').addEventListener('change', async () => {
    const r = await send({ type: 'setSettings', settings: { submitAfterFill: $('submitAfterFill').checked } });
    if (lockedReply(r)) return start();
    say('fillMsg', r.ok ? 'Saved.' : 'Could not save.', r.ok ? 'ok' : 'err');
  });

  $('exportForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const pw = $('exportPw').value;
    if (pw.length < 8) return say('exportMsg', 'Use at least 8 characters.', 'err');
    if (pw !== $('exportPw2').value) return say('exportMsg', 'The two passwords are different.', 'err');
    $('exportBtn').disabled = true;
    say('exportMsg', 'Encrypting…');
    try {
      const r = await send({ type: 'exportVaultPlain' });
      if (!r.ok) { if (lockedReply(r)) return start(); return say('exportMsg', 'Could not read the vault.', 'err'); }
      const text = await DLV.exportFile.build(r.data, pw);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = el('a', { href: url, download: DLV.exportFile.fileName(new Date()) });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      $('exportForm').reset();
      say('exportMsg', `Exported ${r.data.entries.length} logins. Import the file in the other browser with the same password.`, 'ok');
    } finally {
      $('exportBtn').disabled = false;
    }
  });

  $('importForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = $('importFile').files[0];
    if (!file) return say('importMsg', 'Choose an export file.', 'err');
    $('importBtn').disabled = true;
    say('importMsg', 'Decrypting…');
    try {
      let vault;
      try { vault = await DLV.exportFile.parse(await file.text(), $('importPw').value); }
      catch (err) {
        return say('importMsg', err instanceof DLV.crypto.WrongPasswordError ? 'Wrong password, or the file is damaged. Nothing was imported.'
          : 'This is not a Dev Login Vault export file. Nothing was imported.', 'err');
      }
      const r = await send({ type: 'importVault', vault });
      if (!r.ok) { if (lockedReply(r)) return start(); return say('importMsg', 'The file could not be imported. Nothing was changed.', 'err'); }
      $('importForm').reset();
      say('importMsg', `Added ${r.data.added}, updated ${r.data.updated}, unchanged ${r.data.unchanged}.`, 'ok');
      await load();
    } finally {
      $('importBtn').disabled = false;
    }
  });

  $('deleteForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if ($('deleteConfirm').value !== 'DELETE') return say('deleteMsg', 'Type DELETE in capital letters to confirm.', 'err');
    const r = await send({ type: 'deleteAll' });
    $('deleteForm').reset();
    if (r.ok) await start(); else say('deleteMsg', 'Could not delete.', 'err');
  });

  start();
})(globalThis.DLV);
