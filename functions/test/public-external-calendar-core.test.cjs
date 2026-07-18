const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_PUBLIC_EXTERNAL_CALENDAR_EVENTS,
  MAX_PUBLIC_EXTERNAL_CALENDAR_ICS_LENGTH,
  sanitizePublicExternalCalendarIcs
} = require('../public-external-calendar-core.cjs');

test('public external calendar projection keeps schedule fields and strips private metadata', () => {
  const sanitized = sanitizePublicExternalCalendarIcs([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:event-1',
    'DTSTART;TZID=America/Chicago:20260720T180000',
    'DTEND;TZID=America/Chicago:20260720T193000',
    'SUMMARY:Falcons vs Tigers',
    'LOCATION:Main Field',
    'STATUS:CONFIRMED',
    'RRULE:FREQ=WEEKLY;COUNT=2',
    'EXDATE;TZID=America/Chicago:20260727T180000',
    'DESCRIPTION:Parent phone 555-0100',
    'ATTENDEE;CN=Private Parent:mailto:parent@example.test',
    'ORGANIZER:mailto:coach@example.test',
    'URL:https://calendar.example.test/private-token',
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n'));

  assert.match(sanitized, /UID:event-1/);
  assert.match(sanitized, /DTSTART;TZID=America\/Chicago:20260720T180000/);
  assert.match(sanitized, /SUMMARY:Falcons vs Tigers/);
  assert.match(sanitized, /LOCATION:Main Field/);
  assert.match(sanitized, /RRULE:FREQ=WEEKLY;COUNT=2/);
  assert.doesNotMatch(sanitized, /DESCRIPTION|ATTENDEE|ORGANIZER|private-token|VALARM|TRIGGER/);
  assert.ok(sanitized.endsWith('END:VCALENDAR'));
});

test('public external calendar projection unfolds public values and sanitizes property parameters', () => {
  const sanitized = sanitizePublicExternalCalendarIcs([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID;ALTREP="https://private.example.test":event-2',
    'DTSTART;TZID=America/Chicago;ALTREP="https://private.example.test":20260721T180000',
    'SUMMARY:Falcons vs',
    ' Tigers',
    'LOCATION;ALTREP="https://private.example.test":Field 2',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\n'));

  assert.match(sanitized, /UID:event-2/);
  assert.match(sanitized, /DTSTART;TZID=America\/Chicago:20260721T180000/);
  assert.match(sanitized, /SUMMARY:Falcons vsTigers/);
  assert.match(sanitized, /LOCATION:Field 2/);
  assert.doesNotMatch(sanitized, /ALTREP|private\.example\.test/);
});

test('public external calendar projection is event-count and payload bounded', () => {
  const events = Array.from({ length: MAX_PUBLIC_EXTERNAL_CALENDAR_EVENTS + 25 }, (_, index) => [
    'BEGIN:VEVENT',
    `UID:event-${index}`,
    `DTSTART:202607${String((index % 28) + 1).padStart(2, '0')}T180000Z`,
    `SUMMARY:${'A'.repeat(5000)}`,
    'END:VEVENT'
  ].join('\r\n'));
  const sanitized = sanitizePublicExternalCalendarIcs([
    'BEGIN:VCALENDAR',
    ...events,
    'END:VCALENDAR'
  ].join('\r\n'));

  assert.ok(sanitized.length <= MAX_PUBLIC_EXTERNAL_CALENDAR_ICS_LENGTH);
  assert.ok(sanitized.endsWith('END:VCALENDAR'));
  assert.ok((sanitized.match(/BEGIN:VEVENT/g) || []).length <= MAX_PUBLIC_EXTERNAL_CALENDAR_EVENTS);
  const summaries = sanitized.split('\r\n').filter((line) => line.startsWith('SUMMARY:'));
  assert.ok(summaries.every((line) => line.length <= 'SUMMARY:'.length + 4_096));
});

test('public external calendar projection omits invalid or empty payloads', () => {
  assert.equal(sanitizePublicExternalCalendarIcs('not a calendar'), '');
  assert.equal(sanitizePublicExternalCalendarIcs('BEGIN:VCALENDAR\nEND:VCALENDAR'), '');
});
