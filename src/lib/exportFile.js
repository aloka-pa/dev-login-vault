// Encrypted export file used to move logins between Edge and Chrome.
(function (DLV) {
  const FORMAT = 'dev-login-vault';
  const VERSION = 1;
  const KDF_NAME = 'PBKDF2-SHA-256';
  const MAX_ITERATIONS = 10_000_000; // a hand-made file must not freeze the page

  class InvalidFileError extends Error {
    constructor(reason) { super(`This is not a Login Vault export file (${reason})`); this.name = 'InvalidFileError'; }
  }

  const isBase64 = (s) => s.length > 0 && s.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s);

  async function build(vault, password, iterations = DLV.crypto.ITERATIONS) {
    const salt = DLV.crypto.randomSaltB64();
    const key = await DLV.crypto.deriveKey(password, salt, iterations);
    const box = await DLV.crypto.encryptJson(key, vault);
    return JSON.stringify({ format: FORMAT, version: VERSION, kdf: { name: KDF_NAME, iterations, salt }, iv: box.iv, ciphertext: box.ciphertext }, null, 2);
  }

  async function parse(text, password) {
    let file;
    try { file = JSON.parse(text); } catch { throw new InvalidFileError('not JSON'); }
    if (!file || typeof file !== 'object') throw new InvalidFileError('not an object');
    if (file.format !== FORMAT) throw new InvalidFileError('wrong format');
    if (file.version !== VERSION) throw new InvalidFileError(`unsupported version ${file.version}`);
    const kdf = file.kdf || {};
    if (kdf.name !== KDF_NAME || !Number.isInteger(kdf.iterations) || kdf.iterations < 1 || kdf.iterations > MAX_ITERATIONS
      || typeof kdf.salt !== 'string'
      || typeof file.iv !== 'string' || typeof file.ciphertext !== 'string') {
      throw new InvalidFileError('missing fields');
    }
    if (!isBase64(kdf.salt) || !isBase64(file.iv) || !isBase64(file.ciphertext)) throw new InvalidFileError('damaged data');
    const key = await DLV.crypto.deriveKey(password, kdf.salt, kdf.iterations);
    const vault = await DLV.crypto.decryptJson(key, { iv: file.iv, ciphertext: file.ciphertext });
    if (!vault || vault.version !== 1 || !Array.isArray(vault.entries) || !Array.isArray(vault.neverSave)) {
      throw new InvalidFileError('no vault inside');
    }
    return vault;
  }

  function fileName(date) {
    const p = (n) => String(n).padStart(2, '0');
    return `login-vault-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.dlv.json`;
  }

  DLV.exportFile = { build, parse, fileName, InvalidFileError };
})(globalThis.DLV);
