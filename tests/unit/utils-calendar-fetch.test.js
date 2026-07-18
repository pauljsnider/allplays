import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fetchAndParseCalendar } from '../../js/utils.js';

function makeTextResponse(body, { ok = true, status = 200, statusText = 'OK', headers = {} } = {}) {
  return {
    ok,
    status,
    statusText,
    headers,
    async text() {
      return body;
    }
  };
}

function makeJsonResponse(body, { ok = true, status = 200, statusText = 'OK' } = {}) {
  return makeTextResponse(JSON.stringify(body), {
    ok,
    status,
    statusText,
    headers: { 'content-type': 'application/json' }
  });
}

function sampleIcs(uid = 'uid-1', summary = 'Wildcats vs TBD') {
  return [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTART:20260307T121529Z',
    `SUMMARY:${summary}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\n');
}

beforeEach(() => {
  vi.stubGlobal('window', {
    __ALLPLAYS_CONFIG__: {
      calendarFetchFunctionUrl: 'https://example.com/fetchCalendarIcs'
    }
  });
  vi.stubGlobal('document', {
    querySelector: () => null
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchAndParseCalendar', () => {
  it('uses Firebase function first and returns parsed events when function succeeds', async () => {
    const fetchMock = vi.fn(async (url) => {
      expect(url).toContain('example.com/fetchCalendarIcs');
      expect(String(url)).not.toContain('forceRefresh=true');
      return makeJsonResponse({
        ok: true,
        icsText: sampleIcs('from-function')
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    const events = await fetchAndParseCalendar('http://ical-cdn.teamsnap.com/team_schedule/test.ics');

    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe('from-function');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('includes forceRefresh only when explicitly requested', async () => {
    const fetchMock = vi.fn(async (url) => {
      expect(String(url)).toContain('forceRefresh=true');
      return makeJsonResponse({
        ok: true,
        icsText: sampleIcs('force-refresh')
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    const events = await fetchAndParseCalendar('http://ical-cdn.teamsnap.com/team_schedule/test.ics', { forceRefresh: true });

    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe('force-refresh');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to direct fetch with normalized https URL when function fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse({ ok: false, error: 'fail' }, { status: 500, statusText: 'Server Error' }))
      .mockResolvedValueOnce(makeTextResponse(sampleIcs('from-direct')));

    vi.stubGlobal('fetch', fetchMock);

    const events = await fetchAndParseCalendar('http://ical-cdn.teamsnap.com/team_schedule/test.ics');

    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe('from-direct');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://ical-cdn.teamsnap.com/team_schedule/test.ics');
  });

  it('normalizes webcal subscription URLs before function and direct fetch attempts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse({ ok: false, error: 'fail' }, { status: 500, statusText: 'Server Error' }))
      .mockResolvedValueOnce(makeTextResponse(sampleIcs('from-webcal')));

    vi.stubGlobal('fetch', fetchMock);

    const events = await fetchAndParseCalendar('webcal://example.com/team-calendar');

    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe('from-webcal');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain(encodeURIComponent('https://example.com/team-calendar'));
    expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/team-calendar');
  });

  it('uses only explicitly configured proxy templates when function and direct fetch fail', async () => {
    window.__ALLPLAYS_CONFIG__.calendarProxyUrlTemplates = [
      'https://calendar-proxy.example.test/?url={url}'
    ];
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes('example.com/fetchCalendarIcs')) {
        throw new TypeError('function failed');
      }
      if (String(url) === 'https://ical-cdn.teamsnap.com/team_schedule/test.ics') {
        throw new TypeError('direct failed');
      }
      if (String(url) === `https://calendar-proxy.example.test/?url=${encodeURIComponent('https://ical-cdn.teamsnap.com/team_schedule/test.ics')}`) {
        return makeTextResponse(sampleIcs('from-proxy'));
      }
      return makeTextResponse('', { ok: false, status: 404, statusText: 'Not Found' });
    });

    vi.stubGlobal('fetch', fetchMock);

    const events = await fetchAndParseCalendar('http://ical-cdn.teamsnap.com/team_schedule/test.ics');

    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe('from-proxy');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('corsproxy.io'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('r.jina.ai'))).toBe(false);
  });

  it('normalizes webcal subscription URLs before proxy fallback attempts', async () => {
    window.__ALLPLAYS_CONFIG__.calendarProxyUrlTemplates = [
      'https://calendar-proxy.example.test/?url={url}'
    ];
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes('example.com/fetchCalendarIcs')) {
        throw new TypeError('function failed');
      }
      if (String(url) === 'https://example.com/team-calendar') {
        throw new TypeError('direct failed');
      }
      if (String(url) === `https://calendar-proxy.example.test/?url=${encodeURIComponent('https://example.com/team-calendar')}`) {
        return makeTextResponse(sampleIcs('from-webcal-proxy'));
      }
      return makeTextResponse('', { ok: false, status: 404, statusText: 'Not Found' });
    });

    vi.stubGlobal('fetch', fetchMock);

    const events = await fetchAndParseCalendar('webcal://example.com/team-calendar');

    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe('from-webcal-proxy');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('webcal://'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) =>
      String(url).startsWith('https://calendar-proxy.example.test/'))).toBe(true);
  });

  it('does not disclose a subscription URL to third-party proxies by default', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('function failed'))
      .mockRejectedValueOnce(new TypeError('direct failed'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAndParseCalendar('https://calendar.example.test/private.ics?token=secret'))
      .rejects.toThrow('direct failed');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('corsproxy.io'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('r.jina.ai'))).toBe(false);
  });

  it('rejects non-network calendar schemes and embedded URL credentials before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAndParseCalendar('data:text/calendar,BEGIN:VCALENDAR'))
      .rejects.toThrow('Only HTTPS calendar URLs are supported');
    await expect(fetchAndParseCalendar('https://user:password@example.com/private.ics'))
      .rejects.toThrow('credentials are not supported');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects declared oversized and explicitly incompatible direct responses', async () => {
    const oversizedFetch = vi.fn()
      .mockResolvedValueOnce(makeJsonResponse({ ok: false }, { status: 500 }))
      .mockResolvedValueOnce(makeTextResponse(sampleIcs(), {
        headers: { 'content-length': String((2 * 1024 * 1024) + 1), 'content-type': 'text/calendar' }
      }));
    vi.stubGlobal('fetch', oversizedFetch);
    await expect(fetchAndParseCalendar('https://example.com/team.ics'))
      .rejects.toThrow('size limit');

    const htmlFetch = vi.fn()
      .mockResolvedValueOnce(makeJsonResponse({ ok: false }, { status: 500 }))
      .mockResolvedValueOnce(makeTextResponse('<html>login</html>', {
        headers: { 'content-type': 'text/html' }
      }));
    vi.stubGlobal('fetch', htmlFetch);
    await expect(fetchAndParseCalendar('https://example.com/team.ics?html=1'))
      .rejects.toThrow('unsupported content type');
  });

  it('retains compatibility with legacy calendar MIME types', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeJsonResponse({ ok: false }, { status: 500 }))
      .mockResolvedValueOnce(makeTextResponse(sampleIcs('legacy-mime'), {
        headers: { 'content-type': 'application/x-ical' }
      }));
    vi.stubGlobal('fetch', fetchMock);

    const events = await fetchAndParseCalendar('https://example.com/legacy.ics');
    expect(events[0].uid).toBe('legacy-mime');
  });

  it('coalesces concurrent identical calendar imports and omits credentials/referrers', async () => {
    let resolveFetch;
    const fetchMock = vi.fn((_url, init) => {
      expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
      return new Promise((resolve) => { resolveFetch = resolve; });
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = fetchAndParseCalendar('https://example.com/coalesced.ics');
    const second = fetchAndParseCalendar('https://example.com/coalesced.ics');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch(makeJsonResponse({ ok: true, icsText: sampleIcs('coalesced') }));

    const [firstEvents, secondEvents] = await Promise.all([first, second]);
    expect(firstEvents[0].uid).toBe('coalesced');
    expect(secondEvents[0].uid).toBe('coalesced');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
