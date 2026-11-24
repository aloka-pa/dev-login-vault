// Master-password encryption with the built-in Web Crypto API: PBKDF2-SHA-256 -> AES-GCM 256.
(function (DLV) {
  const ITERATIONS = 600000;
  const SALT_BYTES = 16;
  const IV_BYTES = 12;
  const subtle = globalThis.crypto.subtle;

  class WrongPasswordError extends Error {
    constructor() { super('Wrong password or damaged data'); this.name = 'WrongPasswordError'; }
  }

  function toB64(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = '';
    for (let i = 0; i < view.length; i += 0x8000) s += String.fromCharCode(...view.subarray(i, i + 0x8000));
    return btoa(s);
  }

  function fromB64(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  const randomB64 = (n) => toB64(globalThis.crypto.getRandomValues(new Uint8Array(n)));
  const randomSaltB64 = () => randomB64(SALT_BYTES);

  async function deriveKey(password, saltB64, iterations = ITERATIONS) {
    const base = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations },
      base,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
  }

  const exportKeyB64 = async (key) => toB64(await subtle.exportKey('raw', key));
  const importKeyB64 = (b64) => subtle.importKey('raw', fromB64(b64), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);

  async function encryptJson(key, value) {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const data = new TextEncoder().encode(JSON.stringify(value));
    const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    return { iv: toB64(iv), ciphertext: toB64(ciphertext) };
  }

  async function decryptJson(key, box) {
    let plain;
    try {
      plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.ciphertext));
    } catch {
      throw new WrongPasswordError();
    }
    return JSON.parse(new TextDecoder().decode(plain));
  }

  DLV.crypto = { ITERATIONS, WrongPasswordError, randomSaltB64, deriveKey, exportKeyB64, importKeyB64, encryptJson, decryptJson };
})(globalThis.DLV);
