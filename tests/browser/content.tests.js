// Tests for src/content/content.js (loaded after chrome-stub.js in run.html).
const C = () => window.DLV.content;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bar = () => C().lastBar && C().lastBar.host.isConnected ? C().lastBar.root : null;
const pending = (o = {}) => ({ ok: true, data: { origin: location.origin, env: 'local', username: 'ava', kind: 'save',
  labels: { local: 'Local IIS', remote: 'Server' }, ...o } });

window.afterEachTest = () => { window.sent = []; window.stubReplies = {}; C().removeBar(); };

const LOGIN = `<form id="f" action="javascript:void 0"><input type="text" id="u"><input type="password" id="p">
  <button type="submit" id="go">Login</button></form>`;

test('submit sends pendingCapture with credentials', async (s) => {
  html(s, LOGIN);
  s.querySelector('#u').value = 'ava';
  s.querySelector('#p').value = 'pw 1';
  s.querySelector('#f').addEventListener('submit', (e) => e.preventDefault());
  s.querySelector('#go').click();
  await wait(0);
  const caps = sent.filter((m) => m.type === 'pendingCapture');
  ok(caps.length >= 1, 'no capture sent');
  eq({ username: caps[0].username, password: caps[0].password }, { username: 'ava', password: 'pw 1' });
});

test('Enter in the password field captures', async (s) => {
  html(s, `<div><input type="text" id="u"><input type="password" id="p"></div>`);
  s.querySelector('#u').value = 'ava';
  const p = s.querySelector('#p');
  p.value = 'x';
  p.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await wait(0);
  ok(sent.some((m) => m.type === 'pendingCapture' && m.username === 'ava'), 'no capture on Enter');
});

test('two-step login pairs remembered username', async (s) => {
  html(s, `<form id="f1" action="javascript:void 0"><input type="email" id="e"><button type="submit" id="next">Next</button></form>`);
  s.querySelector('#f1').addEventListener('submit', (e) => e.preventDefault());
  s.querySelector('#e').value = 'ava@qa.test';
  s.querySelector('#next').click();
  await wait(0);
  ok(sent.some((m) => m.type === 'pendingStep1' && m.username === 'ava@qa.test'), 'step 1 not sent');
  html(s, `<form id="f2" action="javascript:void 0"><input type="password" id="p"><button type="submit" id="go">Sign in</button></form>`);
  s.querySelector('#f2').addEventListener('submit', (e) => e.preventDefault());
  s.querySelector('#p').value = 'pw';
  s.querySelector('#go').click();
  await wait(0);
  ok(sent.some((m) => m.type === 'pendingCapture' && m.username === '' && m.password === 'pw'), 'step 2 capture missing');
});

test('empty password is not captured', async (s) => {
  html(s, LOGIN);
  s.querySelector('#f').addEventListener('submit', (e) => e.preventDefault());
  s.querySelector('#u').value = 'ava';
  s.querySelector('#go').click();
  await wait(0);
  ok(!sent.some((m) => m.type === 'pendingCapture'), 'captured an empty password');
});

test('bar shows save text with environment label', async () => {
  stubReplies.pendingForTab = pending();
  await C().checkPending();
  ok(bar(), 'no bar');
  eq(bar().querySelector('.msg').textContent, `Save login "ava" for ${location.host} (Local IIS)?`);
});

test('bar shows update text for kind update', async () => {
  stubReplies.pendingForTab = pending({ kind: 'update', env: 'remote' });
  await C().checkPending();
  eq(bar().querySelector('.msg').textContent, `Update password for "ava" on ${location.host} (Server)?`);
});

test('bar for a locked vault asks to unlock and has no Save', async () => {
  stubReplies.pendingForTab = pending({ kind: 'locked' });
  await C().checkPending();
  ok(bar().querySelector('.msg').textContent.startsWith('Unlock Dev Login Vault to save "ava"'), 'locked text');
  eq(bar().querySelector('[data-action="save"]'), null);
});

test('Save disabled until env chosen when env unknown', async () => {
  stubReplies.pendingForTab = pending({ env: 'unknown' });
  await C().checkPending();
  const save = bar().querySelector('[data-action="save"]');
  const select = bar().querySelector('select');
  ok(save.disabled, 'save should be disabled');
  select.value = 'remote';
  select.dispatchEvent(new Event('change'));
  ok(!save.disabled, 'save should be enabled');
  stubReplies.savePending = { ok: true, data: 'added' };
  save.click();
  await wait(0);
  eq(sent.find((m) => m.type === 'savePending'), { type: 'savePending', env: 'remote' });
});

test('Save then shows Saved and closes', async () => {
  stubReplies.pendingForTab = pending();
  stubReplies.savePending = { ok: true, data: 'added' };
  await C().checkPending();
  bar().querySelector('[data-action="save"]').click();
  await wait(0);
  ok(bar().querySelector('.msg').textContent.startsWith('Saved'), 'no Saved message');
});

test('Never and Not now send their messages', async () => {
  stubReplies.pendingForTab = pending();
  await C().checkPending();
  bar().querySelector('[data-action="never"]').click();
  await wait(0);
  ok(sent.some((m) => m.type === 'neverForPending'), 'never not sent');
  ok(!bar(), 'bar should close');
  await C().checkPending();
  bar().querySelector('[data-action="dismiss"]').click();
  await wait(0);
  ok(sent.some((m) => m.type === 'dismissPending'), 'dismiss not sent');
});

test('username with markup is shown as text', async () => {
  stubReplies.pendingForTab = pending({ username: '<img src=x onerror="window.pwned=1">' });
  await C().checkPending();
  eq(bar().querySelector('img'), null);
  ok(bar().querySelector('.msg').textContent.includes('<img'), 'markup should be visible text');
  ok(!window.pwned, 'markup ran');
});

test('no bar inside iframes', async (s) => {
  const frame = document.createElement('iframe');
  frame.src = 'content-frame.html';
  s.appendChild(frame);
  await new Promise((r) => frame.addEventListener('load', r));
  const w = frame.contentWindow;
  w.stubReplies.pendingForTab = pending();
  await w.DLV.content.checkPending();
  eq(w.DLV.content.lastBar, null);
  eq(w.sent.filter((m) => m.type === 'pendingForTab').length, 0);
});

test('capture inside an iframe nudges the top frame', async (s) => {
  const frame = document.createElement('iframe');
  frame.src = 'content-frame.html';
  s.appendChild(frame);
  await new Promise((r) => frame.addEventListener('load', r));
  const d = frame.contentDocument;
  d.querySelector('form').addEventListener('submit', (e) => e.preventDefault());
  d.querySelector('#u').value = 'ava';
  d.querySelector('#p').value = 'pw';
  d.querySelector('button').click();
  await wait(10);
  ok(frame.contentWindow.sent.some((m) => m.type === 'pendingNudge'), 'no nudge from frame');
});

test('Next on a page with only a search box sends no step-1 username', async (s) => {
  html(s, `<input type="text" id="q" placeholder="Search"><a href="javascript:void 0" id="next">Next</a>`);
  s.querySelector('#q').value = 'quarterly report';
  s.querySelector('#next').click();
  await wait(0);
  ok(!sent.some((m) => m.type === 'pendingStep1'), 'search text was taken as a username');
});

test("step-1 username is read from the clicked button's form", async (s) => {
  html(s, `<input type="email" id="news" placeholder="Newsletter">
    <form id="f" action="javascript:void 0"><input type="email" id="e" autocomplete="username"><button type="submit" id="next">Next</button></form>`);
  s.querySelector('#f').addEventListener('submit', (e) => e.preventDefault());
  s.querySelector('#news').value = 'news@x.test';
  s.querySelector('#e').value = 'ava@qa.test';
  s.querySelector('#next').click();
  await wait(0);
  eq([...new Set(sent.filter((m) => m.type === 'pendingStep1').map((m) => m.username))], ['ava@qa.test']);
});
