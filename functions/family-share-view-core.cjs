const crypto = require('node:crypto');

const MAX_FAMILY_SHARE_CALENDAR_URLS = 8;
const MAX_FAMILY_SHARE_EVENTS = 500;
const MAX_FAMILY_SHARE_ICS_EVENTS = 400;
const MAX_FAMILY_SHARE_RECURRENCES = 366;
const MAX_FAMILY_SHARE_CHILDREN = 50;
const MAX_FAMILY_SHARE_TEAMS = 20;
const MAX_FAMILY_SHARE_DB_EVENTS = 500;

function compactText(value, maxLength = 240) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
}

function toIso(value) {
  if (!value) return null;
  const candidate = typeof value.toDate === 'function' ? value.toDate() : value;
  const date = candidate instanceof Date ? candidate : new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function unescapeIcsText(value) {
  return compactText(String(value || '')
    .replace(/\\[nN]/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\'));
}

function unfoldIcsLines(icsText) {
  const unfolded = [];
  for (const rawLine of String(icsText || '').split(/\r\n|\n|\r/)) {
    if (/^[ \t]/.test(rawLine) && unfolded.length) {
      unfolded[unfolded.length - 1] += rawLine.slice(1);
    } else {
      unfolded.push(rawLine);
    }
  }
  return unfolded;
}

function parseIcsWallParts(rawValue) {
  const value = compactText(rawValue, 64);
  let match = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) {
    return {
      year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]),
      hour: 0, minute: 0, second: 0, zone: ''
    };
  }
  match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z|[+-]\d{4})?$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, zone] = match;
  return {
    year: Number(year), month: Number(month) - 1, day: Number(day),
    hour: Number(hour), minute: Number(minute), second: Number(second), zone: zone || ''
  };
}

function getWallClockParts(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return {
      year: Number(values.year), month: Number(values.month) - 1, day: Number(values.day),
      hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second)
    };
  } catch (_) {
    return null;
  }
}

function parseWallClockInTimeZone(parts, timeZone) {
  const targetMs = Date.UTC(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second);
  let resolvedMs = targetMs;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const observed = getWallClockParts(new Date(resolvedMs), timeZone);
    if (!observed) return null;
    const observedMs = Date.UTC(observed.year, observed.month, observed.day, observed.hour, observed.minute, observed.second);
    const nextMs = resolvedMs + (targetMs - observedMs);
    if (nextMs === resolvedMs) {
      const roundTrip = getWallClockParts(new Date(resolvedMs), timeZone);
      if (roundTrip && ['year', 'month', 'day', 'hour', 'minute', 'second'].every((key) => roundTrip[key] === parts[key])) {
        return new Date(resolvedMs);
      }
      return null;
    }
    resolvedMs = nextMs;
  }
  return null;
}

function parseIcsDate(rawValue, timeZone = '') {
  const parts = parseIcsWallParts(rawValue);
  if (!parts) return null;
  let millis = Date.UTC(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second);
  const zone = parts.zone;
  if (zone && zone !== 'Z') {
    const direction = zone[0] === '+' ? 1 : -1;
    const offsetMinutes = Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3, 5));
    millis -= direction * offsetMinutes * 60_000;
  }
  if (!zone && timeZone) return parseWallClockInTimeZone(parts, timeZone);
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseRrule(value, timeZone = '') {
  const rule = {};
  compactText(value, 512).split(';').forEach((part) => {
    const [key, raw] = part.split('=', 2);
    if (!key || !raw) return;
    if (key === 'FREQ' && ['DAILY', 'WEEKLY'].includes(raw)) rule.freq = raw;
    if (key === 'INTERVAL') rule.interval = Math.max(1, Math.min(Number.parseInt(raw, 10) || 1, 366));
    if (key === 'COUNT') rule.count = Math.max(1, Math.min(Number.parseInt(raw, 10) || 1, MAX_FAMILY_SHARE_RECURRENCES));
    if (key === 'UNTIL') rule.until = parseIcsDate(raw, timeZone);
    if (key === 'BYDAY') rule.byDays = raw.split(',').filter((day) => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].includes(day));
  });
  return rule.freq ? rule : null;
}

function parseIcsField(field) {
  const parts = compactText(field, 512).split(';');
  const params = {};
  for (const part of parts.slice(1)) {
    const equals = part.indexOf('=');
    if (equals <= 0) continue;
    const key = part.slice(0, equals).toUpperCase();
    const value = part.slice(equals + 1).replace(/^"|"$/g, '').replace(/^\//, '');
    params[key] = compactText(value, 128);
  }
  return { name: (parts[0] || '').toUpperCase(), params };
}

function parseBoundedIcsEvents(icsText) {
  const rawEvents = [];
  let current = null;
  for (const line of unfoldIcsLines(icsText)) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current?.dtstart && current?.summary) rawEvents.push(current);
      current = null;
      if (rawEvents.length > MAX_FAMILY_SHARE_ICS_EVENTS) {
        const error = new Error('Calendar contains too many events');
        error.statusCode = 413;
        throw error;
      }
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const field = line.slice(0, colon);
    const { name, params } = parseIcsField(field);
    const value = line.slice(colon + 1);
    if (name === 'DTSTART') {
      current.recurrenceTimeZone = params.TZID || '';
      current.recurrenceWallParts = parseIcsWallParts(value);
      current.dtstart = parseIcsDate(value, params.TZID);
    }
    if (name === 'DTEND') current.dtend = parseIcsDate(value, params.TZID || current.recurrenceTimeZone);
    if (name === 'SUMMARY') current.summary = unescapeIcsText(value);
    if (name === 'LOCATION') current.location = unescapeIcsText(value);
    if (name === 'STATUS') current.status = compactText(value, 32).toUpperCase();
    if (name === 'UID') current.uid = compactText(value, 256);
    if (name === 'RRULE') current.rrule = parseRrule(value, current.recurrenceTimeZone);
    if (name === 'EXDATE') {
      current.exDates = [
        ...(current.exDates || []),
        ...value.split(',').map((date) => parseIcsDate(date, params.TZID || current.recurrenceTimeZone)).filter(Boolean)
      ];
    }
  }
  return rawEvents;
}

const dayIndexes = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function addRecurrenceDays(event, dayOffset) {
  const parts = event.recurrenceWallParts;
  if (!parts || !event.recurrenceTimeZone || parts.zone) {
    return new Date(event.dtstart.getTime() + dayOffset * 86_400_000);
  }
  const wallDate = new Date(Date.UTC(parts.year, parts.month, parts.day + dayOffset, parts.hour, parts.minute, parts.second));
  return parseWallClockInTimeZone({
    year: wallDate.getUTCFullYear(), month: wallDate.getUTCMonth(), day: wallDate.getUTCDate(),
    hour: wallDate.getUTCHours(), minute: wallDate.getUTCMinutes(), second: wallDate.getUTCSeconds()
  }, event.recurrenceTimeZone);
}

function expandIcsEvent(event) {
  if (!event.rrule) return [event];
  const result = [];
  const interval = event.rrule.interval || 1;
  const limit = event.rrule.count || MAX_FAMILY_SHARE_RECURRENCES;
  const untilMs = event.rrule.until?.getTime?.() || Number.POSITIVE_INFINITY;
  const excluded = new Set((event.exDates || []).map((date) => date.toISOString().slice(0, 10)));
  const start = event.dtstart;
  const durationMs = event.dtend ? Math.max(0, event.dtend.getTime() - start.getTime()) : null;
  let generatedCount = 0;
  const append = (date) => {
    if (date.getTime() > untilMs || generatedCount >= limit || generatedCount >= MAX_FAMILY_SHARE_RECURRENCES) return false;
    generatedCount += 1;
    if (!excluded.has(date.toISOString().slice(0, 10))) {
      result.push({ ...event, dtstart: date, dtend: durationMs == null ? null : new Date(date.getTime() + durationMs), rrule: null });
    }
    return true;
  };

  if (event.rrule.freq === 'DAILY') {
    for (let index = 0; index < MAX_FAMILY_SHARE_RECURRENCES; index += 1) {
      const date = addRecurrenceDays(event, index * interval);
      if (!date || !append(date)) break;
    }
    return result;
  }

  const byDays = event.rrule.byDays?.length ? event.rrule.byDays : [Object.keys(dayIndexes).find((key) => dayIndexes[key] === start.getUTCDay())];
  const allowedDays = new Set(byDays.map((day) => dayIndexes[day]));
  for (let dayOffset = 0; dayOffset < MAX_FAMILY_SHARE_RECURRENCES * 7; dayOffset += 1) {
    const date = addRecurrenceDays(event, dayOffset);
    if (!date) break;
    const week = Math.floor(dayOffset / 7);
    const wallDay = event.recurrenceWallParts
      ? new Date(Date.UTC(event.recurrenceWallParts.year, event.recurrenceWallParts.month, event.recurrenceWallParts.day + dayOffset)).getUTCDay()
      : date.getUTCDay();
    if (week % interval !== 0 || !allowedDays.has(wallDay)) continue;
    if (!append(date)) break;
  }
  return result;
}

function isPracticeSummary(summary) {
  return /\b(practice|training|workout|scrimmage practice)\b/i.test(summary || '');
}

function extractOpponent(summary, teamName = '') {
  const cleaned = compactText(summary).replace(/^\s*(game\s*[-:]\s*)?/i, '');
  const versus = cleaned.match(/(?:^|\s)(?:vs\.?|versus|@)\s+(.+)$/i);
  if (versus) return compactText(versus[1]);
  if (teamName && cleaned.toLowerCase().includes(teamName.toLowerCase())) {
    return compactText(cleaned.replace(new RegExp(teamName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '').replace(/\b(vs\.?|versus|@)\b/ig, '')) || 'TBD';
  }
  return cleaned || 'TBD';
}

function buildExternalCalendarEvents(icsText, { sourceId, sourceLabel = 'Shared calendar', children = [], teamId = '', teamName = '' } = {}) {
  const childIds = [...new Set(children.map((child) => compactText(child.playerId, 128)).filter(Boolean))];
  const childNames = [...new Set(children.map((child) => compactText(child.playerName, 160)).filter(Boolean))];
  return parseBoundedIcsEvents(icsText)
    .flatMap(expandIcsEvent)
    .slice(0, MAX_FAMILY_SHARE_ICS_EVENTS)
    .map((event) => {
      const summary = compactText(event.summary).replace(/\[CANCELED\]\s*/ig, '');
      const type = isPracticeSummary(summary) ? 'practice' : 'game';
      const date = toIso(event.dtstart);
      const idSeed = `${sourceId || ''}:${event.uid || ''}:${date || ''}:${summary}`;
      return {
        eventKey: crypto.createHash('sha256').update(idSeed).digest('hex').slice(0, 32),
        id: compactText(event.uid, 256) || crypto.createHash('sha256').update(idSeed).digest('hex').slice(0, 24),
        teamId: compactText(teamId, 128),
        teamName: compactText(teamName, 160) || compactText(sourceLabel, 160),
        type,
        date,
        endDate: toIso(event.dtend),
        title: type === 'practice' ? (summary || 'Practice') : '',
        opponent: type === 'game' ? extractOpponent(summary, teamName) : '',
        location: compactText(event.location, 300) || 'TBD',
        status: compactText(event.status, 32).toLowerCase() || 'scheduled',
        isCancelled: event.status === 'CANCELLED' || /\[CANCELED\]/i.test(event.summary || ''),
        isDbGame: false,
        childIds,
        childNames,
        homeScore: null,
        awayScore: null,
        sourceLabel: compactText(sourceLabel, 160) || 'Shared calendar'
      };
    })
    .filter((event) => event.date);
}

function buildFamilySharePresentation(token = {}) {
  return {
    label: compactText(token.label, 60) || 'Family Page',
    expiresAt: toIso(token.expiresAt)
  };
}

function sanitizeFamilyShareChild(child = {}) {
  return {
    teamId: compactText(child.teamId, 128),
    teamName: compactText(child.teamName, 160),
    playerId: compactText(child.playerId, 128),
    playerName: compactText(child.playerName, 160) || 'Player',
    playerNumber: compactText(child.playerNumber, 32),
    playerPhotoUrl: compactText(child.playerPhotoUrl, 2048) || null
  };
}

function sanitizeFamilyShareGame(game = {}) {
  const safe = {
    id: compactText(game.id || game.gameId, 256),
    gameId: compactText(game.gameId || game.id, 256),
    type: game.type === 'practice' ? 'practice' : 'game'
  };
  ['date', 'end', 'endDate', 'instanceDate'].forEach((field) => {
    const value = toIso(game[field]);
    if (value) safe[field] = value;
  });
  ['startTime', 'endTime'].forEach((field) => {
    if (game[field] != null) safe[field] = compactText(game[field], 32);
  });
  ['masterId', 'occurrenceId', 'teamId', 'opponentTeamId', 'sharedGameId'].forEach((field) => {
    if (game[field] != null) safe[field] = compactText(game[field], 256);
  });
  ['title', 'opponent', 'opponentTeamName'].forEach((field) => {
    if (game[field] != null) safe[field] = compactText(game[field], 240);
  });
  if (game.location != null) safe.location = compactText(game.location, 300);
  if (game.status != null) safe.status = compactText(game.status, 32);
  if (game.calendarEventUid != null) safe.calendarEventUid = compactText(game.calendarEventUid, 256);
  if (game.opponentTeamPhoto != null) safe.opponentTeamPhoto = compactText(game.opponentTeamPhoto, 2048);
  if (game.competitionType != null) safe.competitionType = compactText(game.competitionType, 64);
  ['isSeriesMaster', 'isHome', 'isSharedGame', 'countsTowardSeasonRecord'].forEach((field) => {
    if (typeof game[field] === 'boolean') safe[field] = game[field];
  });
  ['endDayOffset', 'homeScore', 'awayScore'].forEach((field) => {
    if (game[field] == null || game[field] === '') return;
    const value = Number(game[field]);
    if (Number.isFinite(value)) safe[field] = value;
  });
  if (game.recurrence && typeof game.recurrence === 'object' && !Array.isArray(game.recurrence)) {
    safe.recurrence = {
      freq: ['daily', 'weekly'].includes(compactText(game.recurrence.freq, 16).toLowerCase())
        ? compactText(game.recurrence.freq, 16).toLowerCase()
        : undefined,
      interval: Math.max(1, Math.min(Number.parseInt(game.recurrence.interval, 10) || 1, MAX_FAMILY_SHARE_RECURRENCES)),
      count: Math.max(1, Math.min(Number.parseInt(game.recurrence.count, 10) || MAX_FAMILY_SHARE_RECURRENCES, MAX_FAMILY_SHARE_RECURRENCES)),
      byDays: (Array.isArray(game.recurrence.byDays) ? game.recurrence.byDays : [])
        .map((day) => compactText(day, 2).toUpperCase())
        .filter((day) => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].includes(day))
        .slice(0, 7),
      until: toIso(game.recurrence.until)
    };
  }
  safe.exDates = (Array.isArray(game.exDates) ? game.exDates : [])
    .map((dateKey) => compactText(dateKey, 10))
    .filter((dateKey) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey))
    .slice(0, MAX_FAMILY_SHARE_RECURRENCES);
  if (game.overrides && typeof game.overrides === 'object' && !Array.isArray(game.overrides)) {
    safe.overrides = Object.fromEntries(Object.entries(game.overrides)
      .filter(([dateKey, override]) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && override && typeof override === 'object' && !Array.isArray(override))
      .slice(0, MAX_FAMILY_SHARE_RECURRENCES)
      .map(([dateKey, override]) => [dateKey, {
        title: compactText(override.title, 240),
        location: compactText(override.location, 300),
        startTime: compactText(override.startTime, 32),
        endTime: compactText(override.endTime, 32)
      }]));
  }
  return safe;
}

function sanitizeFamilyShareViewResponse({ token, children = [], teams = [], externalEvents = [], calendarWarnings = [] } = {}) {
  const boundedEvents = externalEvents.slice(0, MAX_FAMILY_SHARE_EVENTS);
  let remainingGames = MAX_FAMILY_SHARE_DB_EVENTS;
  const boundedTeams = teams.slice(0, MAX_FAMILY_SHARE_TEAMS).map((team = {}) => {
    const games = (Array.isArray(team.games) ? team.games : [])
      .slice(0, remainingGames)
      .map(sanitizeFamilyShareGame);
    remainingGames -= games.length;
    return {
      teamId: compactText(team.teamId, 128),
      teamName: compactText(team.teamName, 160) || 'Team',
      games
    };
  });
  return {
    projectionVersion: 2,
    presentation: buildFamilySharePresentation(token),
    children: children.slice(0, MAX_FAMILY_SHARE_CHILDREN).map(sanitizeFamilyShareChild),
    teams: boundedTeams,
    externalEvents: boundedEvents,
    calendarWarnings: [...new Set(calendarWarnings.map((warning) => compactText(warning, 160)).filter(Boolean))].slice(0, MAX_FAMILY_SHARE_CALENDAR_URLS)
  };
}

function getFamilyShareCalendarDedupTimestamps(teams = [], teamId = '') {
  const normalizedTeamId = compactText(teamId, 128);
  const scopedTeams = normalizedTeamId
    ? teams.filter((team) => compactText(team?.teamId, 128) === normalizedTeamId)
    : teams;
  return scopedTeams
    .flatMap((team) => (Array.isArray(team?.games) ? team.games : []))
    .map((game) => new Date(game?.date).getTime())
    .filter(Number.isFinite);
}

module.exports = {
  MAX_FAMILY_SHARE_CALENDAR_URLS,
  MAX_FAMILY_SHARE_CHILDREN,
  MAX_FAMILY_SHARE_DB_EVENTS,
  MAX_FAMILY_SHARE_EVENTS,
  MAX_FAMILY_SHARE_ICS_EVENTS,
  MAX_FAMILY_SHARE_TEAMS,
  buildExternalCalendarEvents,
  buildFamilySharePresentation,
  getFamilyShareCalendarDedupTimestamps,
  parseBoundedIcsEvents,
  sanitizeFamilyShareViewResponse
};
