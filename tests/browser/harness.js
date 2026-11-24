// Minimal browser test harness: test(name, fn(sandbox)), eq, ok. run() prints "ALL PASS (n)" or the failures into #result.
(function () {
  const tests = [];
  window.test = (name, fn) => tests.push({ name, fn });
  window.ok = (value, msg) => { if (!value) throw new Error(msg || 'expected truthy'); };
  window.eq = (actual, expected, msg) => {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${msg ? msg + ': ' : ''}expected ${e}, got ${a}`);
  };
  window.html = (sandbox, markup) => { sandbox.innerHTML = markup; return sandbox; };

  window.runTests = async () => {
    const failures = [];
    for (const t of tests) {
      const sandbox = document.createElement('div');
      sandbox.id = 'sandbox';
      document.body.appendChild(sandbox);
      try { await t.fn(sandbox); } catch (err) { failures.push(`${t.name}: ${err.message}`); }
      if (window.afterEachTest) await window.afterEachTest();
      sandbox.remove();
    }
    const out = document.getElementById('result');
    out.textContent = failures.length ? `FAILED ${failures.length}/${tests.length}\n` + failures.join('\n') : `ALL PASS (${tests.length})`;
    out.style.color = failures.length ? '#C62828' : '#1b5e20';
    return out.textContent;
  };
})();
