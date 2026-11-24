// Tests for src/lib/forms.js. Markup mirrors the EHRM sign-in page (/hr/security/login).
const F = () => window.DLV.forms;

const EHRM = `
  <form id="f" action="javascript:void 0">
    <input type="hidden" name="__RequestVerificationToken" value="x">
    <input type="text" id="search" placeholder="Search" style="display:none">
    <input type="text" id="UserName" name="UserName">
    <input type="password" id="Password" name="Password">
    <button type="button" id="help">Help</button>
    <button type="submit" id="login">Login</button>
  </form>`;

test('finds fields on single-step page', (s) => {
  html(s, EHRM);
  const pw = F().findPasswordField(s);
  eq(pw.id, 'Password');
  eq(F().findUsernameField(pw, s).id, 'UserName');
});

test('ignores hidden decoy username', (s) => {
  html(s, `<form><input type="text" id="real"><input type="email" id="decoy" style="visibility:hidden">
    <input type="password" id="pw"></form>`);
  eq(F().findUsernameField(F().findPasswordField(s), s).id, 'real');
});

test('ignores hidden password field', (s) => {
  html(s, `<form><input type="password" id="hiddenpw" hidden><input type="text" id="u"><input type="password" id="pw"></form>`);
  eq(F().findPasswordField(s).id, 'pw');
});

test('prefers autocomplete=username', (s) => {
  html(s, `<form><input type="text" id="login" autocomplete="username"><input type="text" id="company">
    <input type="password" id="pw"></form>`);
  eq(F().findUsernameField(F().findPasswordField(s), s).id, 'login');
});

test('step-1 page returns username field with no password', (s) => {
  html(s, `<form><input type="email" id="email"><button>Next</button></form>`);
  eq(F().findPasswordField(s), null);
  eq(F().findUsernameField(null, s).id, 'email');
});

test('readCredentials returns trimmed username and exact password', (s) => {
  html(s, EHRM);
  s.querySelector('#UserName').value = ' 00001774 ';
  s.querySelector('#Password').value = ' p@ss wörd ';
  eq(F().readCredentials(s), { username: '00001774', password: ' p@ss wörd ' });
});

test('readCredentials null for empty password', (s) => {
  html(s, EHRM);
  s.querySelector('#UserName').value = 'ava';
  eq(F().readCredentials(s), null);
});

test('setValue fires input and change', (s) => {
  html(s, `<input type="text" id="u">`);
  const input = s.querySelector('#u');
  const seen = [];
  input.addEventListener('input', () => seen.push('input'));
  s.addEventListener('change', () => seen.push('change'));
  F().setValue(input, 'ava');
  eq(input.value, 'ava');
  eq(seen, ['input', 'change']);
});

test('setValue works when a framework overrides the value property', (s) => {
  html(s, `<input type="text" id="u">`);
  const input = s.querySelector('#u');
  let tracked = '';
  Object.defineProperty(input, 'value', { configurable: true, get() { return tracked; }, set(v) { tracked = 'via-own-setter'; } });
  F().setValue(input, 'ava');
  delete input.value;
  eq(input.value, 'ava');
});

test('findSubmit finds the submit button', (s) => {
  html(s, EHRM);
  eq(F().findSubmit(F().findPasswordField(s)).id, 'login');
});

test('findSubmit finds button by text without a form', (s) => {
  html(s, `<div><input type="text"><input type="password" id="pw"><a href="#">Forgot</a>
    <div role="button" id="go">Sign in</div></div>`);
  eq(F().findSubmit(s.querySelector('#pw')).id, 'go');
});

test('step-1 guess ignores a plain search box', (s) => {
  html(s, `<input type="text" id="q" name="q" placeholder="Search"><a href="#" id="next">Next</a>`);
  eq(F().findUsernameField(null, s), null);
});

test('step-1 guess accepts a field named like a username', (s) => {
  html(s, `<form><input type="text" id="search" name="q"><input type="text" id="login" name="UserName"><button>Next</button></form>`);
  eq(F().findUsernameField(null, s.querySelector('form')).id, 'login');
});
