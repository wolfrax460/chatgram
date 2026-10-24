/**
 * SSRF guard for admin-entered AI endpoints.
 *
 * Requirements:
 *  - https only, unless the host is explicitly allow-listed by env
 *    (`AI_ALLOWED_LOCAL_HOSTS=localhost:11434,host.docker.internal:1234`),
 *  - no private / loopback / link-local / metadata addresses unless allow-listed,
 *  - no credentials embedded in the URL.
 */
const dns = require('dns').promises;
const net = require('net');

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^0\./,
];

function isPrivateIp(ip) {
  if (!net.isIP(ip)) return false;
  if (net.isIPv4(ip)) return PRIVATE_V4.some((pattern) => pattern.test(ip));
  const lower = ip.toLowerCase();
  return (
    lower === '::1' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe80') ||
    lower === '::'
  );
}

function allowedLocalHosts() {
  return String(process.env.AI_ALLOWED_LOCAL_HOSTS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * @returns {Promise<{ok: true, url: URL} | {ok: false, message: string}>}
 */
async function validateBaseUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    return { ok: false, message: 'Enter a valid URL for the provider endpoint.' };
  }
  if (url.username || url.password) {
    return { ok: false, message: 'Do not put credentials in the URL — use the API key field.' };
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { ok: false, message: 'The endpoint must use http(s).' };
  }

  const host = url.hostname.toLowerCase();
  const hostWithPort = url.port ? `${host}:${url.port}` : host;
  const allowListed = allowedLocalHosts().includes(hostWithPort) || allowedLocalHosts().includes(host);
  const localHostNames = ['localhost', '127.0.0.1', '::1', 'host.docker.internal'];

  if (url.protocol === 'http:') {
    if (!allowListed) {
      return {
        ok: false,
        message:
          'Plain http endpoints are only allowed for local model servers in AI_ALLOWED_LOCAL_HOSTS. Use https, or add the host to that env var.',
      };
    }
  }

  if (localHostNames.includes(host) || isPrivateIp(host)) {
    if (!allowListed) {
      return {
        ok: false,
        message:
          'That address is private. Add it to AI_ALLOWED_LOCAL_HOSTS if it is your own local model server.',
      };
    }
    return { ok: true, url };
  }

  // Resolve the hostname and reject private results (DNS rebinding guard).
  try {
    const records = await dns.lookup(host, { all: true });
    if (records.some((record) => isPrivateIp(record.address))) {
      return {
        ok: false,
        message: 'That hostname resolves to a private address. Add it to AI_ALLOWED_LOCAL_HOSTS if intentional.',
      };
    }
  } catch {
    return { ok: false, message: 'That hostname could not be resolved.' };
  }

  return { ok: true, url };
}

module.exports = { validateBaseUrl, isPrivateIp, allowedLocalHosts };
