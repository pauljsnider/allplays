const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MAX_FAMILY_SHARE_CALENDAR_URLS,
  MAX_FAMILY_SHARE_DB_EVENTS,
  buildExternalCalendarEvents,
  getFamilyShareCalendarDedupTimestamps,
  hashFamilyShareCalendarEventUid,
  parseBoundedIcsEvents,
  sanitizeFamilyShareViewResponse
} = require('../family-share-view-core.cjs');

test('scopes team calendar timestamp de-duplication without weakening token-level de-duplication', () => {
  const teams = [
    { teamId: 'team-a', games: [{ date: '2026-07-20T18:00:00.000Z' }] },
    { teamId: 'team-b', games: [{ date: '2026-07-20T19:00:00.000Z' }] }
  ];

  assert.deepEqual(getFamilyShareCalendarDedupTimestamps(teams, 'team-a'), [Date.parse('2026-07-20T18:00:00.000Z')]);
  assert.deepEqual(getFamilyShareCalendarDedupTimestamps(teams, 'team-b'), [Date.parse('2026-07-20T19:00:00.000Z')]);
  assert.deepEqual(getFamilyShareCalendarDedupTimestamps(teams), [
    Date.parse('2026-07-20T18:00:00.000Z'),
    Date.parse('2026-07-20T19:00:00.000Z')
  ]);
});

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
  assert.equal(payload.includes('calendarUidHash'), false);
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

test('caps recurrence allocation across the feed and keeps raw UIDs private', () => {
  const rows = ['BEGIN:VCALENDAR'];
  for (let index = 0; index < 200; index += 1) {
    rows.push(
      'BEGIN:VEVENT',
      `UID:SENTINEL_UID_EMAIL_${index}@private.example.test`,
      `DTSTART:202607${String((index % 9) + 10).padStart(2, '0')}T180000Z`,
      'RRULE:FREQ=DAILY;COUNT=366',
      `SUMMARY:Practice ${index}`,
      'END:VEVENT'
    );
  }
  rows.push('END:VCALENDAR');

  const events = buildExternalCalendarEvents(rows.join('\r\n'), { sourceId: 'safe-source' });
  const payload = JSON.stringify(events);

  assert.equal(events.length, 400);
  assert.equal(payload.includes('SENTINEL_UID_EMAIL'), false);
  assert.equal(payload.includes('@private.example.test'), false);
  assert.ok(events.every((event) => /^[a-f0-9]{32}$/.test(event.id)));
  assert.ok(events.every((event) => /^[a-f0-9]{32}$/.test(event.eventKey)));
  assert.notEqual(
    events[0].id,
    hashFamilyShareCalendarEventUid('SENTINEL_UID_EMAIL_0@private.example.test')
  );
});

test('bounds child references copied onto every external event', () => {
  const events = buildExternalCalendarEvents([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:bounded-child-fanout',
    'DTSTART:20260720T180000Z',
    'RRULE:FREQ=DAILY;COUNT=400',
    'SUMMARY:Practice',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n'), {
    sourceId: 'bounded-child-source',
    children: Array.from({ length: 75 }, (_, index) => ({
      playerId: `player-${index}-${'x'.repeat(150)}`,
      playerName: `Player ${index} ${'y'.repeat(180)}`
    }))
  });

  assert.equal(events.length, 366);
  assert.ok(events.every((event) => event.childIds.length === 50));
  assert.ok(events.every((event) => event.childNames.length === 50));
  assert.ok(events.every((event) => event.childIds.every((value) => value.length <= 128)));
  assert.ok(events.every((event) => event.childNames.every((value) => value.length <= 160)));
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
        calendarEventUid: 'SENTINEL_DB_CALENDAR_UID@private.example.test',
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
  assert.equal(payload.includes('SENTINEL_DB_CALENDAR_UID'), false);
  assert.equal(Object.hasOwn(response.teams[0].games[0], 'calendarEventUid'), false);
});
