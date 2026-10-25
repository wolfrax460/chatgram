/**
 * Optional admin IP allowlist (9a).
 *
 * Off by default. When on, only requests whose client IP matches an entry (an
 * exact IPv4/IPv6 address or an IPv4 CIDR range) may sign in or use the admin
 * API. Enabling is refused unless the caller's current IP is included, which is
 * the lockout safety check.
 */
const AdminSecurity = require('../models/AdminSecurity');
const admin = require('./auth');

function normalizeIp(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let ip = raw;
  if (ip.toLowerCase().startsWith('::ffff:')) ip = ip.slice(7);
  // Strip a port if one was included (some proxies forward "1.2.3.4:5678").
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.split(':')[0];
  return ip.trim();
}

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8) | octet;
  }
  return value >>> 0;
}

/** Validates one list entry; returns the normalized string or null. */
function normalizeEntry(entry) {
  const value = normalizeIp(entry);
  if (!value) return null;
  if (value.includes('/')) {
    const [base, bitsRaw] = value.split('/');
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(base)) return null;
    const bits = Number(bitsRaw);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return null;
    if (ipv4ToInt(base) === null) return null;
    return `${base}/${bits}`;
  }
  if (value.includes(':')) {
    // IPv6: accept a plain hex-colon address (no range arithmetic needed).
    return /^[0-9a-f:.]+$/i.test(value) ? value.toLowerCase() : null;
  }
  return ipv4ToInt(value) === null ? null : value;
}

function parseList(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[\n,]+/);
  const entries = [];
  for (const item of raw) {
    const value = String(item || '').trim();
    if (!value) continue;
    const normalized = normalizeEntry(value);
    if (!normalized) {
      const error = new Error(`"${value}" is not a valid IP address or IPv4 range.`);
      error.status = 400;
      throw error;
    }
    if (!entries.includes(normalized)) entries.push(normalized);
  }
  if (entries.length > 50) {
    const error = new Error('Keep the allowlist to 50 entries or fewer.');
    error.status = 400;
    throw error;
  }
  return entries;
}

function ipMatches(ipRaw, entryRaw) {
  const ip = normalizeIp(ipRaw);
  const entry = normalizeEntry(entryRaw);
  if (!ip || !entry) return false;
  if (entry.includes('/')) {
    const [base, bitsRaw] = entry.split('/');
    const bits = Number(bitsRaw);
    const baseInt = ipv4ToInt(base);
    const ipInt = ipv4ToInt(ip);
    if (baseInt === null || ipInt === null) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (baseInt & mask) === (ipInt & mask);
  }
  return ip.toLowerCase() === entry.toLowerCase();
}

async function getDoc() {
  let doc = await AdminSecurity.findOne({ singleton: 'admin' });
  if (!doc) doc = await AdminSecurity.create({ singleton: 'admin' });
  return doc;
}

async function state() {
  const doc = await getDoc();
  return {
    ipAllowlistEnabled: doc.ipAllowlistEnabled === true,
    ipAllowlist: doc.ipAllowlist || [],
  };
}

async function isBlocked(ip) {
  const doc = await getDoc();
  if (!doc.ipAllowlistEnabled) return false;
  const list = doc.ipAllowlist || [];
  if (list.length === 0) return true; // enabled with no entries blocks everyone
  return !list.some((entry) => ipMatches(ip, entry));
}

async function setAllowlist({ enabled, ips, confirmCurrentIp }, currentIp, req) {
  const list = parseList(ips);
  const ip = normalizeIp(currentIp);
  if (enabled) {
    if (list.length === 0) {
      const error = new Error('Add at least your current IP before turning the allowlist on.');
      error.status = 400;
      throw error;
    }
    const included = list.some((entry) => ipMatches(ip, entry));
    if (!included) {
      const error = new Error(
        `Your current IP (${ip || 'unknown'}) is not in the list, so turning this on would lock you out. Add it first.`,
      );
      error.status = 400;
      throw error;
    }
  }
  const doc = await getDoc();
  doc.ipAllowlistEnabled = enabled === true;
  doc.ipAllowlist = list;
  await doc.save({ validateBeforeSave: false });
  await admin.audit('admin_ip_allowlist_update', req, `${enabled ? 'on' : 'off'} ${list.length} entries`);
  return {
    message: enabled
      ? `IP allowlist is on with ${list.length} entr${list.length === 1 ? 'y' : 'ies'}. Your IP (${ip}) is included.`
      : 'IP allowlist is off.',
    ...(await state()),
    currentIp: ip,
  };
}

module.exports = { normalizeIp, normalizeEntry, parseList, ipMatches, state, isBlocked, setAllowlist };
