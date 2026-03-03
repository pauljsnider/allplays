import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fetchAndParseCalendar } from '../../js/utils.js';

function makeTextResponse(body, { ok = true, status = 200, statusText = 'OK' } = {}) {
  return {
    ok,
    status,
    statusText,
    async text() {
      return body;
    }
  };
}

function makeJsonResponse(body, { ok = true, status = 200, statusText = 'OK' } = {}) {
  return {
    ok,
    status,
    statusText,
    async json() {
      return body;
    }
  };
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

  it('uses cache-busted r.jina proxy when function and direct fetch fail', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes('cloudfunctions.net/fetchCalendarIcs')) {
        throw new TypeError('function failed');
      }
      if (String(url) === 'https://ical-cdn.teamsnap.com/team_schedule/test.ics') {
        throw new TypeError('direct failed');
      }
      if (String(url).startsWith('https://corsproxy.io/')) {
        return makeTextResponse('', { ok: false, status: 403, statusText: 'Forbidden' });
      }
      if (String(url).includes('r.jina.ai/https://ical-cdn.teamsnap.com/team_schedule/test.ics?cachebust=1700000000000')) {
        return makeTextResponse(sampleIcs('from-proxy'));
      }
      return makeTextResponse('', { ok: false, status: 404, statusText: 'Not Found' });
    });

    vi.stubGlobal('fetch', fetchMock);

    const events = await fetchAndParseCalendar('http://ical-cdn.teamsnap.com/team_schedule/test.ics');

    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe('from-proxy');
    expect(dateNowSpy).toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) =>
      String(url).includes('cachebust=1700000000000'))).toBe(true);
  });
});
