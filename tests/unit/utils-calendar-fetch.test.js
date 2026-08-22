import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
  functions: { name: 'functions' },
  callable: vi.fn(),
  httpsCallable: vi.fn()
}));

vi.mock('../../js/firebase.js?v=26', () => ({
  functions: firebaseMocks.functions,
  httpsCallable: firebaseMocks.httpsCallable
}));

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

function makeJsonResponse(body, { status = 200, statusText = 'OK', ok = status >= 200 && status < 300 } = {}) {
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
  firebaseMocks.callable.mockReset();
  firebaseMocks.httpsCallable.mockReset();
  firebaseMocks.httpsCallable.mockReturnValue(firebaseMocks.callable);
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
  it('uses the authenticated callable for a team-scoped import without a browser fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    firebaseMocks.callable.mockResolvedValue({
      data: {
        version: 1,
        complete: true,
        source: 'live',
        fetchedAt: '2026-08-22T12:00:00.000Z',
        icsText: sampleIcs('authenticated-team')
      }
    });

    const events = await fetchAndParseCalendar('webcal://calendar.example.test/team.ics', {
      teamId: 'team-1'
    });

    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe('authenticated-team');
    expect(firebaseMocks.httpsCallable).toHaveBeenCalledWith(
      firebaseMocks.functions,
      'getTeamCalendarIcs',
      { timeout: 15_000 }
    );
    expect(firebaseMocks.callable).toHaveBeenCalledWith({
      teamId: 'team-1',
      calendarUrl: 'https://calendar.example.test/team.ics'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      version: 1,
      complete: false,
      source: 'cache',
      fetchedAt: '2026-08-22T12:00:00.000Z',
      icsText: sampleIcs('partial')
    },
    {
      version: 2,
      complete: true,
      source: 'cache',
      fetchedAt: '2026-08-22T12:00:00.000Z',
      icsText: sampleIcs('wrong-version')
    },
    {
      version: 1,
      complete: true,
      source: 'stale-cache',
      fetchedAt: '2026-08-22T12:00:00.000Z',
      icsText: sampleIcs('stale-cache')
    },
    {
      version: 1,
      complete: true,
      source: 'unknown',
      fetchedAt: '2026-08-22T12:00:00.000Z',
      icsText: sampleIcs('wrong-source')
    }
  ])('rejects incomplete or invalid authenticated callable responses', async (data) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    firebaseMocks.callable.mockResolvedValue({ data });

    await expect(fetchAndParseCalendar('https://calendar.example.test/private.ics', {
      teamId: 'team-1'
    })).rejects.toMatchObject({ code: 'CALENDAR_CALLABLE_INVALID' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves stable UID and recurrence occurrence identities from callable ICS', async () => {
    const recurringIcs = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:series-uid',
      'DTSTART:20260822T180000Z',
      'SUMMARY:Practice',
      'RRULE:FREQ=DAILY;COUNT=2',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\n');
    vi.stubGlobal('fetch', vi.fn());
    firebaseMocks.callable.mockResolvedValue({
      data: {
        version: 1,
        complete: true,
        source: 'live',
        fetchedAt: '2026-08-22T12:00:00.000Z',
        icsText: recurringIcs
      }
    });

    const events = await fetchAndParseCalendar('https://calendar.example.test/series.ics', {
      teamId: 'team-1',
      forceRefresh: true
    });

    expect(events.map((event) => event.uid)).toEqual(['series-uid', 'series-uid']);
    expect(events.map((event) => event.id)).toEqual([
      'series-uid__2026-08-22T18:00:00.000Z',
      'series-uid__2026-08-23T18:00:00.000Z'
    ]);
    expect(firebaseMocks.callable).toHaveBeenCalledWith({
      teamId: 'team-1',
      calendarUrl: 'https://calendar.example.test/series.ics',
      forceRefresh: true
    });
  });

  it('rejects a callable ICS recurrence that would otherwise be silently truncated', async () => {
    const recurringIcs = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:over-limit-series',
      'DTSTART:20260822T180000Z',
      'SUMMARY:Practice',
      'RRULE:FREQ=DAILY;COUNT=367',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\n');
    vi.stubGlobal('fetch', vi.fn());
    firebaseMocks.callable.mockResolvedValue({
      data: {
        version: 1,
        complete: true,
        source: 'live',
        fetchedAt: '2026-08-22T12:00:00.000Z',
        icsText: recurringIcs
      }
    });

    await expect(fetchAndParseCalendar('https://calendar.example.test/series.ics', {
      teamId: 'team-1'
    })).rejects.toMatchObject({ code: 'CALENDAR_PARSE_LIMIT' });
  });

  it('does not coalesce authenticated imports across teams or account switches', async () => {
    vi.stubGlobal('fetch', vi.fn());
    firebaseMocks.callable.mockImplementation(async (request) => ({
      data: {
        version: 1,
        complete: true,
        source: request.teamId === 'team-1' ? 'live' : 'cache',
        fetchedAt: '2026-08-22T12:00:00.000Z',
        icsText: sampleIcs(request.teamId)
      }
    }));

    const first = fetchAndParseCalendar('https://calendar.example.test/shared.ics', { teamId: 'team-1' });
    const second = fetchAndParseCalendar('https://calendar.example.test/shared.ics', { teamId: 'team-1' });
    const third = fetchAndParseCalendar('https://calendar.example.test/shared.ics', { teamId: 'team-2' });

    const [firstEvents, secondEvents, thirdEvents] = await Promise.all([first, second, third]);
    expect(firebaseMocks.callable).toHaveBeenCalledTimes(3);
    expect(firstEvents[0].uid).toBe('team-1');
    expect(secondEvents[0].uid).toBe('team-1');
    expect(thirdEvents[0].uid).toBe('team-2');
  });

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

  it('uses the repository first-party endpoint when runtime configuration is absent', async () => {
    window.__ALLPLAYS_CONFIG__ = {};
    const fetchMock = vi.fn().mockResolvedValueOnce(makeJsonResponse({
      ok: true,
      icsText: sampleIcs('default-function')
    }));
    vi.stubGlobal('fetch', fetchMock);

    const events = await fetchAndParseCalendar('https://calendar.example.test/team.ics');

    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe('default-function');
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `https://us-central1-game-flow-c6311.cloudfunctions.net/fetchCalendarIcs?url=${encodeURIComponent('https://calendar.example.test/team.ics')}`
    );
  });

  it('uses the shared functions base URL for an explicitly configured local endpoint', async () => {
    window.__ALLPLAYS_CONFIG__ = {
      functionsBaseUrl: 'http://127.0.0.1:5001/demo-project/us-central1/'
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(makeJsonResponse({
      ok: true,
      icsText: sampleIcs('local-function')
    }));
    vi.stubGlobal('fetch', fetchMock);

    const events = await fetchAndParseCalendar('https://calendar.example.test/team.ics');

    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe('local-function');
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `http://127.0.0.1:5001/demo-project/us-central1/fetchCalendarIcs?url=${encodeURIComponent('https://calendar.example.test/team.ics')}`
    );
  });

  it('preserves compatibility with a UTF-8 BOM and line-aligned provider preamble', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeJsonResponse({
      ok: true,
      icsText: `\uFEFFprovider preamble\n${sampleIcs('bom-preamble')}`
    }));
    vi.stubGlobal('fetch', fetchMock);

    const events = await fetchAndParseCalendar('https://example.com/bom.ics');

    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe('bom-preamble');
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

  it('never sends the calendar target directly from the browser when the function fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeJsonResponse({ ok: false, error: 'fail' }, { status: 500, statusText: 'Server Error' }));

    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAndParseCalendar('http://ical-cdn.teamsnap.com/team_schedule/test.ics'))
      .rejects.toThrow('Function fetch failed');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url) === 'https://ical-cdn.teamsnap.com/team_schedule/test.ics')).toBe(false);
  });

  it('normalizes webcal subscription URLs before the protected function request', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeJsonResponse({
      ok: true,
      icsText: sampleIcs('from-webcal')
    }));

    vi.stubGlobal('fetch', fetchMock);

    const events = await fetchAndParseCalendar('webcal://example.com/team-calendar');

    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe('from-webcal');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(encodeURIComponent('https://example.com/team-calendar'));
  });

  it('uses only explicitly configured proxy templates when the function is unavailable', async () => {
    window.__ALLPLAYS_CONFIG__.calendarProxyUrlTemplates = [
      'https://calendar-proxy.example.test/?url={url}'
    ];
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes('example.com/fetchCalendarIcs')) {
        throw new TypeError('function failed');
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
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('function failed'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAndParseCalendar('https://calendar.example.test/private.ics?token=secret'))
      .rejects.toThrow('function failed');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('corsproxy.io'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('r.jina.ai'))).toBe(false);
  });

  it('does not bypass a target rejection through a configured proxy', async () => {
    window.__ALLPLAYS_CONFIG__.calendarProxyUrlTemplates = [
      'https://calendar-proxy.example.test/?url={url}'
    ];
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse({ ok: false, error: 'Blocked host' }, { status: 400, statusText: 'Bad Request' })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAndParseCalendar('https://calendar.example.test/team.ics'))
      .rejects.toMatchObject({ code: 'CALENDAR_FUNCTION_REJECTED' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('https://calendar-proxy.example.test/'))).toBe(false);
  });

  it('does not bypass first-party calendar validation through a configured proxy', async () => {
    window.__ALLPLAYS_CONFIG__.calendarProxyUrlTemplates = [
      'https://calendar-proxy.example.test/?url={url}'
    ];
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse({
        ok: false,
        error: 'Response was not valid ICS',
        validationRejected: true
      }, { status: 502, statusText: 'Bad Gateway' })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAndParseCalendar('https://calendar.example.test/invalid.ics'))
      .rejects.toMatchObject({ code: 'CALENDAR_FUNCTION_REJECTED' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('https://calendar-proxy.example.test/'))).toBe(false);
  });

  it('rejects non-network, credentialed, and protected calendar targets before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAndParseCalendar('data:text/calendar,BEGIN:VCALENDAR'))
      .rejects.toThrow('Only HTTPS calendar URLs are supported');
    await expect(fetchAndParseCalendar('https://user:password@example.com/private.ics'))
      .rejects.toThrow('credentials are not supported');
    for (const target of [
      'https://localhost/private.ics',
      'https://127.0.0.1/private.ics',
      'https://192.168.1.20/private.ics',
      'https://[::1]/private.ics',
      'https://metadata.google.internal/computeMetadata/v1/'
    ]) {
      await expect(fetchAndParseCalendar(target)).rejects.toThrow('Protected calendar hosts');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects declared oversized and explicitly incompatible configured-proxy responses', async () => {
    const fatalLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.__ALLPLAYS_CONFIG__.calendarProxyUrlTemplates = [
      'https://calendar-proxy.example.test/?url={url}'
    ];
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
    expect(fatalLog).not.toHaveBeenCalled();
  });

  it('retains compatibility with legacy calendar MIME types', async () => {
    window.__ALLPLAYS_CONFIG__.calendarProxyUrlTemplates = [
      'https://calendar-proxy.example.test/?url={url}'
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeJsonResponse({ ok: false }, { status: 500 }))
      .mockResolvedValueOnce(makeTextResponse(sampleIcs('legacy-mime'), {
        headers: { 'content-type': 'application/x-ical' }
      }));
    vi.stubGlobal('fetch', fetchMock);

    const events = await fetchAndParseCalendar('https://example.com/legacy.ics');
    expect(events[0].uid).toBe('legacy-mime');
  });

  it('rejects non-exact or unterminated VCALENDAR boundaries from the function', async () => {
    const markerPrefixFetch = vi.fn().mockResolvedValueOnce(makeJsonResponse({
      ok: true,
      icsText: 'BEGIN:VCALENDARX\nBEGIN:VEVENT\nEND:VEVENT\nEND:VCALENDAR'
    }));
    vi.stubGlobal('fetch', markerPrefixFetch);
    await expect(fetchAndParseCalendar('https://example.com/prefix.ics'))
      .rejects.toMatchObject({ code: 'CALENDAR_ICS_INVALID' });

    const missingEndFetch = vi.fn().mockResolvedValueOnce(makeJsonResponse({
      ok: true,
      icsText: 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nEND:VEVENT'
    }));
    vi.stubGlobal('fetch', missingEndFetch);
    await expect(fetchAndParseCalendar('https://example.com/missing-end.ics'))
      .rejects.toMatchObject({ code: 'CALENDAR_ICS_INVALID' });
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
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolveFetch(makeJsonResponse({ ok: true, icsText: sampleIcs('coalesced') }));

    const [firstEvents, secondEvents] = await Promise.all([first, second]);
    expect(firstEvents[0].uid).toBe('coalesced');
    expect(secondEvents[0].uid).toBe('coalesced');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('queues the 51st distinct import and drains it after an active import settles', async () => {
    const deferreds = [];
    const fetchMock = vi.fn(() => new Promise((resolve, reject) => {
      deferreds.push({ resolve, reject });
    }));
    vi.stubGlobal('fetch', fetchMock);

    const requests = Array.from({ length: 51 }, (_, index) =>
      fetchAndParseCalendar(`https://example.com/queued-${index}.ics`)
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(50));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('queued-50.ics'))).toBe(false);

    deferreds[0].resolve(makeJsonResponse({ ok: true, icsText: sampleIcs('queued-0') }));
    for (let index = 1; index < 50; index += 1) {
      deferreds[index].resolve(makeJsonResponse({ ok: true, icsText: sampleIcs(`queued-${index}`) }));
    }
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(51));
    deferreds[50].resolve(makeJsonResponse({ ok: true, icsText: sampleIcs('queued-50') }));
    await Promise.all(requests);
  });

  it('drains the FIFO queue after an active import fails', async () => {
    const deferreds = [];
    const fetchMock = vi.fn(() => new Promise((resolve, reject) => {
      deferreds.push({ resolve, reject });
    }));
    vi.stubGlobal('fetch', fetchMock);

    const requests = Array.from({ length: 51 }, (_, index) =>
      fetchAndParseCalendar(`https://example.com/failure-queue-${index}.ics`)
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(50));
    const firstFailure = expect(requests[0]).rejects.toThrow('controlled failure');
    deferreds[0].reject(new Error('controlled failure'));
    for (let index = 1; index < 50; index += 1) {
      deferreds[index].resolve(makeJsonResponse({ ok: true, icsText: sampleIcs(`failure-queue-${index}`) }));
    }
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(51));
    deferreds[50].resolve(makeJsonResponse({ ok: true, icsText: sampleIcs('failure-queue-50') }));
    await firstFailure;
    await Promise.all(requests.slice(1));
  });

  it('coalesces duplicates while queued and keeps force refresh separate', async () => {
    const deferreds = [];
    const fetchMock = vi.fn(() => new Promise((resolve, reject) => {
      deferreds.push({ resolve, reject });
    }));
    vi.stubGlobal('fetch', fetchMock);

    const active = Array.from({ length: 50 }, (_, index) =>
      fetchAndParseCalendar(`https://example.com/active-${index}.ics`)
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(50));
    const queued = fetchAndParseCalendar('https://example.com/duplicate.ics');
    const duplicate = fetchAndParseCalendar('https://example.com/duplicate.ics');
    const refresh = fetchAndParseCalendar('https://example.com/duplicate.ics', { forceRefresh: true });
    expect(duplicate).toBe(queued);
    expect(fetchMock).toHaveBeenCalledTimes(50);

    deferreds[0].resolve(makeJsonResponse({ ok: true, icsText: sampleIcs('active-0') }));
    for (let index = 1; index < 50; index += 1) {
      deferreds[index].resolve(makeJsonResponse({ ok: true, icsText: sampleIcs(`active-${index}`) }));
    }
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(52));
    deferreds[50].resolve(makeJsonResponse({ ok: true, icsText: sampleIcs('duplicate') }));
    deferreds[51].resolve(makeJsonResponse({ ok: true, icsText: sampleIcs('duplicate-refresh') }));
    await Promise.all([queued, refresh, ...active.slice(1)]);
  });

  it('returns a distinct capacity error only after the pending queue budget is exhausted', async () => {
    const deferreds = [];
    const fetchMock = vi.fn(() => new Promise((resolve) => {
      deferreds.push(resolve);
    }));
    vi.stubGlobal('fetch', fetchMock);

    const active = Array.from({ length: 50 }, (_, index) =>
      fetchAndParseCalendar(`https://example.com/capacity-active-${index}.ics`)
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(50));
    const queued = Array.from({ length: 50 }, (_, index) =>
      fetchAndParseCalendar(`https://example.com/capacity-queued-${index}.ics`)
    );
    await expect(fetchAndParseCalendar('https://example.com/capacity-overflow.ics'))
      .rejects.toMatchObject({ code: 'CALENDAR_IMPORT_QUEUE_FULL' });
    for (let index = 0; index < 50; index += 1) {
      deferreds[index](makeJsonResponse({ ok: true, icsText: sampleIcs(`capacity-${index}`) }));
    }
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(100));
    for (let index = 50; index < deferreds.length; index += 1) {
      deferreds[index](makeJsonResponse({ ok: true, icsText: sampleIcs(`capacity-${index}`) }));
    }
    await Promise.all([...active, ...queued]);
  });
});
