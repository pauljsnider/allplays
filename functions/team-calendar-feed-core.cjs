const crypto = require('node:crypto');

const FEED_PRODUCT_ID = '-//ALL PLAYS//Team Calendar//EN';
const DEFAULT_EVENT_DURATION_MS = 60 * 60 * 1000;

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
  escapeIcsText,
  formatIcsDate,
  formatRsvpSummary,
  hashCalendarToken,
  isCancelledEvent,
  isVisibleCalendarEvent,
  normalizeCalendarRequest,
  toDate
};
