// Reads and switches loopback lines in a Windows hosts file. Pure functions: text in, text out.
// Only existing lines that map a name to 127.x.x.x or ::1 are listed or switched; "localhost" is never touched.

export class HostNotFoundError extends Error {
  constructor(host) { super(`No 127.0.0.1 line for ${host} in the hosts file`); this.name = 'HostNotFoundError'; }
}

const LINE = /^(\s*)(#\s*)?(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1)(\s+)([^#\r\n]*?)(\s*#.*)?$/;
const NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

function parseLine(line, index) {
  const m = line.match(LINE);
  if (!m) return null;
  const hosts = m[5].trim().split(/\s+/).filter(Boolean);
  if (!hosts.length || !hosts.every((h) => NAME.test(h)) || hosts.some((h) => h.toLowerCase() === 'localhost')) return null;
  return { index, ip: m[3], hosts, active: !m[2], indent: m[1] };
}

/** @returns {{ line: number, ip: string, hosts: string[], active: boolean }[]} */
export function parseHosts(text) {
  return text.split(/\r?\n/).map(parseLine).filter(Boolean).map(({ index, ip, hosts, active }) => ({ line: index, ip, hosts, active }));
}

/**
 * Turns the line(s) for host on (local = true: uncommented) or off (commented).
 * @returns {{ text: string, changed: boolean, affected: string[] }}
 */
export function setHostLocal(text, host, local) {
  const wanted = String(host).toLowerCase();
  const parts = text.split(/(\r?\n)/); // keeps the line endings as separate parts
  let found = false, changed = false;
  const affected = new Set();
  for (let i = 0; i < parts.length; i += 2) {
    const entry = parseLine(parts[i], i / 2);
    if (!entry || !entry.hosts.some((h) => h.toLowerCase() === wanted)) continue;
    found = true;
    entry.hosts.forEach((h) => affected.add(h));
    if (entry.active === local) continue;
    parts[i] = local ? parts[i].replace(/^(\s*)#\s*/, '$1') : `${entry.indent}#${parts[i].slice(entry.indent.length)}`;
    changed = true;
  }
  if (!found) throw new HostNotFoundError(host);
  return { text: parts.join(''), changed, affected: [...affected] };
}
