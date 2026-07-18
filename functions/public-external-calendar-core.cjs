const MAX_PUBLIC_EXTERNAL_CALENDAR_EVENTS = 500;
const MAX_PUBLIC_EXTERNAL_CALENDAR_ICS_LENGTH = 512_000;
const MAX_PUBLIC_EXTERNAL_CALENDAR_PROPERTY_LENGTH = 4_096;

const PUBLIC_EVENT_PROPERTIES = new Set([
  'UID',
  'DTSTART',
  'DTEND',
  'RECURRENCE-ID',
  'SUMMARY',
  'LOCATION',
  'STATUS',
  'RRULE',
  'EXDATE'
]);

const DATE_EVENT_PROPERTIES = new Set([
  'DTSTART',
  'DTEND',
  'RECURRENCE-ID',
  'EXDATE'
]);

function unfoldIcsLines(icsText) {
  const unfolded = [];
  for (const rawLine of String(icsText || '').split(/\r\n|\n|\r/)) {
    if (/^[ \t]/.test(rawLine) && unfolded.length) {
      unfolded[unfolded.length - 1] += rawLine.slice(1);
      continue;
    }
    unfolded.push(rawLine);
  }
  return unfolded;
}

function sanitizeDatePropertyDescriptor(descriptor, propertyName) {
  const parameters = descriptor.split(';').slice(1);
  const safeParameters = [];

  for (const parameter of parameters) {
    const separatorIndex = parameter.indexOf('=');
    if (separatorIndex <= 0) continue;
    const name = parameter.slice(0, separatorIndex).trim().toUpperCase();
    const value = parameter.slice(separatorIndex + 1).trim();
    if (name === 'VALUE' && /^(?:DATE|DATE-TIME)$/i.test(value)) {
      safeParameters.push(`VALUE=${value.toUpperCase()}`);
    }
    if (name === 'TZID' && /^[A-Za-z0-9_+./-]{1,100}$/.test(value)) {
      safeParameters.push(`TZID=${value}`);
    }
  }

  return [propertyName, ...safeParameters].join(';');
}

function findIcsValueSeparator(line) {
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"' && line[index - 1] !== '\\') {
      inQuotes = !inQuotes;
      continue;
    }
    if (line[index] === ':' && !inQuotes) return index;
  }
  return -1;
}

function sanitizeEventPropertyLine(rawLine) {
  const colonIndex = findIcsValueSeparator(rawLine);
  if (colonIndex <= 0) return null;

  const descriptor = rawLine.slice(0, colonIndex).trim();
  const propertyName = descriptor.split(';')[0].trim().toUpperCase();
  if (!PUBLIC_EVENT_PROPERTIES.has(propertyName)) return null;

  const safeDescriptor = DATE_EVENT_PROPERTIES.has(propertyName)
    ? sanitizeDatePropertyDescriptor(descriptor, propertyName)
    : propertyName;
  const value = rawLine
    .slice(colonIndex + 1)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, MAX_PUBLIC_EXTERNAL_CALENDAR_PROPERTY_LENGTH);
  return `${safeDescriptor}:${value}`;
}

function sanitizePublicExternalCalendarIcs(icsText) {
  const sanitizedEvents = [];
  let currentEvent = null;
  let eventCount = 0;

  for (const rawLine of unfoldIcsLines(icsText)) {
    const normalizedLine = rawLine.trim();
    if (normalizedLine === 'BEGIN:VEVENT') {
      currentEvent = [];
      continue;
    }
    if (normalizedLine === 'END:VEVENT') {
      if (currentEvent && currentEvent.length && eventCount < MAX_PUBLIC_EXTERNAL_CALENDAR_EVENTS) {
        sanitizedEvents.push(['BEGIN:VEVENT', ...currentEvent, 'END:VEVENT']);
        eventCount += 1;
        if (eventCount >= MAX_PUBLIC_EXTERNAL_CALENDAR_EVENTS) break;
      }
      currentEvent = null;
      continue;
    }
    if (!currentEvent) continue;
    const safeLine = sanitizeEventPropertyLine(normalizedLine);
    if (safeLine) currentEvent.push(safeLine);
  }

  if (!eventCount) return '';
  const output = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ALL PLAYS//Public External Schedule//EN'
  ];
  let outputLength = output.join('\r\n').length;
  const calendarEndLength = '\r\nEND:VCALENDAR'.length;
  for (const eventLines of sanitizedEvents) {
    const eventLength = `\r\n${eventLines.join('\r\n')}`.length;
    if (outputLength + eventLength + calendarEndLength > MAX_PUBLIC_EXTERNAL_CALENDAR_ICS_LENGTH) break;
    output.push(...eventLines);
    outputLength += eventLength;
  }
  if (output.length === 3) return '';
  output.push('END:VCALENDAR');
  return output.join('\r\n');
}

module.exports = {
  MAX_PUBLIC_EXTERNAL_CALENDAR_EVENTS,
  MAX_PUBLIC_EXTERNAL_CALENDAR_ICS_LENGTH,
  sanitizePublicExternalCalendarIcs
};
