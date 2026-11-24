import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHosts, setHostLocal, HostNotFoundError } from '../native/hosts-file.mjs';

const SAMPLE = [
  '# Copyright (c) 1993-2009 Microsoft Corp.',
  '#',
  '#\t127.0.0.1       localhost',
  '#\t::1             localhost',
  '#127.0.0.1       echoengineers.phrsandbox.dev',
  '127.0.0.1       hrmmainphdev01.phrsandbox.dev',
  '# 127.0.0.1  hrmv102phqaupgrade.phrsandbox.dev   # QA upgrade box',
  '10.0.0.5        fileserver.corp',
  '127.0.0.1 a.test b.test',
  '',
].join('\r\n');

test('lists loopback lines, on and off, but not localhost or other addresses', () => {
  assert.deepEqual(parseHosts(SAMPLE).map((e) => [e.hosts.join(' '), e.active]), [
    ['echoengineers.phrsandbox.dev', false],
    ['hrmmainphdev01.phrsandbox.dev', true],
    ['hrmv102phqaupgrade.phrsandbox.dev', false],
    ['a.test b.test', true],
  ]);
});

test('switching a site to Server comments its line and keeps everything else byte for byte', () => {
  const r = setHostLocal(SAMPLE, 'hrmmainphdev01.phrsandbox.dev', false);
  assert.equal(r.changed, true);
  const lines = r.text.split('\r\n');
  assert.equal(lines[5], '#127.0.0.1       hrmmainphdev01.phrsandbox.dev');
  const others = SAMPLE.split('\r\n');
  others.splice(5, 1);
  lines.splice(5, 1);
  assert.deepEqual(lines, others);
});

test('switching a site to Local uncomments its line, with or without a space after #', () => {
  assert.equal(setHostLocal(SAMPLE, 'echoengineers.phrsandbox.dev', true).text.split('\r\n')[4], '127.0.0.1       echoengineers.phrsandbox.dev');
  assert.equal(setHostLocal(SAMPLE, 'hrmv102phqaupgrade.phrsandbox.dev', true).text.split('\r\n')[6],
    '127.0.0.1  hrmv102phqaupgrade.phrsandbox.dev   # QA upgrade box');
});

test('asking for the state it is already in changes nothing', () => {
  const r = setHostLocal(SAMPLE, 'hrmmainphdev01.phrsandbox.dev', true);
  assert.equal(r.changed, false);
  assert.equal(r.text, SAMPLE);
});

test('host names match exactly, ignoring case', () => {
  assert.throws(() => setHostLocal(SAMPLE, 'phdev01.phrsandbox.dev', false), HostNotFoundError);
  assert.throws(() => setHostLocal(SAMPLE, 'localhost', false), HostNotFoundError);
  assert.equal(setHostLocal(SAMPLE, 'HRMMAINPHDEV01.phrsandbox.dev', false).changed, true);
});

test('a line with several names reports the other names it also switches', () => {
  assert.deepEqual(setHostLocal(SAMPLE, 'a.test', false).affected, ['a.test', 'b.test']);
});

test('LF-only files keep LF line endings', () => {
  const lf = '127.0.0.1 x.test\n#127.0.0.1 y.test\n';
  assert.equal(setHostLocal(lf, 'x.test', false).text, '#127.0.0.1 x.test\n#127.0.0.1 y.test\n');
});
