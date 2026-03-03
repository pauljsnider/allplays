const functions = require('firebase-functions');

const CACHE_TTL_MS = 5 * 60 * 1000;
const inMemoryCache = new Map();

function normalizeIcsText(text) {
  const marker = 'BEGIN:VCALENDAR';
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) return text;
  return text.slice(markerIndex);
}

function normalizeTargetUrl(rawUrl) {
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
  const blockedHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0']);
  if (blockedHosts.has(host) || host.endsWith('.local')) {
    throw new Error('Blocked host');
  }

  return parsed.toString();
}

async function fetchWithTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'allplays-calendar-fetch/1.0',
        'Accept': 'text/calendar,text/plain,*/*'
      }
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

function writeCorsHeaders(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Cache-Control', 'no-store');
}

const calendarServiceAccount = functions.config()?.calendar?.service_account;
const fetchCalendarRuntime = calendarServiceAccount
  ? { serviceAccount: calendarServiceAccount }
  : {};

exports.fetchCalendarIcs = functions
  .runWith(fetchCalendarRuntime)
  .https
  .onRequest(async (req, res) => {
  writeCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const rawUrl = req.query.url;
    const forceRefresh = String(req.query.forceRefresh || '') === 'true';
    const normalizedUrl = normalizeTargetUrl(rawUrl);

    if (!forceRefresh) {
      const cached = inMemoryCache.get(normalizedUrl);
      if (cached && cached.expiresAt > Date.now()) {
        res.status(200).json({
          ok: true,
          source: 'cache',
          fetchedAt: cached.fetchedAt,
          icsText: cached.icsText
        });
        return;
      }
    }

    const response = await fetchWithTimeout(normalizedUrl);
    if (!response.ok) {
      res.status(502).json({
        ok: false,
        error: `Calendar fetch failed: ${response.status} ${response.statusText}`
      });
      return;
    }

    const rawText = await response.text();
    const icsText = normalizeIcsText(rawText);

    if (!icsText.includes('BEGIN:VCALENDAR')) {
      res.status(502).json({ ok: false, error: 'Response was not valid ICS' });
      return;
    }

    const fetchedAt = new Date().toISOString();
    inMemoryCache.set(normalizedUrl, {
      fetchedAt,
      expiresAt: Date.now() + CACHE_TTL_MS,
      icsText
    });

    res.status(200).json({
      ok: true,
      source: 'live',
      fetchedAt,
      icsText
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error?.message || 'Unknown error'
    });
  }
  });
