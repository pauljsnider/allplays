const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MAX_FAMILY_SHARE_CALENDAR_URLS,
  MAX_FAMILY_SHARE_DB_EVENTS,
  buildExternalCalendarEvents,
  parseBoundedIcsEvents,
  sanitizeFamilyShareViewResponse
} = require('../family-share-view-core.cjs');

test('projects bounded recurring ICS events without returning source URLs or sentinels', () => {
  const sentinelUrl = 'https://calendar.example.test/private.ics?secret=SENTINEL_CALENDAR_SECRET';
  const events = buildExternalCalendarEvents([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:weekly-practice',
    'DTSTART:20260720T180000Z',
    'DTEND:20260720T190000Z',
    'RRULE:FREQ=WEEKLY;COUNT=3;BYDAY=MO',
    'SUMMARY:Practice',
    'LOCATION:Field 1',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n'), {
    sourceId: 'opaque-source-id',
    sourceLabel: 'Shared calendar 1',
    children: [{ playerId: 'player-1', playerName: 'Sam' }]
  });

  assert.equal(events.length, 3);
  assert.deepEqual(events.map((event) => event.date), [
    '2026-07-20T18:00:00.000Z',
    '2026-07-27T18:00:00.000Z',
    '2026-08-03T18:00:00.000Z'
  ]);
  assert.ok(events.every((event) => event.type === 'practice'));
  const response = sanitizeFamilyShareViewResponse({
    token: {
      ownerUserId: 'SENTINEL_OWNER_UID',
      extraCalendarUrls: [sentinelUrl],
      label: 'Grandma',
      expiresAt: new Date('2026-08-20T00:00:00Z')
    },
    children: [{ teamId: 'team-1', playerId: 'player-1' }],
    teams: [{ teamId: 'team-1', teamName: 'Bears', calendarUrls: [sentinelUrl], games: [] }],
    externalEvents: events
  });
  const payload = JSON.stringify(response);
  assert.equal(payload.includes('SENTINEL_CALENDAR_SECRET'), false);
  assert.equal(payload.includes('SENTINEL_OWNER_UID'), false);
  assert.equal(payload.includes('extraCalendarUrls'), false);
  assert.equal(payload.includes('calendarUrls'), false);
  assert.equal(response.presentation.label, 'Grandma');
});

test('preserves TZID wall-clock recurrence times across daylight saving transitions', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:dst-series',
    'DTSTART;TZID=America/Chicago:20260301T090000',
    'DTEND;TZID=America/Chicago:20260301T100000',
    'RRULE:FREQ=WEEKLY;COUNT=3;BYDAY=SU',
    'SUMMARY:Practice',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const events = buildExternalCalendarEvents(ics, { sourceId: 'safe-hash' });
  assert.deepEqual(events.map((event) => event.date), [
    '2026-03-01T15:00:00.000Z',
    '2026-03-08T14:00:00.000Z',
    '2026-03-15T14:00:00.000Z'
  ]);
});

test('applies recurrence COUNT before EXDATE removal', () => {
  const events = buildExternalCalendarEvents([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:counted-series',
    'DTSTART:20260720T180000Z',
    'RRULE:FREQ=WEEKLY;COUNT=3;BYDAY=MO',
    'EXDATE:20260727T180000Z',
    'SUMMARY:Practice',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n'), { sourceId: 'safe-hash' });

  assert.deepEqual(events.map((event) => event.date), [
    '2026-07-20T18:00:00.000Z',
    '2026-08-03T18:00:00.000Z'
  ]);
});

test('rejects an ICS feed over the bounded event count', () => {
  const rows = ['BEGIN:VCALENDAR'];
  for (let index = 0; index < 401; index += 1) {
    rows.push('BEGIN:VEVENT', `UID:${index}`, 'DTSTART:20260720T180000Z', `SUMMARY:Game ${index}`, 'END:VEVENT');
  }
  rows.push('END:VCALENDAR');
  assert.throws(() => parseBoundedIcsEvents(rows.join('\n')), /too many events/);
  assert.equal(MAX_FAMILY_SHARE_CALENDAR_URLS, 8);
});

test('bounds and allowlists database schedule projection fields', () => {
  const sentinelUrl = 'https://calendar.example.test/private.ics?secret=SENTINEL_DB_URL';
  const response = sanitizeFamilyShareViewResponse({
    token: { label: 'Family' },
    children: Array.from({ length: 60 }, (_, index) => ({
      teamId: 'team-1', playerId: `player-${index}`, playerName: `Player ${index}`, parentEmail: 'private@example.test'
    })),
    teams: [{
      teamId: 'team-1',
      teamName: 'Bears',
      calendarUrls: [sentinelUrl],
      games: Array.from({ length: MAX_FAMILY_SHARE_DB_EVENTS + 5 }, (_, index) => ({
        id: `game-${index}`,
        type: 'game',
        date: '2026-07-20T18:00:00.000Z',
        opponent: 'Comets',
        parentEmail: 'private@example.test',
        ownerUserId: 'SENTINEL_DB_OWNER'
      }))
    }]
  });

  assert.equal(response.children.length, 50);
  assert.equal(response.teams[0].games.length, MAX_FAMILY_SHARE_DB_EVENTS);
  const payload = JSON.stringify(response);
  assert.equal(payload.includes('private@example.test'), false);
  assert.equal(payload.includes('SENTINEL_DB_OWNER'), false);
  assert.equal(payload.includes('SENTINEL_DB_URL'), false);
});
