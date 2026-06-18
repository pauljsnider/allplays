const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns').promises;
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

let _http = require('node:http');
let _https = require('node:https');

function _setClientModulesForTesting(mockHttp, mockHttps) {
  _http = mockHttp || require('node:http');
  _https = mockHttps || require('node:https');
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
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  const siteLocalPrefix = normalized.slice(0, 3);
  if (siteLocalPrefix >= 'fec' && siteLocalPrefix <= 'fef') return true;
  return false;
}

function isBlockedHostname(host) {
  const blockedHosts = new Set([
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1',
    'metadata',
    'metadata.google.internal',
    '169.254.169.254'
  ]);
  return blockedHosts.has(host) || host.endsWith('.local');
}

async function assertPublicHost(host) {
  if (isBlockedHostname(host)) {
    throw new Error('Blocked host');
  }

  if (net.isIP(host)) {
    if (isPrivateIpAddress(host)) {
      throw new Error('Blocked host address');
    }
    return [host];
  }

  let resolvedEntries;
  try {
    resolvedEntries = await dns.lookup(host, { all: true, verbatim: true });
  } catch (error) {
    throw new Error('Could not resolve host');
  }

  if (!resolvedEntries.length) {
    throw new Error('Could not resolve host');
  }

  const publicIps = [];
  for (const entry of resolvedEntries) {
    if (isPrivateIpAddress(entry.address)) {
      throw new Error('Blocked host address');
    }
    publicIps.push(entry.address);
  }
  return publicIps;
}

async function normalizeTargetUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Missing url');
  }

  let cleaned = rawUrl.trim();
  if (cleaned.startsWith('webcal://')) {
    cleaned = cleaned.replace(/^webcal:\/\//i, 'https://');
  } else if (cleaned.startsWith('http://')) {
    cleaned = cleaned.replace(/^http:\/\//i, 'https://');
  }

  const parsed = new URL(cleaned);
  if (parsed.protocol !== 'https:') {
    throw new Error('Only https calendar URLs are allowed');
  }

  const host = parsed.hostname.toLowerCase();
  const publicIps = await assertPublicHost(host);

  return {
    url: parsed.toString(),
    hostname: parsed.hostname,
    publicIps: publicIps,
  };
}

async function fetchWithTimeout(url, originalHostname, publicIps, timeoutMs = 12000) {
  const controller = new AbortController();
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error('Calendar request timed out'));
    }, timeoutMs);
    controller.signal.addEventListener('abort', () => clearTimeout(timeoutId), { once: true });
  });

  const parsedUrl = new URL(url);
  const isHttps = parsedUrl.protocol === 'https:';
  const clientModule = isHttps ? _https : _http;

  if (!publicIps || publicIps.length === 0) {
    throw new Error('No public IPs provided for fetch connection after validation.');
  }

  const fetchAttempt = async (targetIp) => new Promise((resolve, reject) => {
    const requestOptions = {
      method: 'GET',
      headers: {
        'User-Agent': 'allplays-calendar-fetch/1.0',
        'Accept': 'text/calendar,text/plain,*/*',
        'Host': originalHostname,
      },
      signal: controller.signal,
      host: targetIp,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search + parsedUrl.hash,
      servername: originalHostname,
      maxRedirects: 0,
    };

    const req = clientModule.request(requestOptions, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve({
          ok: false,
          status: res.statusCode,
          statusText: res.statusMessage,
          text: () => Promise.resolve(`Redirect to ${res.headers.location}`),
        });
      }

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage,
          text: () => Promise.resolve(data),
        });
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Calendar fetch failed: ${err.message || 'Unknown network error'}`));
    });

    req.end();
  });

  const fetchAllAttempts = async () => {
    let lastError = null;

    for (const targetIp of publicIps) {
      try {
        return await fetchAttempt(targetIp);
      } catch (error) {
        if (controller.signal.aborted) {
          throw error;
        }
        lastError = error;
      }
    }

    throw lastError || new Error('Calendar fetch failed: Unknown network error');
  };

  return Promise.race([fetchAllAttempts(), timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

module.exports = {
  isPrivateIpAddress,
  isBlockedHostname,
  assertPublicHost,
  normalizeTargetUrl,
  fetchWithTimeout,
  _setClientModulesForTesting,
};