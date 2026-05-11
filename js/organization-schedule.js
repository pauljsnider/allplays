import { normalizeScheduleImportDraft } from './schedule-csv-import.js';

export const ORGANIZATION_SCHEDULE_CSV_FIELDS = [
    { key: 'homeTeamName', label: 'Home Team', required: true },
    { key: 'awayTeamName', label: 'Away Team', required: true },
    { key: 'gameDate', label: 'Date & Time', required: true },
    { key: 'location', label: 'Location', required: true },
    { key: 'arrivalTime', label: 'Arrival Time', required: false },
    { key: 'notes', label: 'Notes', required: false }
];

const ORGANIZATION_SCHEDULE_CSV_HEADER_ALIASES = {
    homeTeamName: ['home team', 'home', 'home team name'],
    awayTeamName: ['away team', 'away', 'away team name', 'visitor', 'visitor team'],
    gameDate: ['date & time', 'date and time', 'game date & time', 'game date', 'datetime', 'start date & time'],
    location: ['location', 'venue', 'field', 'gym', 'site'],
    arrivalTime: ['arrival time', 'arrival', 'check in', 'check-in', 'meet time'],
    notes: ['notes', 'comments', 'details']
};

export const ORGANIZATION_SCHEDULE_WEEKDAYS = [
    { value: 'monday', label: 'Monday' },
    { value: 'tuesday', label: 'Tuesday' },
    { value: 'wednesday', label: 'Wednesday' },
    { value: 'thursday', label: 'Thursday' },
    { value: 'friday', label: 'Friday' },
    { value: 'saturday', label: 'Saturday' },
    { value: 'sunday', label: 'Sunday' }
];

const ORGANIZATION_SCHEDULE_WEEKDAY_VALUES = new Set(ORGANIZATION_SCHEDULE_WEEKDAYS.map((day) => day.value));
const TIME_VALUE_PATTERN = /^\d{2}:\d{2}$/;
const DATE_VALUE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeTextValue(value) {
    return String(value || '').trim();
}

function normalizeDateValue(value) {
    return normalizeTextValue(value);
}

function isValidTimeValue(value) {
    return TIME_VALUE_PATTERN.test(String(value || ''));
}

function isValidDateValue(value) {
    return DATE_VALUE_PATTERN.test(String(value || ''));
}

function compareTimeValues(startTime, endTime) {
    return String(startTime || '').localeCompare(String(endTime || ''));
}

export function getOrganizationScheduleWeekdayLabel(value) {
    return ORGANIZATION_SCHEDULE_WEEKDAYS.find((day) => day.value === value)?.label || String(value || '');
}

export function buildVenueAvailabilityPayload({
    venueName = '',
    subVenueName = '',
    dayOfWeek = '',
    startTime = '',
    endTime = '',
    notes = ''
} = {}) {
    const payload = {
        venueName: normalizeTextValue(venueName),
        subVenueName: normalizeTextValue(subVenueName) || null,
        dayOfWeek: normalizeTextValue(dayOfWeek).toLowerCase(),
        startTime: normalizeTextValue(startTime),
        endTime: normalizeTextValue(endTime),
        notes: normalizeTextValue(notes) || null
    };

    if (!payload.venueName) {
        throw new Error('Venue or sub-venue name is required.');
    }
    if (!ORGANIZATION_SCHEDULE_WEEKDAY_VALUES.has(payload.dayOfWeek)) {
        throw new Error('Choose an available day.');
    }
    if (!isValidTimeValue(payload.startTime) || !isValidTimeValue(payload.endTime)) {
        throw new Error('Enter a start and end time for the availability window.');
    }
    if (compareTimeValues(payload.startTime, payload.endTime) >= 0) {
        throw new Error('Availability end time must be after the start time.');
    }

    return payload;
}

export function buildBlackoutDatePayload({
    scope = 'organization',
    venueName = '',
    subVenueName = '',
    startDate = '',
    endDate = '',
    reason = ''
} = {}) {
    const normalizedScope = normalizeTextValue(scope) === 'venue' ? 'venue' : 'organization';
    const payload = {
        scope: normalizedScope,
        venueName: normalizeTextValue(venueName) || null,
        subVenueName: normalizeTextValue(subVenueName) || null,
        startDate: normalizeDateValue(startDate),
        endDate: normalizeDateValue(endDate),
        reason: normalizeTextValue(reason) || null
    };

    if (payload.scope === 'venue' && !payload.venueName) {
        throw new Error('Venue or sub-venue name is required for venue-specific blackouts.');
    }
    if (!isValidDateValue(payload.startDate) || !isValidDateValue(payload.endDate)) {
        throw new Error('Enter a start and end date for the blackout.');
    }
    if (payload.endDate < payload.startDate) {
        throw new Error('Blackout end date cannot be before the start date.');
    }

    return payload;
}

export function formatVenueAvailabilityRecord(record = {}) {
    const venue = [record.venueName, record.subVenueName].filter(Boolean).join(' / ');
    const day = getOrganizationScheduleWeekdayLabel(record.dayOfWeek);
    const window = [record.startTime, record.endTime].filter(Boolean).join('–');
    return [venue || 'Venue', day, window].filter(Boolean).join(' · ');
}

export function formatBlackoutDateRecord(record = {}) {
    const scope = record.scope === 'venue'
        ? [record.venueName, record.subVenueName].filter(Boolean).join(' / ') || 'Venue blackout'
        : 'Organization-wide blackout';
    const range = record.startDate === record.endDate
        ? record.startDate
        : `${record.startDate || 'Start'} through ${record.endDate || 'End'}`;
    return `${scope} · ${range}`;
}

function normalizeTeamList(teams) {
    return (Array.isArray(teams) ? teams : [])
        .filter((team) => team && team.id)
        .map((team) => ({ ...team, id: String(team.id) }));
}

function normalizeHeaderLookupValue(value) {
    return String(value || '')
        .replace(/\ufeff/g, '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[_-]+/g, ' ');
}

function normalizeTeamName(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function uniqueMessages(messages = []) {
    return Array.from(new Set(messages.filter(Boolean)));
}

function buildTeamNameIndex(teams = []) {
    return normalizeTeamList(teams).reduce((index, team) => {
        const key = normalizeTeamName(team.name);
        if (!key) return index;
        if (!index.has(key)) {
            index.set(key, []);
        }
        index.get(key).push(team);
        return index;
    }, new Map());
}

function matchOrganizationTeam(teamName, label, organizationIndex, accessibleIndex) {
    const normalizedName = normalizeTeamName(teamName);
    if (!normalizedName) {
        return {
            team: null,
            status: 'missing',
            error: `${label} is required.`
        };
    }

    const organizationMatches = organizationIndex.get(normalizedName) || [];
    if (organizationMatches.length === 1) {
        return {
            team: organizationMatches[0],
            status: 'matched',
            error: null
        };
    }

    if (organizationMatches.length > 1) {
        return {
            team: null,
            status: 'ambiguous',
            error: `${label} matches multiple teams in this organization.`
        };
    }

    const accessibleMatches = accessibleIndex.get(normalizedName) || [];
    if (accessibleMatches.length > 0) {
        return {
            team: null,
            status: 'outside-organization',
            error: `${label} is outside the current organization.`
        };
    }

    return {
        team: null,
        status: 'unknown',
        error: `${label} was not found.`
    };
}

function readMappedValue(row, headerName) {
    if (!headerName) return '';
    return String(row?.[headerName] || '').trim();
}

export function getOrganizationTeams({ accessibleTeams = [], organizationOwnerId = null } = {}) {
    const normalizedOwnerId = String(organizationOwnerId || '').trim();
    return normalizeTeamList(accessibleTeams).filter((team) => {
        if (!normalizedOwnerId) return true;
        return String(team.ownerId || '').trim() === normalizedOwnerId;
    });
}

export function validateOrganizationMatchup({
    homeTeamId,
    awayTeamId,
    organizationTeams = [],
    organizationOwnerId = null
} = {}) {
    const normalizedHomeTeamId = String(homeTeamId || '').trim();
    const normalizedAwayTeamId = String(awayTeamId || '').trim();
    const eligibleTeams = getOrganizationTeams({ accessibleTeams: organizationTeams, organizationOwnerId });
    const teamsById = new Map(eligibleTeams.map((team) => [team.id, team]));

    if (!normalizedHomeTeamId || !normalizedAwayTeamId) {
        return { ok: false, error: 'Select both a home team and an away team.' };
    }

    if (normalizedHomeTeamId === normalizedAwayTeamId) {
        return { ok: false, error: 'Choose two different teams for the shared matchup.' };
    }

    const homeTeam = teamsById.get(normalizedHomeTeamId);
    const awayTeam = teamsById.get(normalizedAwayTeamId);
    if (!homeTeam || !awayTeam) {
        return { ok: false, error: 'Both teams must belong to the current organization.' };
    }

    return {
        ok: true,
        homeTeam,
        awayTeam
    };
}

export function inferOrganizationScheduleCsvMapping(headers = []) {
    const mapping = {};
    headers.forEach((header) => {
        const normalizedHeader = normalizeHeaderLookupValue(header);
        Object.entries(ORGANIZATION_SCHEDULE_CSV_HEADER_ALIASES).forEach(([fieldKey, aliases]) => {
            if (mapping[fieldKey]) return;
            if (aliases.includes(normalizedHeader)) {
                mapping[fieldKey] = header;
            }
        });
    });
    return mapping;
}

export function validateOrganizationScheduleCsvMapping(mapping = {}) {
    const missingFields = ORGANIZATION_SCHEDULE_CSV_FIELDS
        .filter((field) => field.required && !mapping[field.key])
        .map((field) => field.label);

    if (missingFields.length === 0) {
        return [];
    }

    return [
        `Missing required CSV column${missingFields.length === 1 ? '' : 's'}: ${missingFields.join(', ')}.`
    ];
}

export function buildOrganizationScheduleCsvTemplate() {
    const headerRow = ORGANIZATION_SCHEDULE_CSV_FIELDS.map((field) => field.label).join(',');
    const exampleRow = [
        'Falcons 12U',
        'Wolves 12U',
        '2026-08-15 18:00',
        'Main Field',
        '2026-08-15 17:15',
        'Bring white jerseys'
    ].join(',');

    return `${headerRow}\n${exampleRow}\n`;
}

export function buildOrganizationScheduleImportPreview({
    rows = [],
    mapping = {},
    organizationTeams = [],
    accessibleTeams = [],
    organizationOwnerId = null
} = {}) {
    const mappingErrors = validateOrganizationScheduleCsvMapping(mapping);
    if (mappingErrors.length > 0) {
        return {
            errors: mappingErrors,
            rows: [],
            validRows: [],
            invalidRows: []
        };
    }

    const eligibleTeams = getOrganizationTeams({
        accessibleTeams: organizationTeams,
        organizationOwnerId
    });
    const organizationIndex = buildTeamNameIndex(eligibleTeams);
    const accessibleIndex = buildTeamNameIndex(accessibleTeams);

    const previewRows = rows.map((row, index) => {
        const rowNumber = index + 2;
        const raw = {
            homeTeamName: readMappedValue(row, mapping.homeTeamName),
            awayTeamName: readMappedValue(row, mapping.awayTeamName),
            gameDate: readMappedValue(row, mapping.gameDate),
            location: readMappedValue(row, mapping.location),
            arrivalTime: readMappedValue(row, mapping.arrivalTime),
            notes: readMappedValue(row, mapping.notes)
        };

        const homeMatch = matchOrganizationTeam(raw.homeTeamName, 'Home team', organizationIndex, accessibleIndex);
        const awayMatch = matchOrganizationTeam(raw.awayTeamName, 'Away team', organizationIndex, accessibleIndex);
        const scheduleDraft = normalizeScheduleImportDraft({
            eventType: 'game',
            startsAt: raw.gameDate,
            arrivalTime: raw.arrivalTime,
            opponent: raw.awayTeamName || 'Opponent',
            location: raw.location,
            notes: raw.notes,
            isHome: 'home'
        }, { rowNumber });

        const errors = uniqueMessages([
            homeMatch.error,
            awayMatch.error,
            ...(scheduleDraft.errors || [])
        ]);

        if (homeMatch.team && awayMatch.team && homeMatch.team.id === awayMatch.team.id) {
            errors.push('Home and away teams must be different.');
        }

        return {
            rowNumber,
            raw,
            homeTeam: homeMatch.team || null,
            awayTeam: awayMatch.team || null,
            normalized: {
                gameDate: scheduleDraft.normalized.startsAt,
                arrivalTime: scheduleDraft.normalized.arrivalTime,
                location: raw.location || null,
                notes: raw.notes || null
            },
            errors: uniqueMessages(errors),
            valid: errors.length === 0
        };
    });

    return {
        errors: [],
        rows: previewRows,
        validRows: previewRows.filter((row) => row.valid),
        invalidRows: previewRows.filter((row) => !row.valid)
    };
}

export function buildOrganizationSharedGamePayload({
    awayTeam,
    gameDate,
    location = '',
    arrivalTime = '',
    notes = '',
    Timestamp
} = {}) {
    const parsedGameDate = gameDate instanceof Date ? gameDate : new Date(gameDate);
    if (!(parsedGameDate instanceof Date) || Number.isNaN(parsedGameDate.getTime())) {
        throw new Error('A valid game date is required.');
    }

    const parsedArrivalTime = arrivalTime ? new Date(arrivalTime) : null;
    if (arrivalTime && Number.isNaN(parsedArrivalTime?.getTime())) {
        throw new Error('A valid arrival time is required.');
    }

    if (!Timestamp?.fromDate) {
        throw new Error('Timestamp.fromDate is required.');
    }

    return {
        type: 'game',
        status: 'scheduled',
        date: Timestamp.fromDate(parsedGameDate),
        opponent: awayTeam?.name || 'Opponent',
        opponentTeamId: awayTeam?.id || null,
        opponentTeamName: awayTeam?.name || null,
        opponentTeamPhoto: awayTeam?.photoUrl || null,
        location: String(location || '').trim(),
        arrivalTime: parsedArrivalTime ? Timestamp.fromDate(parsedArrivalTime) : null,
        notes: String(notes || '').trim() || null,
        isHome: true,
        homeScore: 0,
        awayScore: 0
    };
}
