function normalizeDateValue(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value.toDate === 'function') {
        const date = value.toDate();
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function parseStartTime(value) {
    const time = typeof value === 'string' ? value.trim() : '';
    const match = /^(\d{1,2}):(\d{2})$/.exec(time);
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

    return { hours, minutes };
}

function getOccurrenceStartTime(game, instanceDate) {
    const override = instanceDate && game?.overrides && typeof game.overrides === 'object'
        ? game.overrides[instanceDate]
        : null;
    return override?.startTime || game?.startTime || null;
}

export function resolveAvailabilityCutoffEventDate(game, instanceDate) {
    const baseDate = normalizeDateValue(game?.date);
    if (!baseDate) return null;

    if (!instanceDate) {
        return baseDate;
    }

    const occurrenceDate = new Date(`${instanceDate}T00:00:00`);
    if (Number.isNaN(occurrenceDate.getTime())) {
        return baseDate;
    }

    const startTime = parseStartTime(getOccurrenceStartTime(game, instanceDate));
    if (startTime) {
        occurrenceDate.setHours(startTime.hours, startTime.minutes, 0, 0);
    } else {
        occurrenceDate.setHours(baseDate.getHours(), baseDate.getMinutes(), baseDate.getSeconds(), baseDate.getMilliseconds());
    }

    return occurrenceDate;
}
