const net = require('node:net');

function isPrivateIpAddress(ip) {
  const ipVersion = net.isIP(ip);
  if (!ipVersion) {
    return true;
  }

  if (ipVersion === 4) {
    const parts = ip.split('.').map((part) => Number.parseInt(part, 10));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
      return true;
    }
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    return false;
  }

  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // Unique local address (ULA)
  const siteLocalPrefix = normalized.slice(0, 3);
  if (siteLocalPrefix >= 'fec' && siteLocalPrefix <= 'fef') return true; // Site-local (deprecated, but still private)
  return false;
}

module.exports = { isPrivateIpAddress };
