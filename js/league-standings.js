function stripTags(value) {
  return String(value || '').replace(/<[^>]*>/g, '');
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

function cleanCell(value) {
  return decodeHtmlEntities(stripTags(value)).replace(/\s+/g, ' ').trim();
}

function toInt(value) {
  const n = Number.parseInt(String(value || '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeTeamKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function parseTeamSidelineStandings(html) {
  const source = String(html || '');
  const tableMatch = source.match(
    /<table[^>]*id="[^"]*standingsGrid[^"]*"[^>]*>[\s\S]*?<\/table>/i
  ) || source.match(
    /<table[^>]*>[\s\S]*?<th[^>]*>\s*Team\s*<\/th>[\s\S]*?<th[^>]*>\s*W\s*<\/th>[\s\S]*?<th[^>]*>\s*L\s*<\/th>[\s\S]*?<\/table>/i
  );

  if (!tableMatch) return [];

  const rows = [];
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(tableMatch[0])) !== null) {
    const rowHtml = rowMatch[1];
    const cellMatches = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cellMatches.length < 3) continue;

    const cells = cellMatches.map((m) => cleanCell(m[1]));
    const team = cells[0] || '';
    if (!team) continue;

    const w = toInt(cells[1]);
    const l = toInt(cells[2]);
    const t = toInt(cells[3]);
    const pct = cells[4] || '';
    const pf = toInt(cells[5]);
    const pa = toInt(cells[6]);
    const pd = toInt(cells[7]);
    const coach = cells[8] || '';

    rows.push({
      team,
      coach,
      w,
      l,
      t,
      pct,
      pf,
      pa,
      pd,
      record: t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`
    });
  }

  return rows;
}

export function findBestStandingMatch(rows, teamName) {
  const list = Array.isArray(rows) ? rows : [];
  if (!teamName || list.length === 0) return null;

  const target = normalizeTeamKey(teamName);
  if (!target) return null;

  const exact = list.find((row) => normalizeTeamKey(row.team) === target);
  if (exact) return exact;

  const partial = list.find((row) => {
    const key = normalizeTeamKey(row.team);
    return key && (key.includes(target) || target.includes(key));
  });
  return partial || null;
}

function buildProxyUrls(targetUrl) {
  const cleanedUrl = String(targetUrl || '').trim();
  const httpsUrl = cleanedUrl.replace(/^http:\/\//i, 'https://');
  return [
    `https://corsproxy.io/?${encodeURIComponent(httpsUrl)}`,
    `https://r.jina.ai/http://${httpsUrl.replace(/^https?:\/\//i, '')}`,
    `https://r.jina.ai/https://${httpsUrl.replace(/^https?:\/\//i, '')}`
  ];
}

async function fetchWithTimeout(url, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchLeagueStandings(leagueUrl, { teamName = '', fetchImpl = fetch, timeoutMs = 7000 } = {}) {
  const sourceUrl = String(leagueUrl || '').trim();
  if (!sourceUrl) {
    return { ok: false, reason: 'missing-url', rows: [], match: null };
  }

  const attempts = [sourceUrl, ...buildProxyUrls(sourceUrl)];
  let lastError = null;

  for (const url of attempts) {
    try {
      const response = await fetchWithTimeout(url, fetchImpl, timeoutMs);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      const rows = parseTeamSidelineStandings(html);
      if (rows.length === 0) {
        throw new Error('No standings table detected');
      }

      return {
        ok: true,
        reason: null,
        rows,
        match: findBestStandingMatch(rows, teamName),
        fetchedVia: url === sourceUrl ? 'direct' : 'proxy',
        sourceUrl
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    ok: false,
    reason: 'fetch-failed',
    error: lastError ? String(lastError.message || lastError) : 'Unknown error',
    rows: [],
    match: null,
    sourceUrl
  };
}
