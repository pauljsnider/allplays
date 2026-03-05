import { afterEach, describe, expect, it } from 'vitest';
import {
  extractOpponent,
  formatRecurrence,
  formatTime,
  formatTimeRange,
  generateSeriesId,
  getDefaultEndTime,
  getUrlParams,
  isPracticeEvent,
  setUrlParams
} from '../../js/utils.js';

const originalWindow = globalThis.window;

afterEach(() => {
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
});

describe('getUrlParams', () => {
  it('combines search and hash params with hash taking precedence', () => {
    globalThis.window = {
      location: {
        search: '?team=hawks&view=month',
        hash: '#view=week&mode=compact'
      }
    };

    expect(getUrlParams()).toEqual({
      team: 'hawks',
      view: 'week',
      mode: 'compact'
    });
  });

  it('returns an empty object when there are no params', () => {
    globalThis.window = {
      location: {
        search: '',
        hash: ''
      }
    };

    expect(getUrlParams()).toEqual({});
  });
});

describe('setUrlParams', () => {
  it('writes encoded params to location hash', () => {
    const location = { hash: '' };
    globalThis.window = { location };

    setUrlParams({ team: 'hawks and eagles', mode: 'compact' });

    expect(location.hash).toBe('team=hawks+and+eagles&mode=compact');
  });
});

describe('extractOpponent', () => {
  it('returns Unknown when summary is missing', () => {
    expect(extractOpponent('')).toBe('Unknown');
  });

  it('extracts opponent from away-format summaries', () => {
    expect(extractOpponent('Hawks @ Eagles')).toBe('Eagles');
  });

  it('removes the provided team name from vs summaries', () => {
    expect(extractOpponent('Hawks vs Hawks Eagles', 'Hawks')).toBe('Eagles');
  });

  it('falls back to the right-hand side for reverse-vs summaries', () => {
    expect(extractOpponent('Eagles vs Hawks', 'Hawks')).toBe('Hawks');
  });
});

describe('isPracticeEvent', () => {
  it('identifies practice-related event names', () => {
    expect(isPracticeEvent('Morning Practice')).toBe(true);
    expect(isPracticeEvent('Speed Training Session')).toBe(true);
    expect(isPracticeEvent('Winter Skills Club')).toBe(true);
  });
});

describe('formatTimeRange', () => {
  it('formats ranges when both start and end are present', () => {
    const start = new Date('2026-03-01T18:00:00Z');
    const end = new Date('2026-03-01T20:30:00Z');
    expect(formatTimeRange(start, end)).toBe(`${formatTime(start)} - ${formatTime(end)}`);
  });
});

describe('getDefaultEndTime', () => {
  it('uses the practice default duration when requested', () => {
    const start = { toDate: () => new Date('2026-03-01T18:00:00Z') };
    const result = getDefaultEndTime(start, 'practice');
    expect(result.toISOString()).toBe('2026-03-01T19:30:00.000Z');
  });
});

describe('generateSeriesId', () => {
  it('creates UUIDv4-like identifiers', () => {
    const one = generateSeriesId();
    const two = generateSeriesId();
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

    expect(one).toMatch(uuidV4Regex);
    expect(two).toMatch(uuidV4Regex);
    expect(one).not.toBe(two);
  });
});

describe('formatRecurrence', () => {
  it('formats a weekly recurrence with day names and count', () => {
    expect(
      formatRecurrence({
        freq: 'weekly',
        interval: 2,
        byDays: ['MO', 'WE'],
        count: 5
      })
    ).toBe('Every 2 weeks on Mon, Wed, 5 times');
  });

  it('formats daily interval and until date', () => {
    const until = new Date('2026-03-15T00:00:00Z');
    expect(
      formatRecurrence({
        freq: 'daily',
        interval: 1,
        until
      })
    ).toBe(`Daily until ${until.toLocaleDateString()}`);
  });
});
