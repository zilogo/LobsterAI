/**
 * Selective proxy configuration.
 *
 * Instead of proxying everything and excluding via NO_PROXY,
 * this module implements a whitelist approach: only requests to
 * domains listed in PROXY_DOMAINS go through the proxy.
 *
 * Environment variables:
 *   PROXY_URL     - proxy address, e.g. http://172.16.10.3:10811
 *   PROXY_DOMAINS - comma-separated domain whitelist, e.g. github.com,google.com
 */

export function getProxyUrl(): string {
  return process.env.PROXY_URL || '';
}

export function getProxyDomains(): string[] {
  return (process.env.PROXY_DOMAINS || '')
    .split(',')
    .map(d => d.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Check if a URL (or bare hostname) should be routed through the proxy.
 */
export function shouldProxy(urlOrHostname: string): boolean {
  const domains = getProxyDomains();
  if (domains.length === 0) return false;

  let hostname: string;
  try {
    hostname = new URL(urlOrHostname).hostname.toLowerCase();
  } catch {
    // Treat as bare hostname
    hostname = urlOrHostname.toLowerCase();
  }

  return domains.some(domain =>
    hostname === domain || hostname.endsWith('.' + domain)
  );
}
