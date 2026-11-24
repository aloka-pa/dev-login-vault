// Finds and fills sign-in fields in a page. Classic script (content script, test pages).
(function (DLV) {
  const USERNAME_TYPES = new Set(['', 'text', 'email', 'tel']);
  const SUBMIT_TEXT = /\b(log ?in|sign ?in|submit|continue|next)\b/i;
  const USERNAME_HINT = /user|login|e-?mail|account|emp(loyee)?_?(no|num|id)/i;
  const SEARCH_HINT = /search|query|\bq\b/i;

  function isVisible(el) {
    if (!el || !el.isConnected || el.hidden || el.type === 'hidden') return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }

  const isUsernameInput = (el) =>
    el.tagName === 'INPUT' && USERNAME_TYPES.has((el.getAttribute('type') || '').toLowerCase()) && !el.disabled && isVisible(el);

  function findPasswordField(root) {
    return [...root.querySelectorAll('input[type="password"]')].find((el) => !el.disabled && isVisible(el)) || null;
  }

  function findUsernameField(passwordField, root) {
    const scope = passwordField?.form || root;
    let candidates = [...scope.querySelectorAll('input')].filter(isUsernameInput);
    if (passwordField) {
      candidates = candidates.filter((el) => el.compareDocumentPosition(passwordField) & Node.DOCUMENT_POSITION_FOLLOWING);
    }
    if (!candidates.length) return null;
    const tagged = candidates.find((el) => (el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/).includes('username'));
    if (tagged) return tagged;
    if (passwordField) return candidates[candidates.length - 1];
    // No password field (step 1 of a two-step sign-in): only accept a field that looks like a username, never a search box.
    return candidates.find((el) => (el.getAttribute('type') || '').toLowerCase() === 'email')
      || candidates.find((el) => USERNAME_HINT.test(`${el.name} ${el.id}`) && !SEARCH_HINT.test(`${el.name} ${el.id} ${el.type}`))
      || null;
  }

  function readCredentials(root) {
    const passwordField = findPasswordField(root);
    if (!passwordField || !passwordField.value) return null;
    const usernameField = findUsernameField(passwordField, root);
    return { username: (usernameField?.value || '').trim(), password: passwordField.value };
  }

  function setValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    input.focus?.();
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const buttonText = (el) => (el.tagName === 'INPUT' ? el.value : el.textContent || el.getAttribute('aria-label') || '').trim();

  function findSubmit(passwordField) {
    if (!passwordField) return null;
    const form = passwordField.form;
    if (form) {
      const explicit = [...form.querySelectorAll('button[type="submit"], input[type="submit"], button:not([type])')].find(isVisible);
      if (explicit) return explicit;
    }
    let scope = form || passwordField.parentElement;
    for (let depth = 0; scope && depth < 6; depth++, scope = scope.parentElement) {
      const match = [...scope.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"], a')]
        .find((el) => isVisible(el) && SUBMIT_TEXT.test(buttonText(el)));
      if (match) return match;
    }
    return null;
  }

  DLV.forms = { isVisible, findPasswordField, findUsernameField, readCredentials, setValue, findSubmit };
})(globalThis.DLV);
