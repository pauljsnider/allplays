const FIELD_DEFINITIONS = [
    { key: 'startDateTime', label: 'Start Date & Time', description: 'Combined datetime column', required: true },
    { key: 'date', label: 'Date', description: 'Required when Start Date & Time is not mapped', required: true },
    { key: 'startTime', label: 'Start Time', description: 'Required when Start Date & Time is not mapped', required: true },
    { key: 'endTime', label: 'End Time', description: 'Optional event end time', required: false },
    { key: 'eventType', label: 'Event Type', description: 'Game or practice', required: false },
    { key: 'opponent', label: 'Opponent', description: 'Required for game rows', required: false },
    { key: 'title', label: 'Title', description: 'Practice title or event label', required: false },
    { key: 'location', label: 'Location', description: 'Field, gym, or venue', required: false },
    { key: 'arrivalTime', label: 'Arrival Time', description: 'Optional same-day arrival/check-in time', required: false },
    { key: 'isHome', label: 'Home / Away', description: 'Optional game side', required: false },
    { key: 'notes', label: 'Notes', description: 'Optional coach notes', required: false }
];

const HEADER_ALIASES = {
    startDateTime: ['start date & time', 'start datetime', 'datetime', 'event datetime', 'date time', 'start date time'],
    date: ['date', 'event date', 'day'],
    startTime: ['start time', 'time', 'start', 'kickoff', 'tipoff'],
    endTime: ['end time', 'end', 'finish time'],
    eventType: ['event type', 'type', 'kind'],
    opponent: ['opponent', 'away team', 'vs', 'visitor', 'opponent name'],
    title: ['title', 'event title', 'practice title', 'name'],
    location: ['location', 'venue', 'field', 'gym', 'site'],
    arrivalTime: ['arrival time', 'arrival', 'check in', 'check-in', 'meet time'],
    isHome: ['home/away', 'home away', 'home-away', 'site type'],
    notes: ['notes', 'comments', 'comment', 'details', 'description']
};

export const SCHEDULE_CSV_IMPORT_FIELDS = FIELD_DEFINITIONS.map((field) => ({ ...field }));

export function parseCsvText(csvText) {
    const source = String(csvText || '');
    const rows = [];
    let currentRow = [];
    let currentValue = '';
    let insideQuotes = false;

    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        const next = source[index + 1];

        if (char === '"') {
            if (insideQuotes && next === '"') {
                currentValue += '"';
                index += 1;
            } else {
                insideQuotes = !insideQuotes;
            }
            continue;
        }

        if (char === ',' && !insideQuotes) {
            currentRow.push(currentValue);
            currentValue = '';
            continue;
        }

        if ((char === '\n' || char === '\r') && !insideQuotes) {
            if (char === '\r' && next === '\n') {
                index += 1;
            }
            currentRow.push(currentValue);
            if (currentRow.some((cell) => String(cell).trim() !== '')) {
                rows.push(currentRow);
            }
            currentRow = [];
            currentValue = '';
            continue;
        }

        currentValue += char;
    }

    if (currentValue !== '' || currentRow.length > 0) {
        currentRow.push(currentValue);
        if (currentRow.some((cell) => String(cell).trim() !== '')) {
            rows.push(currentRow);
        }
    }

    const [headerRow = [], ...dataRows] = rows;
    const headers = headerRow.map((header, index) => normalizeHeaderName(header) || `Column ${index + 1}`);

    return {
        headers,
        rows: dataRows.map((row) => {
            const record = {};
            headers.forEach((header, index) => {
                record[header] = String(row[index] || '').trim();
            });
            return record;
        })
    };
}

export function inferScheduleCsvMapping(headers = []) {
    const mapping = {};
    headers.forEach((header) => {
        const normalizedHeader = normalizeLookupValue(header);
        Object.entries(HEADER_ALIASES).forEach(([fieldKey, aliases]) => {
            if (mapping[fieldKey]) return;
            if (aliases.includes(normalizedHeader)) {
                mapping[fieldKey] = header;
            }
        });
    });
    return mapping;
}

export function validateScheduleCsvMapping(mapping = {}) {
    const hasCombinedStart = !!mapping.startDateTime;
    const hasSplitStart = !!mapping.date && !!mapping.startTime;

    if (!hasCombinedStart && !hasSplitStart) {
        return ['Map either Start Date & Time or both Date and Start Time before previewing.'];
    }

    return [];
}

export function normalizeScheduleImportDraft(draft = {}, options = {}) {
    const rowNumber = Number.isInteger(options.rowNumber) ? options.rowNumber : 1;
    const rawDraft = {
        eventType: normalizeDraftValue(draft.eventType),
        startsAt: normalizeDraftValue(draft.startsAt),
        endsAt: normalizeDraftValue(draft.endsAt),
        opponent: normalizeDraftValue(draft.opponent),
        title: normalizeDraftValue(draft.title),
        location: normalizeDraftValue(draft.location),
        arrivalTime: normalizeDraftValue(draft.arrivalTime),
        isHome: normalizeHomeAwayDraftValue(draft.isHome),
        notes: normalizeDraftValue(draft.notes)
    };

    const errors = [];
    const eventType = inferEventType(rawDraft);
    const startsAt = parseFlexibleDateTime(rawDraft.startsAt);
    const endsAt = rawDraft.endsAt ? parseFlexibleDateTime(rawDraft.endsAt) : null;
    const arrivalTime = rawDraft.arrivalTime ? parseFlexibleDateTime(rawDraft.arrivalTime) : null;
    const sanitizedDraft = {
        ...rawDraft,
        eventType,
        startsAt: startsAt ? toLocalIso(startsAt) : rawDraft.startsAt,
        endsAt: endsAt ? toLocalIso(endsAt) : rawDraft.endsAt,
        arrivalTime: arrivalTime ? toLocalIso(arrivalTime) : rawDraft.arrivalTime
    };

    if (!rawDraft.startsAt || !startsAt) {
        errors.push('Start time is invalid.');
    }
    if (rawDraft.endsAt && !endsAt) {
        errors.push('End time is invalid.');
    }
    if (rawDraft.arrivalTime && !arrivalTime) {
        errors.push('Arrival time is invalid.');
    }
    if (startsAt && endsAt && endsAt < startsAt) {
        errors.push('End time must be after the start time.');
    }
    if (eventType === 'game' && !rawDraft.opponent) {
        errors.push('Game rows require an opponent.');
    }

    const normalized = {
        rowNumber,
        eventType,
        startsAt: startsAt ? toLocalIso(startsAt) : null,
        endsAt: endsAt ? toLocalIso(endsAt) : null,
        opponent: sanitizedDraft.opponent || null,
        title: eventType === 'practice' ? (sanitizedDraft.title || 'Practice') : null,
        location: sanitizedDraft.location || null,
        arrivalTime: arrivalTime ? toLocalIso(arrivalTime) : null,
        isHome: parseHomeAwayValue(sanitizedDraft.isHome),
        notes: sanitizedDraft.notes || null
    };

    return {
        rowNumber,
        draft: sanitizedDraft,
        normalized,
        errors
    };
}

export function buildScheduleImportPreview({ rows = [], mapping = {}, teamName = '' } = {}) {
    const mappingErrors = validateScheduleCsvMapping(mapping);
    if (mappingErrors.length > 0) {
        return {
            errors: mappingErrors,
            rows: []
        };
    }

    return {
        errors: [],
        rows: rows.map((row, index) => {
            const draft = {
                eventType: readMappedValue(row, mapping.eventType),
                startsAt: readMappedDateTime(row, mapping),
                endsAt: readMappedDateTime(row, { startDateTime: null, date: mapping.date, startTime: mapping.endTime }),
                opponent: readMappedValue(row, mapping.opponent),
                title: readMappedValue(row, mapping.title),
                location: readMappedValue(row, mapping.location),
                arrivalTime: readMappedDateTime(row, { startDateTime: null, date: mapping.date, startTime: mapping.arrivalTime }),
                isHome: readMappedValue(row, mapping.isHome),
                notes: readMappedValue(row, mapping.notes)
            };

            return normalizeScheduleImportDraft(draft, {
                rowNumber: index + 2,
                teamName
            });
        })
    };
}

function readMappedValue(row, headerName) {
    if (!headerName) return '';
    return normalizeDraftValue(row?.[headerName]);
}

function readMappedDateTime(row, mapping = {}) {
    if (mapping.startDateTime) {
        return readMappedValue(row, mapping.startDateTime);
    }
    if (!mapping.date || !mapping.startTime) {
        return '';
    }

    const dateValue = readMappedValue(row, mapping.date);
    const timeValue = readMappedValue(row, mapping.startTime);
    return [dateValue, timeValue].filter(Boolean).join(' ').trim();
}

function inferEventType(draft) {
    const value = normalizeLookupValue(draft.eventType);
    if (['practice', 'training', 'session'].includes(value)) return 'practice';
    if (['game', 'match', 'scrimmage', 'event'].includes(value)) return 'game';
    if (draft.opponent) return 'game';
    if (normalizeLookupValue(draft.title).includes('practice')) return 'practice';
    return 'practice';
}

function normalizeDraftValue(value) {
    return String(value || '').trim();
}

function normalizeHomeAwayDraftValue(value) {
    const normalized = normalizeLookupValue(value);
    if (['home', 'h'].includes(normalized)) return 'home';
    if (['away', 'a'].includes(normalized)) return 'away';
    return '';
}

function parseHomeAwayValue(value) {
    if (value === 'home') return true;
    if (value === 'away') return false;
    return null;
}

function normalizeHeaderName(value) {
    return String(value || '').replace(/\ufeff/g, '').trim();
}

function normalizeLookupValue(value) {
    return normalizeHeaderName(value).toLowerCase().replace(/\s+/g, ' ').replace(/[_-]+/g, ' ');
}

function parseFlexibleDateTime(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return null;

    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
        const date = new Date(`${trimmed}:00`);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    const isoDateTime = trimmed.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)$/i);
    if (isoDateTime) {
        return parseCombinedDateTime(isoDateTime[1], isoDateTime[2]);
    }

    const usDateTime = trimmed.match(/^([A-Za-z]{3,9}\s+\d{1,2},\s*\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s+(.+)$/i);
    if (usDateTime) {
        return parseCombinedDateTime(usDateTime[1], usDateTime[2]);
    }

    return null;
}

function parseCombinedDateTime(dateText, timeText) {
    const dateParts = parseDateText(dateText);
    const timeParts = parseTimeText(timeText);
    if (!dateParts || !timeParts) return null;

    return new Date(
        dateParts.year,
        dateParts.month - 1,
        dateParts.day,
        timeParts.hours,
        timeParts.minutes,
        0,
        0
    );
}

function parseDateText(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return null;

    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
        return {
            year: Number(isoMatch[1]),
            month: Number(isoMatch[2]),
            day: Number(isoMatch[3])
        };
    }

    const slashMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (slashMatch) {
        const year = Number(slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3]);
        return {
            month: Number(slashMatch[1]),
            day: Number(slashMatch[2]),
            year
        };
    }

    const namedDate = new Date(trimmed);
    if (!Number.isNaN(namedDate.getTime())) {
        return {
            year: namedDate.getFullYear(),
            month: namedDate.getMonth() + 1,
            day: namedDate.getDate()
        };
    }

    return null;
}

function parseTimeText(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return null;

    const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (!match) return null;

    let hours = Number(match[1]);
    const minutes = Number(match[2] || '0');
    const meridiem = match[3] ? match[3].toUpperCase() : null;

    if (minutes > 59 || hours > 23 || hours < 0) return null;

    if (meridiem) {
        if (hours < 1 || hours > 12) return null;
        if (meridiem === 'AM') {
            hours = hours === 12 ? 0 : hours;
        } else {
            hours = hours === 12 ? 12 : hours + 12;
        }
    }

    return { hours, minutes };
}

function toLocalIso(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}
