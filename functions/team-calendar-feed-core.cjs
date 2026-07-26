const crypto = require('node:crypto');
const {
  getCalendarFeedDateWindow
} = require('./calendar-feed-window-core.cjs');

const FEED_PRODUCT_ID = '-//ALL PLAYS//Team Calendar//EN';
const DEFAULT_EVENT_DURATION_MS = 60 * 60 * 1000;
const DEFAULT_RECURRENCE_TIME_ZONE = 'America/Chicago';
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
const RECURRENCE_DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function hashCalendarToken(token) {
  const normalized = String(token || '').trim();
  if (!normalized) return '';
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function normalizeCalendarRequest(query = {}) {
  const teamId = String(query.teamId || query.team || '').trim();
  const token = String(query.token || '').trim();
  return { teamId, token, tokenHash: hashCalendarToken(token) };
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.toMillis === 'function') return new Date(value.toMillis());
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatIcsDate(value) {
  const date = toDate(value);
  if (!date) return null;
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function escapeIcsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function foldIcsLine(line) {
  const text = String(line);
  if (Buffer.byteLength(text, 'utf8') <= 75) return text;

  const chunks = [];
  let current = '';
  for (const char of text) {
    if (Buffer.byteLength(current + char, 'utf8') > 75) {
      chunks.push(current);
      current = ` ${char}`;
    } else {
      current += char;
    }
  }
  if (current) chunks.push(current);
  return chunks.join('\r\n');
}

function normalizeEventType(event) {
  return event?.type === 'practice' || event?.eventType === 'practice' ? 'practice' : 'game';
}

function isCancelledEvent(event) {
  const status = String(event?.status || '').toLowerCase();
  return status === 'cancelled' || status === 'canceled';
}

function isVisibleCalendarEvent(event) {
  if (!event || event.deleted === true) return false;
  if (String(event.liveStatus || '').toLowerCase() === 'deleted') return false;
  return Boolean(toDate(event.date));
}

function getEventEndDate(event, startDate) {
  const explicitEnd = toDate(event.end || event.endDate || event.endsAt);
  if (explicitEnd && explicitEnd > startDate) return explicitEnd;

  const endTime = String(event.endTime || '').trim();
  if (/^\d{2}:\d{2}$/.test(endTime)) {
    const [hours, minutes] = endTime.split(':').map(Number);
    const endDate = new Date(startDate);
    endDate.setHours(hours, minutes, 0, 0);
    if (endDate > startDate) return endDate;
  }

  const durationMinutes = Number(event.durationMinutes || event.duration || 0);
  if (Number.isFinite(durationMinutes) && durationMinutes > 0) {
    return new Date(startDate.getTime() + durationMinutes * 60 * 1000);
  }

  return new Date(startDate.getTime() + DEFAULT_EVENT_DURATION_MS);
}

function getEventSummary(event, teamName) {
  if (normalizeEventType(event) === 'practice') {
    return event.title || `${teamName} Practice`;
  }
  return event.title || `${teamName} vs ${event.opponent || event.opponentTeamName || 'TBD'}`;
}

function formatRsvpSummary(summary) {
  if (!summary || typeof summary !== 'object') return '';
  const labels = [
    ['going', 'going'],
    ['maybe', 'maybe'],
    ['notGoing', 'not going'],
    ['notResponded', 'not responded']
  ];
  return labels
    .map(([key, label]) => Number.isFinite(Number(summary[key])) ? `${Number(summary[key])} ${label}` : '')
    .filter(Boolean)
    .join(', ');
}

function getEventDescription(event) {
  const parts = [];
  if (event.status) parts.push(`Status: ${event.status}`);
  const arrival = toDate(event.arrivalTime);
  const formattedArrival = formatIcsDate(arrival);
  if (formattedArrival) parts.push(`Arrival: ${formattedArrival}`);
  if (event.notes) parts.push(String(event.notes));

  const rsvpSummary = formatRsvpSummary(event.rsvpSummary);
  if (rsvpSummary) {
    parts.push(''); // Add a blank line for separation
    parts.push(`RSVPs: ${rsvpSummary}`);
  }

  if (Array.isArray(event.officiating) && event.officiating.length > 0) {
    parts.push(''); // Add a blank line for separation
    parts.push('Officiating:');
    event.officiating.forEach(official => {
      const name = official.name || 'Unknown';
      const role = official.role || 'Official';
      parts.push(`  - ${name}: ${role}`);
    });
  }

  return parts.join('\n');
}

function toUtcDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function getRecurrenceUtcOffsetMinutes(master) {
  const masterStart = toDate(master.date);
  const startTime = String(master.startTime || '').trim();
  if (!masterStart || !/^\d{2}:\d{2}$/.test(startTime)) return 0;

  const [localHours, localMinutes] = startTime.split(':').map(Number);
  const rawOffsetMinutes = (localHours * 60 + localMinutes) -
    (masterStart.getUTCHours() * 60 + masterStart.getUTCMinutes());
  const candidates = [rawOffsetMinutes, rawOffsetMinutes - 24 * 60, rawOffsetMinutes + 24 * 60]
    .filter((offset) => offset >= -12 * 60 && offset <= 14 * 60);
  const recurrenceDays = new Set(
    (Array.isArray(master.recurrence?.byDays) ? master.recurrence.byDays : [])
      .map((day) => String(day || '').toUpperCase())
      .filter((day) => RECURRENCE_DAY_CODES.includes(day))
  );
  const matchingDayOffset = recurrenceDays.size > 0
    ? candidates.find((offset) => {
      const localStart = new Date(masterStart.getTime() + offset * 60 * 1000);
      return recurrenceDays.has(RECURRENCE_DAY_CODES[localStart.getUTCDay()]);
    })
    : null;
  return matchingDayOffset ?? candidates[0] ?? 0;
}

function getWallClockParts(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return {
      year: Number(values.year),
      month: Number(values.month) - 1,
      day: Number(values.day),
      hour: Number(values.hour),
      minute: Number(values.minute),
      second: Number(values.second)
    };
  } catch (_) {
    return null;
  }
}

function parseWallClockTime(occurrenceDay, time, timeZone) {
  const [hour, minute] = time.split(':').map(Number);
  const targetMs = Date.UTC(
    occurrenceDay.getUTCFullYear(),
    occurrenceDay.getUTCMonth(),
    occurrenceDay.getUTCDate(),
    hour,
    minute
  );
  let resolvedMs = targetMs;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const observed = getWallClockParts(new Date(resolvedMs), timeZone);
    if (!observed) return null;
    const observedMs = Date.UTC(
      observed.year,
      observed.month,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second
    );
    const nextMs = resolvedMs + (targetMs - observedMs);
    if (nextMs === resolvedMs) return new Date(resolvedMs);
    resolvedMs = nextMs;
  }

  return null;
}

function getRecurrenceTimeZone(master, fallbackTimeZone = DEFAULT_RECURRENCE_TIME_ZONE) {
  const explicitTimeZone = String(master.timeZone || master.timezone || '').trim();
  if (explicitTimeZone) return explicitTimeZone;

  const fallback = String(fallbackTimeZone || '').trim();
  return fallback && getWallClockParts(new Date(0), fallback) ? fallback : '';
}

function buildRecurringOccurrence(
  master,
  occurrenceDay,
  dateKey,
  override = {},
  utcOffsetMinutes = 0,
  timeZone = ''
) {
  const startDate = new Date(occurrenceDay);
  const startTime = String(override.startTime || master.startTime || '').trim();
  if (/^\d{2}:\d{2}$/.test(startTime)) {
    const [hours, minutes] = startTime.split(':').map(Number);
    const zonedStart = timeZone ? parseWallClockTime(occurrenceDay, startTime, timeZone) : null;
    if (zonedStart) {
      startDate.setTime(zonedStart.getTime());
    } else {
      startDate.setTime(Date.UTC(
        occurrenceDay.getUTCFullYear(),
        occurrenceDay.getUTCMonth(),
        occurrenceDay.getUTCDate(),
        hours,
        minutes
      ) - utcOffsetMinutes * 60 * 1000);
    }
  } else {
    const masterStart = toDate(master.date);
    startDate.setUTCHours(
      masterStart.getUTCHours(),
      masterStart.getUTCMinutes(),
      masterStart.getUTCSeconds(),
      masterStart.getUTCMilliseconds()
    );
  }

  const occurrence = {
    ...master,
    ...override,
    id: `${master.id || master.gameId || master.eventId}__${dateKey}`,
    masterId: master.id || master.gameId || master.eventId,
    instanceDate: dateKey,
    isInstance: true,
    isSeriesMaster: false,
    date: startDate
  };

  const endTime = String(override.endTime || master.endTime || '').trim();
  if (/^\d{2}:\d{2}$/.test(endTime)) {
    const [hours, minutes] = endTime.split(':').map(Number);
    const endDate = new Date(occurrenceDay);
    const hasOverrideEndTime = Object.prototype.hasOwnProperty.call(override, 'endTime');
    const explicitDayOffset = Object.prototype.hasOwnProperty.call(override, 'endDayOffset')
      ? override.endDayOffset
      : (hasOverrideEndTime ? null : master.endDayOffset);
    const [startHours, startMinutes] = startTime.split(':').map(Number);
    const inferredDayOffset = hours * 60 + minutes <= startHours * 60 + startMinutes ? 1 : 0;
    const endDayOffset = explicitDayOffset == null
      ? inferredDayOffset
      : Math.max(0, Number(explicitDayOffset) || 0);
    endDate.setUTCDate(endDate.getUTCDate() + endDayOffset);
    const zonedEnd = timeZone ? parseWallClockTime(endDate, endTime, timeZone) : null;
    if (zonedEnd) {
      endDate.setTime(zonedEnd.getTime());
    } else {
      endDate.setTime(Date.UTC(
        endDate.getUTCFullYear(),
        endDate.getUTCMonth(),
        endDate.getUTCDate(),
        hours,
        minutes
      ) - utcOffsetMinutes * 60 * 1000);
    }
    occurrence.end = endDate;
  } else {
    const masterStart = toDate(master.date);
    const masterEnd = toDate(master.end || master.endDate || master.endsAt);
    if (masterStart && masterEnd && masterEnd > masterStart) {
      occurrence.end = new Date(startDate.getTime() + (masterEnd.getTime() - masterStart.getTime()));
    }
  }

  return occurrence;
}

function expandRecurringCalendarEvent(master, {
  now = new Date(),
  fallbackTimeZone = DEFAULT_RECURRENCE_TIME_ZONE
} = {}) {
  if (master?.type !== 'practice' || master?.isSeriesMaster !== true || !master?.recurrence) {
    return [master];
  }

  const seriesStart = toDate(master.date);
  if (!seriesStart) return [];

  const { start: windowStart, end: windowEnd } = getCalendarFeedDateWindow(now);
  const recurrence = master.recurrence || {};
  const frequency = String(recurrence.freq || '').toLowerCase();
  if (!['daily', 'weekly'].includes(frequency)) return [];

  const interval = Math.max(1, Number.parseInt(recurrence.interval, 10) || 1);
  const count = Math.max(0, Number.parseInt(recurrence.count, 10) || 0);
  const until = toDate(recurrence.until || recurrence.endDate || recurrence.untilDate);
  const untilEnd = until
    ? new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate(), 23, 59, 59, 999))
    : null;
  const byDays = new Set(
    (Array.isArray(recurrence.byDays) ? recurrence.byDays : [])
      .map((day) => String(day || '').toUpperCase())
      .filter((day) => RECURRENCE_DAY_CODES.includes(day))
  );
  const excludedDates = new Set(Array.isArray(master.exDates) ? master.exDates : []);
  const overrides = master.overrides && typeof master.overrides === 'object' && !Array.isArray(master.overrides)
    ? master.overrides
    : {};
  const utcOffsetMinutes = getRecurrenceUtcOffsetMinutes(master);
  const timeZone = getRecurrenceTimeZone(master, fallbackTimeZone);
  const zonedSeriesStart = timeZone ? getWallClockParts(seriesStart, timeZone) : null;
  const localSeriesStart = zonedSeriesStart
    ? new Date(Date.UTC(zonedSeriesStart.year, zonedSeriesStart.month, zonedSeriesStart.day))
    : new Date(seriesStart.getTime() + utcOffsetMinutes * 60 * 1000);
  const startDay = new Date(Date.UTC(
    localSeriesStart.getUTCFullYear(),
    localSeriesStart.getUTCMonth(),
    localSeriesStart.getUTCDate()
  ));
  const startDayNumber = Math.floor(startDay.getTime() / MILLIS_PER_DAY);
  const startWeekNumber = Math.floor((startDayNumber - startDay.getUTCDay()) / 7);
  const lastDay = new Date(Math.min(windowEnd.getTime(), untilEnd?.getTime() || windowEnd.getTime()));
  const occurrences = [];
  let generated = 0;

  for (let current = new Date(startDay); current <= lastDay; current.setUTCDate(current.getUTCDate() + 1)) {
    const currentDayNumber = Math.floor(current.getTime() / MILLIS_PER_DAY);
    const daysSinceStart = currentDayNumber - startDayNumber;
    const currentWeekNumber = Math.floor((currentDayNumber - current.getUTCDay()) / 7);
    const weeksSinceStart = currentWeekNumber - startWeekNumber;
    const dayCode = RECURRENCE_DAY_CODES[current.getUTCDay()];
    const matches = frequency === 'daily'
      ? daysSinceStart >= 0 && daysSinceStart % interval === 0
      : daysSinceStart >= 0 &&
        weeksSinceStart >= 0 &&
        weeksSinceStart % interval === 0 &&
        (byDays.size > 0 ? byDays.has(dayCode) : current.getUTCDay() === startDay.getUTCDay());

    if (!matches) continue;
    generated += 1;
    if (count && generated > count) break;
    if (current < windowStart) continue;

    const dateKey = toUtcDateKey(current);
    const occurrence = buildRecurringOccurrence(
      master,
      current,
      dateKey,
      overrides[dateKey] || {},
      utcOffsetMinutes,
      timeZone
    );
    if (excludedDates.has(dateKey)) {
      occurrence.status = 'cancelled';
    }
    occurrences.push(occurrence);
  }

  return occurrences;
}

function buildTeamCalendarIcs({ teamId, team = {}, events = [], now = new Date() }) {
  const teamName = team.name || 'Team';
  const dtstamp = formatIcsDate(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${FEED_PRODUCT_ID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(`${teamName} Schedule`)}`
  ];

  events
    .flatMap((event) => expandRecurringCalendarEvent(event, {
      now,
      fallbackTimeZone: team.timeZone || team.timezone || DEFAULT_RECURRENCE_TIME_ZONE
    }))
    .filter(isVisibleCalendarEvent)
    .sort((a, b) => toDate(a.date) - toDate(b.date))
    .forEach((event) => {
      const eventId = event.id || event.gameId || event.eventId;
      if (!eventId) return;

      const startDate = toDate(event.date);
      const start = formatIcsDate(startDate);
      const end = formatIcsDate(getEventEndDate(event, startDate));
      const summary = getEventSummary(event, teamName);
      const description = getEventDescription(event);
      const updatedAt = formatIcsDate(event.updatedAt || event.modifiedAt || event.createdAt || now) || dtstamp;
      const uidTeam = String(teamId || event.teamId || 'team').replace(/[^a-zA-Z0-9_-]/g, '-');
      const uidEvent = String(eventId).replace(/[^a-zA-Z0-9_-]/g, '-');

      lines.push(
        'BEGIN:VEVENT',
        `UID:${uidTeam}-${uidEvent}@allplays.ai`,
        `DTSTAMP:${dtstamp}`,
        `LAST-MODIFIED:${updatedAt}`,
        `DTSTART:${start}`,
        `DTEND:${end}`,
        `SUMMARY:${escapeIcsText(summary)}`,
        `LOCATION:${escapeIcsText(event.location || '')}`,
        `DESCRIPTION:${escapeIcsText(description)}`,
        `STATUS:${isCancelledEvent(event) ? 'CANCELLED' : 'CONFIRMED'}`,
        'END:VEVENT'
      );
    });

  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n');
}

module.exports = {
  buildTeamCalendarIcs,
  expandRecurringCalendarEvent,
  escapeIcsText,
  formatIcsDate,
  formatRsvpSummary,
  hashCalendarToken,
  isCancelledEvent,
  isVisibleCalendarEvent,
  normalizeCalendarRequest,
  toDate
};
