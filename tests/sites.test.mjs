import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLib } from './helpers/loadLib.mjs';

const DLV = await loadLib('sites');

test('EHRM pages sign out at <app>/security/logoff', () => {
  const S = DLV.sites;
  assert.equal(S.signOutUrl('https://hrmmainphdev01.phrsandbox.dev/hr/security/login?ReturnUrl=%2fhr%2fhome%2findex'),
    'https://hrmmainphdev01.phrsandbox.dev/hr/security/logoff');
  assert.equal(S.signOutUrl('https://hrmmainphdev01.phrsandbox.dev/hr/home/index'), 'https://hrmmainphdev01.phrsandbox.dev/hr/security/logoff');
  assert.equal(S.signOutUrl('https://hrmmainphdev01.phrsandbox.dev/hr/mtnav10/Scheduling'), 'https://hrmmainphdev01.phrsandbox.dev/hr/security/logoff');
  assert.equal(S.signOutUrl('https://qa.example.test/ehrm/security/login'), 'https://qa.example.test/ehrm/security/logoff');
  assert.equal(S.signOutUrl('http://localhost:8080/HR/Home'), 'http://localhost:8080/HR/security/logoff');
});

test('other sites have no known sign-out', () => {
  const S = DLV.sites;
  assert.equal(S.signOutUrl('https://login.microsoftonline.com/common/oauth2'), null);
  assert.equal(S.signOutUrl('https://example.test/'), null);
  assert.equal(S.signOutUrl('chrome://extensions'), null);
  assert.equal(S.signOutUrl('not a url'), null);
});
