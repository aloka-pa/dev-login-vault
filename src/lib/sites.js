// Knowledge about specific web apps. Classic script (popup, tests).
(function (DLV) {
  /**
   * The sign-out address for a PeoplesHR EHRM page, or null for other sites.
   * EHRM signs out at "<app>/security/logoff", where <app> is the path before "/security/" (e.g. /hr),
   * or the first path segment when it is "hr" (pages such as /hr/home/index or /hr/mtnav10/...).
   */
  function signOutUrl(href) {
    let url;
    try { url = new URL(href); } catch { return null; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const security = url.pathname.match(/^(.*?)\/security\//i);
    if (security) return `${url.origin}${security[1]}/security/logoff`;
    const first = url.pathname.split('/')[1] || '';
    if (first.toLowerCase() === 'hr') return `${url.origin}/${first}/security/logoff`;
    return null;
  }

  DLV.sites = { signOutUrl };
})(globalThis.DLV);
