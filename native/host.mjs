// Native messaging host for Dev Login Vault: lists and switches 127.0.0.1 lines in the Windows hosts file.
// Started by Edge/Chrome (see install-hosts-helper.ps1). Writing the hosts file always goes through a Windows
// "Allow changes?" prompt (apply-hosts.ps1 run elevated); nothing here runs with admin rights.
import { readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { encodeMessage, createDecoder } from './protocol.mjs';
import { handle } from './commands.mjs';

const HOSTS_FILE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
const APPLY_SCRIPT = fileURLToPath(new URL('./apply-hosts.ps1', import.meta.url));
const sha256 = (text) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex').toUpperCase();
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Runs PowerShell from a script string (UTF-16 base64, so no quoting through cmd). Resolves { code, stderr }. */
function runPowerShell(script) {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', () => resolve({ code: -1, stderr }));
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

async function writeHostsElevated(nextText, beforeText) {
  const source = path.join(tmpdir(), `dev-login-vault-hosts-${randomUUID()}.txt`);
  await writeFile(source, nextText, 'utf8');
  try {
    const args = `-NoProfile -ExecutionPolicy Bypass -File "${APPLY_SCRIPT}" -Source "${source}" -Sha256 ${sha256(nextText)} -BeforeSha256 ${sha256(beforeText)}`;
    const script = `try { $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList ${psQuote(args)}; exit $p.ExitCode }`
      + ' catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1223 }';
    const { code } = await runPowerShell(script);
    if (code === 0) return 'ok';
    if (code === 1223) return 'cancelled'; // Windows prompt declined (ERROR_CANCELLED)
    if (code === 3) return 'changed-meanwhile';
    return 'failed';
  } finally {
    await rm(source, { force: true });
  }
}

export const defaultDeps = {
  readHosts: () => readFile(process.env.DLV_HOSTS_FILE_FOR_TESTS || HOSTS_FILE, 'utf8'),
  writeHostsElevated,
};

/** Reads messages from input, answers on output, one at a time. */
export function serve(input, output, deps = defaultDeps) {
  let chain = Promise.resolve();
  const decoder = createDecoder((message) => {
    chain = chain.then(async () => {
      let reply;
      try { reply = await handle(message, deps); } catch { reply = { ok: false, error: 'HELPER_ERROR' }; }
      output.write(encodeMessage(reply));
    });
  });
  input.on('data', (chunk) => {
    try { decoder.push(chunk); } catch { output.write(encodeMessage({ ok: false, error: 'BAD_MESSAGE' })); input.destroy(); }
  });
  input.on('end', () => chain.then(() => process.exit(0)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) serve(process.stdin, process.stdout);
