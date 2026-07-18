const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns').promises;
const net = require('node:net');

const DEFAULT_CALENDAR_FETCH_TIMEOUT_MS = 12_000;
const DEFAULT_CALENDAR_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_CALENDAR_URL_LENGTH = 2_048;
const ALLOWED_CALENDAR_CONTENT_TYPES = new Set([
  'text/calendar',
  'text/x-vcalendar',
  'text/plain',
  'text/ics',
  'application/ics',
  'application/x-ical',
  'application/x-ics',
  'application/calendar',
  'application/vnd.apple.ical',
  'application/octet-stream'
]);

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
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // RFC 6598 shared address space
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
  if (!cleaned || cleaned.length > MAX_CALENDAR_URL_LENGTH) {
    throw new Error('Calendar URL is too long');
  }
  if (cleaned.startsWith('webcal://')) {
    cleaned = cleaned.replace(/^webcal:\/\//i, 'https://');
  } else if (cleaned.startsWith('http://')) {
    cleaned = cleaned.replace(/^http:\/\//i, 'https://');
  }

  const parsed = new URL(cleaned);
  if (parsed.protocol !== 'https:') {
    throw new Error('Only https calendar URLs are allowed');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Calendar URL credentials are not allowed');
  }
  parsed.hash = '';

  const parsedHostname = parsed.hostname.toLowerCase();
  const host = parsedHostname.startsWith('[') && parsedHostname.endsWith(']')
    ? parsedHostname.slice(1, -1)
    : parsedHostname;
  const publicIps = await assertPublicHost(host);

  return {
    url: parsed.toString(),
    hostname: host,
    publicIps: publicIps,
  };
}

function normalizeCalendarContentType(headers = {}) {
  const rawContentType = headers['content-type'] || headers['Content-Type'] || '';
  return String(rawContentType).split(';', 1)[0].trim().toLowerCase();
}

function isAllowedCalendarContentType(headers = {}) {
  const contentType = normalizeCalendarContentType(headers);
  // Some legacy calendar providers omit Content-Type. The VCALENDAR marker is
  // still validated by the caller, so absence remains a compatibility case;
  // an explicitly incompatible type (for example text/html) fails closed.
  return !contentType || ALLOWED_CALENDAR_CONTENT_TYPES.has(contentType);
}

function createCalendarFetchError(message, statusCode = 502) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.calendarFetchNonRetryable = true;
  return error;
}

async function fetchWithTimeout(
  url,
  originalHostname,
  publicIps,
  timeoutMs = DEFAULT_CALENDAR_FETCH_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_CALENDAR_MAX_RESPONSE_BYTES
) {
  const controller = new AbortController();
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(createCalendarFetchError('Calendar request timed out', 504));
    }, timeoutMs);
    controller.signal.addEventListener('abort', () => clearTimeout(timeoutId), { once: true });
  });

  const parsedUrl = new URL(url);
  const responseLimit = Number.isSafeInteger(maxResponseBytes) && maxResponseBytes > 0
    ? maxResponseBytes
    : DEFAULT_CALENDAR_MAX_RESPONSE_BYTES;
  const isHttps = parsedUrl.protocol === 'https:';
  const clientModule = isHttps ? _https : _http;
  const hostHeader = net.isIP(originalHostname) === 6 ? `[${originalHostname}]` : originalHostname;

  if (!publicIps || publicIps.length === 0) {
    throw new Error('No public IPs provided for fetch connection after validation.');
  }

  const fetchAttempt = async (targetIp) => new Promise((resolve, reject) => {
    const requestOptions = {
      method: 'GET',
      headers: {
        'User-Agent': 'allplays-calendar-fetch/1.0',
        'Accept': 'text/calendar,text/plain,*/*',
        'Host': hostHeader,
      },
      signal: controller.signal,
      host: targetIp,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      servername: originalHostname,
      maxRedirects: 0,
    };

    const req = clientModule.request(requestOptions, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume?.();
        return resolve({
          ok: false,
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: res.headers || {},
          text: () => Promise.resolve(`Redirect to ${res.headers.location}`),
        });
      }

      const declaredLength = Number.parseInt(String(res.headers?.['content-length'] || ''), 10);
      if (Number.isFinite(declaredLength) && declaredLength > responseLimit) {
        res.destroy?.();
        reject(createCalendarFetchError('Calendar response exceeded the size limit', 413));
        return;
      }
      if (!isAllowedCalendarContentType(res.headers)) {
        res.destroy?.();
        reject(createCalendarFetchError('Calendar response had an unsupported content type'));
        return;
      }
      const contentEncoding = String(res.headers?.['content-encoding'] || '').trim().toLowerCase();
      if (contentEncoding && contentEncoding !== 'identity') {
        res.destroy?.();
        reject(createCalendarFetchError('Compressed calendar responses are not supported'));
        return;
      }

      const chunks = [];
      let receivedBytes = 0;
      let settled = false;
      res.on('data', (chunk) => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += buffer.length;
        if (receivedBytes > responseLimit) {
          settled = true;
          res.destroy?.();
          req.destroy?.();
          reject(createCalendarFetchError('Calendar response exceeded the size limit', 413));
          return;
        }
        chunks.push(buffer);
      });
      res.on('end', () => {
        if (settled) return;
        settled = true;
        const data = Buffer.concat(chunks, receivedBytes).toString('utf8');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: res.headers || {},
          byteLength: receivedBytes,
          text: () => Promise.resolve(data),
        });
      });
      res.on('error', (error) => {
        if (settled) return;
        settled = true;
        reject(createCalendarFetchError(`Calendar response failed: ${error?.message || 'Unknown network error'}`));
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
        if (error?.calendarFetchNonRetryable) {
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
  DEFAULT_CALENDAR_FETCH_TIMEOUT_MS,
  DEFAULT_CALENDAR_MAX_RESPONSE_BYTES,
  MAX_CALENDAR_URL_LENGTH,
  isPrivateIpAddress,
  isBlockedHostname,
  assertPublicHost,
  normalizeTargetUrl,
  isAllowedCalendarContentType,
  fetchWithTimeout,
  _setClientModulesForTesting,
};
