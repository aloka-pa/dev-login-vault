// Tells which copy of a site a page came from: the browser's own machine (local IIS) or another server.
(function (DLV) {
  const DEFAULT_LABELS = Object.freeze({ local: 'Local IIS', remote: 'Server' });

  /** @returns {"local"|"remote"|"unknown"} */
  function classifyIp(ip) {
    if (typeof ip !== 'string') return 'unknown';
    let value = ip.trim().toLowerCase();
    if (!value) return 'unknown';
    if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);

    const mapped = value.match(/^(?:0{0,4}:){0,5}:?ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) value = mapped[1];

    if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) return value.split('.')[0] === '127' ? 'local' : 'remote';
    if (value.includes(':')) return isIpv6Loopback(value) ? 'local' : 'remote';
    return 'unknown';
  }

  function isIpv6Loopback(value) {
    if (value === '::1') return true;
    const parts = value.split(':');
    return parts.length === 8 && parts.slice(0, 7).every((p) => /^0{1,4}$/.test(p)) && /^0{0,3}1$/.test(parts[7]);
  }

  DLV.env = { classifyIp, DEFAULT_LABELS };
})(globalThis.DLV);
