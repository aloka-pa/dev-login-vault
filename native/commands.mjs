// Commands of the hosts helper. deps: { readHosts(): Promise<string>,
//   writeHostsElevated(nextText, beforeText): Promise<'ok' | 'cancelled' | 'changed-meanwhile' | 'failed'> }
import { parseHosts, setHostLocal, HostNotFoundError } from './hosts-file.mjs';

export const VERSION = 1;
const HOST_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
const WRITE_ERRORS = { cancelled: 'CANCELLED', 'changed-meanwhile': 'HOSTS_CHANGED', failed: 'WRITE_FAILED' };

export async function handle(message, deps) {
  const type = message && typeof message === 'object' ? message.type : null;
  if (type === 'ping') return { ok: true, version: VERSION };
  if (type === 'list') return { ok: true, entries: parseHosts(await deps.readHosts()) };
  if (type !== 'set') return { ok: false, error: 'UNKNOWN_COMMAND' };

  const { host, local } = message;
  if (typeof host !== 'string' || host.length > 253 || !HOST_NAME.test(host) || typeof local !== 'boolean') {
    return { ok: false, error: 'BAD_REQUEST' };
  }
  const before = await deps.readHosts();
  let result;
  try { result = setHostLocal(before, host, local); } catch (err) {
    if (err instanceof HostNotFoundError) return { ok: false, error: 'HOST_NOT_FOUND' };
    throw err;
  }
  if (!result.changed) return { ok: true, changed: false, affected: result.affected, entries: parseHosts(before) };

  const outcome = await deps.writeHostsElevated(result.text, before);
  if (outcome !== 'ok') return { ok: false, error: WRITE_ERRORS[outcome] || 'WRITE_FAILED' };
  return { ok: true, changed: true, affected: result.affected, entries: parseHosts(await deps.readHosts()) };
}
