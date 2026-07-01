const net = require('node:net');

function getIpv4MappedAddress(ip) {
  const normalized = ip.toLowerCase();
  let embedded = null;

  if (normalized.startsWith('::ffff:')) {
    embedded = normalized.slice('::ffff:'.length);
  } else {
    const parts = normalized.split(':');
    if (
      (parts.length === 7 || parts.length === 8) &&
      parts.slice(0, 5).every((part) => /^[0-9a-f]{1,4}$/.test(part) && Number.parseInt(part, 16) === 0) &&
      /^[0-9a-f]{1,4}$/.test(parts[5]) &&
      Number.parseInt(parts[5], 16) === 0xffff
    ) {
      embedded = parts.slice(6).join(':');
    }
  }

  if (!embedded) {
    return null;
  }

  if (net.isIP(embedded) === 4) {
    return embedded;
  }

  const hextets = embedded.split(':');
  if (hextets.length !== 2 || hextets.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    return null;
  }

  const first = Number.parseInt(hextets[0], 16);
  const second = Number.parseInt(hextets[1], 16);
  return [
    (first >> 8) & 255,
    first & 255,
    (second >> 8) & 255,
    second & 255,
  ].join('.');
}

function isIpv6LinkLocalAddress(ip) {
  const firstHextet = Number.parseInt(ip.split(':')[0], 16);
  return firstHextet >= 0xfe80 && firstHextet <= 0xfebf;
}

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

  const mappedIpv4Address = getIpv4MappedAddress(ip);
  if (mappedIpv4Address) {
    return isPrivateIpAddress(mappedIpv4Address);
  }

  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (isIpv6LinkLocalAddress(normalized)) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // Unique local address (ULA)
  const siteLocalPrefix = normalized.slice(0, 3);
  if (siteLocalPrefix >= 'fec' && siteLocalPrefix <= 'fef') return true; // Site-local (deprecated, but still private)
  return false;
}

module.exports = { isPrivateIpAddress };
