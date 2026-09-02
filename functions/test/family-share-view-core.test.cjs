const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  MAX_FAMILY_SHARE_CALENDAR_URLS,
  MAX_FAMILY_SHARE_DB_EVENTS,
  buildExternalCalendarEvents,
  getFamilyShareCalendarDedupTimestamps,
  hashFamilyShareCalendarEventUid,
  isFamilyShareCalendarEventTracked,
  parseBoundedIcsEvents,
  sanitizeFamilyShareViewResponse
} = require('../family-share-view-core.cjs');

test('correlates projected events with legacy UID and current opaque occurrence tracking IDs', () => {
  const startsAt = '2026-08-01T18:00:00.000Z';
  const event = {
    id: 'opaque-projected-id',
    date: startsAt,
    calendarUidHash: hashFamilyShareCalendarEventUid('raw-calendar-uid')
  };
  for (const trackedId of [
    'raw-calendar-uid',
    `raw-calendar-uid__${startsAt}`,
    'opaque-projected-id',
    `opaque-projected-id__${startsAt}`
  ]) {
    assert.equal(isFamilyShareCalendarEventTracked(event, [trackedId]), true, trackedId);
  }
  assert.equal(isFamilyShareCalendarEventTracked(event, [{
    calendarEventUid: 'raw-calendar-uid',
    date: startsAt
  }]), true);
  assert.equal(isFamilyShareCalendarEventTracked(event, [{
    calendarEventUid: 'raw-calendar-uid',
    date: '2026-08-08T18:00:00.000Z'
  }]), false);
  for (const trackedId of [
    `raw-calendar-uid__${startsAt}`,
    `opaque-projected-id__${startsAt}`
  ]) {
    assert.equal(isFamilyShareCalendarEventTracked(event, [{
      calendarEventUid: trackedId,
      date: '2026-08-08T18:00:00.000Z'
    }]), true, `stable occurrence survives edited game date: ${trackedId}`);
  }
  assert.equal(isFamilyShareCalendarEventTracked(event, ['different-event']), false);
});

test('preserves UID-backed public IDs and event keys across rollout', () => {
  const buildEvent = ({ uid = 'stable-provider-uid', summary }) => buildExternalCalendarEvents([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    ...(uid ? [`UID:${uid}`] : []),
    'DTSTART:20260801T180000Z',
    'DTEND:20260801T200000Z',
    `SUMMARY:${summary}`,
    'LOCATION:Public Field',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n'), { sourceId: 'stable-source-id', teamName: 'Bears' })[0];

  const original = buildEvent({ summary: 'Bears vs. Hawks' });
  const edited = buildEvent({ summary: 'Bears vs. Falcons' });
  const originalStartsAt = '2026-08-01T18:00:00.000Z';
  const priorOpaqueId = crypto.createHash('sha256')
    .update(`family-share:calendar-event-public-id:v1:stable-source-id:stable-provider-uid:${originalStartsAt}:Bears vs. Hawks`)
    .digest('hex')
    .slice(0, 32);
  const priorEventKey = crypto.createHash('sha256')
    .update(`family-share:calendar-event-instance:v1:stable-source-id:stable-provider-uid:${originalStartsAt}:Bears vs. Hawks`)
    .digest('hex')
    .slice(0, 32);
  assert.equal(original.id, priorOpaqueId);
  assert.equal(original.eventKey, priorEventKey);
  assert.equal(Object.hasOwn(original, 'legacyOpaqueId'), false);
  assert.equal(
    `/app/#/schedule/team-1/${original.id}`,
    `/app/#/schedule/team-1/${priorOpaqueId}`
  );
  assert.notEqual(edited.id, original.id);
  assert.notEqual(edited.eventKey, original.eventKey);
  assert.notEqual(edited.opponent, original.opponent);
  const priorTrackedOccurrence = {
    calendarEventUid: `${original.id}__${originalStartsAt}`,
    type: 'game',
    location: 'public field'
  };
  assert.equal(isFamilyShareCalendarEventTracked(edited, [priorTrackedOccurrence]), true);
  assert.equal(isFamilyShareCalendarEventTracked(original, [{
    calendarEventUid: `${priorOpaqueId}__${originalStartsAt}`,
    date: '2026-08-08T18:00:00.000Z',
    type: 'game',
    location: 'Public Field'
  }]), true);
  // The old hash is irreversible after a title edit, but its exact embedded
  // occurrence time plus stable location remains a narrow compatibility signal.
  assert.equal(isFamilyShareCalendarEventTracked(edited, [{
    calendarEventUid: `${priorOpaqueId}__${originalStartsAt}`,
    type: 'game',
    location: 'PUBLIC FIELD'
  }]), true);
  const differentStartsAt = '2026-08-01T19:00:00.000Z';
  assert.equal(isFamilyShareCalendarEventTracked(edited, [
    `${priorOpaqueId}__${differentStartsAt}`
  ]), false);
  assert.equal(isFamilyShareCalendarEventTracked(edited, [
    `stable-provider-uid__${differentStartsAt}`
  ]), false);

  const uidMissingOriginal = buildEvent({ uid: '', summary: 'Bears vs. Hawks' });
  const uidMissingOther = buildEvent({ uid: '', summary: 'Bears vs. Falcons' });
  assert.notEqual(uidMissingOther.id, uidMissingOriginal.id);
  assert.notEqual(uidMissingOther.eventKey, uidMissingOriginal.eventKey);
});

test('does not correlate distinct same-time opaque events without a matching shape', () => {
  const startsAt = '2026-08-01T18:00:00.000Z';
  const event = {
    id: 'new-opaque-event-id',
    type: 'game',
    startsAt,
    location: 'Field 3',
    opponent: 'Tigers',
    calendarUidHash: hashFamilyShareCalendarEventUid('different-raw-uid')
  };
  assert.equal(isFamilyShareCalendarEventTracked(event, [{
    calendarEventUid: `7bca28b6105ee23830c3517602e276d3__${startsAt}`,
    type: 'game',
    location: 'Field 2',
    opponent: 'Hawks'
  }]), false);
  assert.equal(isFamilyShareCalendarEventTracked({
    ...event,
    location: 'TBD',
    opponent: 'unknown'
  }, [{
    calendarEventUid: `7bca28b6105ee23830c3517602e276d3__${startsAt}`,
    type: 'game',
    location: 'unknown',
    opponent: 'TBD'
  }]), false);
});

test('does not treat a generic practice title as a same-time discriminator', () => {
  const startsAt = '2026-08-01T18:00:00.000Z';
  assert.equal(isFamilyShareCalendarEventTracked({
    id: 'new-opaque-practice-id',
    type: 'practice',
    startsAt,
    location: 'Field 3',
    title: 'Practice',
    calendarUidHash: hashFamilyShareCalendarEventUid('different-raw-uid')
  }, [{
    calendarEventUid: `7bca28b6105ee23830c3517602e276d3__${startsAt}`,
    type: 'practice',
    location: 'Field 2',
    title: 'Practice'
  }]), false);
});

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
    'LOCATION:Blue Valley Recreation Sports Complex',
    'DESCRIPTION:Field 14',
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
  assert.ok(events.every((event) => event.locationDetail === 'Field 14'));
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
  assert.equal(response.externalEvents[0].eventKey, events[0].eventKey);
  assert.equal(response.externalEvents[0].locationDetail, 'Field 14');
  assert.equal(response.presentation.label, 'Grandma');
});

test('does not promote ordinary calendar notes into location details', () => {
  const events = buildExternalCalendarEvents([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:note-only',
    'DTSTART:20260720T180000Z',
    'SUMMARY:Practice',
    'LOCATION:Blue Valley Recreation Sports Complex',
    'DESCRIPTION:Bring turf shoes for the field\\nUse the gym entrance',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:field-label',
    'DTSTART:20260721T180000Z',
    'SUMMARY:Practice',
    'LOCATION:Blue Valley Recreation Sports Complex',
    `DESCRIPTION:${'A'.repeat(260)}\\nCourt #2\\nBring water`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n'), { sourceId: 'opaque-source-id' });

  assert.equal(events.find((event) => event.calendarUidHash === hashFamilyShareCalendarEventUid('note-only'))?.locationDetail, null);
  assert.equal(events.find((event) => event.calendarUidHash === hashFamilyShareCalendarEventUid('field-label'))?.locationDetail, 'Court #2');
});

test('keeps named and directional calendar fields in server-side Family Share parsing', () => {
  const descriptions = [
    ['named-field', 'Scheels field 7 NE', 'Scheels field 7 NE'],
    ['named-field-south', 'Blue Valley field #02 south', 'Blue Valley field #02 south'],
    ['capitalized-named-field', 'Scheels Field 7 NE', 'Scheels Field 7 NE'],
    ['capitalized-named-court', 'Blue Valley Court #02 south', 'Blue Valley Court #02 south'],
    ['ambiguous-named-field', 'Scheels field 7', null],
    ['directional-field', 'Field 7 NE', 'Field 7 NE'],
    ['directional-court', 'Court 2 South', 'Court 2 South'],
    ['title-case-note', 'Practice Is On field 7', null],
    ['title-case-instruction', 'Meet At field 7', null],
    ['directional-title-case-instruction', 'Meet At field 7 NE', null],
    ['directional-sentence-instruction', 'Practice Is On field 7 south', null],
    ['directional-verb-instruction', 'Gate Opens field 7 NE', null],
    ['coach-note', 'Coach Says Field 7', null],
    ['warmup-note', 'Warm Up Field 7', null],
    ['gate-note', 'Gate Opens Field 7', null],
    ['play-note', 'We Play Field 7', null]
  ];
  const icsLines = ['BEGIN:VCALENDAR'];
  descriptions.forEach(([uid, description], index) => {
    icsLines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTART:202607${String(index + 20).padStart(2, '0')}T180000Z`,
      'SUMMARY:Practice',
      'LOCATION:Blue Valley Recreation Sports Complex',
      `DESCRIPTION:${description}`,
      'END:VEVENT'
    );
  });
  icsLines.push('END:VCALENDAR');

  const events = buildExternalCalendarEvents(icsLines.join('\r\n'), { sourceId: 'safe-hash' });
  for (const [uid, , expected] of descriptions) {
    const event = events.find((candidate) =>
      candidate.calendarUidHash === hashFamilyShareCalendarEventUid(uid)
    );
    assert.equal(event?.locationDetail ?? null, expected);
  }
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

test('projects normalized lifecycle and derived replay evidence without replay details', () => {
  const replayUrl = 'https://www.youtube.com/watch?v=SENTINEL_REPLAY_VIDEO';
  const response = sanitizeFamilyShareViewResponse({
    token: { label: 'Family' },
    teams: [{
      teamId: 'team-1',
      teamName: 'Bears',
      games: [
        {
          id: 'canonical-replay',
          status: 'completed',
          liveStatus: '  SCHEDULED  ',
          hasReplayVideo: true,
          canOpenPublicViewer: true,
          replayVideo: {
            provider: 'SENTINEL_REPLAY_PROVIDER',
            videoId: 'SENTINEL_REPLAY_VIDEO',
            publicUrl: replayUrl,
            linkedBy: 'SENTINEL_REPLAY_LINKER',
            linkedAt: '2026-07-20T19:00:00.000Z'
          }
        },
        {
          id: 'contradictory-live',
          status: 'completed',
          liveStatus: ' LIVE ',
          hasReplayVideo: false,
          canOpenPublicViewer: true,
          replayVideoUrl: replayUrl
        },
        {
          id: 'reverse-lifecycle',
          status: 'scheduled',
          liveStatus: 'COMPLETED',
          hasReplayVideo: false,
          canOpenPublicViewer: true,
          recordedVideo: { embedUrl: replayUrl }
        },
        {
          id: 'metadata-only',
          status: 'completed',
          liveStatus: ` CANCELED-${'X'.repeat(80)} `,
          replayVideo: { provider: 'youtube', videoId: 'metadata-is-not-a-source' }
        },
        {
          id: 'server-derived-signal',
          status: 'completed',
          liveStatus: 'FINAL',
          hasReplayVideo: true,
          canOpenPublicViewer: true
        }
      ]
    }]
  });

  const games = response.teams[0].games;
  assert.deepEqual(games.map(({ id, liveStatus, hasReplayVideo, canOpenPublicViewer }) => ({ id, liveStatus, hasReplayVideo, canOpenPublicViewer })), [
    { id: 'canonical-replay', liveStatus: 'scheduled', hasReplayVideo: true, canOpenPublicViewer: true },
    { id: 'contradictory-live', liveStatus: 'live', hasReplayVideo: false, canOpenPublicViewer: true },
    { id: 'reverse-lifecycle', liveStatus: 'completed', hasReplayVideo: false, canOpenPublicViewer: true },
    { id: 'metadata-only', liveStatus: `canceled-${'x'.repeat(23)}`, hasReplayVideo: false, canOpenPublicViewer: false },
    { id: 'server-derived-signal', liveStatus: 'final', hasReplayVideo: true, canOpenPublicViewer: true }
  ]);
  assert.equal(games[3].liveStatus.length, 32);

  const payload = JSON.stringify(response);
  assert.equal(payload.includes('SENTINEL_REPLAY_VIDEO'), false);
  assert.equal(payload.includes('SENTINEL_REPLAY_PROVIDER'), false);
  assert.equal(payload.includes('SENTINEL_REPLAY_LINKER'), false);
  for (const privateField of [
    'replayVideo',
    'replayVideoUrl',
    'recordedVideo',
    'provider',
    'videoId',
    'linkedBy',
    'linkedAt'
  ]) {
    assert.equal(Object.hasOwn(games[0], privateField), false);
  }
});

test('preserves bounded shared-game route identities longer than a document ID', () => {
  const sharedPath = `organizations/${'o'.repeat(128)}/sharedGames/${'g'.repeat(128)}`;
  const syntheticId = `shared_${encodeURIComponent(sharedPath)}`;
  assert.ok(syntheticId.length > 256);
  const response = sanitizeFamilyShareViewResponse({
    token: { label: 'Family' },
    teams: [{
      teamId: 'team-1',
      games: [{
        id: syntheticId,
        gameId: syntheticId,
        type: 'game',
        date: '2026-07-20T19:00:00.000Z',
        status: 'completed',
        liveStatus: 'final',
        isSharedGame: true,
        canOpenPublicViewer: true
      }]
    }]
  });

  assert.equal(response.teams[0].games[0].id, syntheticId);
  assert.equal(response.teams[0].games[0].gameId, syntheticId);
});
