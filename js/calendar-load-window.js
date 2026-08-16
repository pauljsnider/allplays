function toTime(value) {
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
    if (!Number.isFinite(time)) throw new Error('Calendar load ranges require valid dates');
    return time;
}

export function normalizeCalendarLoadRange(startDate, endDate) {
    const start = new Date(toTime(startDate));
    const end = new Date(toTime(endDate));
    if (start > end) throw new Error('Calendar load range start must not be after its end');
    return { startDate: start, endDate: end };
}

export function getMissingCalendarLoadRanges(loadedRanges, requestedRange) {
    const requested = normalizeCalendarLoadRange(requestedRange.startDate, requestedRange.endDate);
    const covered = (loadedRanges || [])
        .map((range) => normalizeCalendarLoadRange(range.startDate, range.endDate))
        .filter((range) => range.endDate >= requested.startDate && range.startDate <= requested.endDate)
        .sort((a, b) => a.startDate - b.startDate);
    const missing = [];
    let cursor = requested.startDate.getTime();
    for (const range of covered) {
        const rangeStart = Math.max(range.startDate.getTime(), requested.startDate.getTime());
        const rangeEnd = Math.min(range.endDate.getTime(), requested.endDate.getTime());
        if (rangeEnd < cursor) continue;
        if (rangeStart > cursor) {
            missing.push({ startDate: new Date(cursor), endDate: new Date(rangeStart - 1) });
        }
        cursor = Math.max(cursor, rangeEnd + 1);
        if (cursor > requested.endDate.getTime()) break;
    }
    if (cursor <= requested.endDate.getTime()) {
        missing.push({ startDate: new Date(cursor), endDate: requested.endDate });
    }
    return missing;
}

export function addCalendarLoadedRange(loadedRanges, range) {
    const next = [...(loadedRanges || []), normalizeCalendarLoadRange(range.startDate, range.endDate)]
        .sort((a, b) => a.startDate - b.startDate);
    const merged = [];
    for (const current of next) {
        const previous = merged[merged.length - 1];
        if (previous && current.startDate.getTime() <= previous.endDate.getTime() + 1) {
            previous.endDate = new Date(Math.max(previous.endDate.getTime(), current.endDate.getTime()));
        } else {
            merged.push({ ...current });
        }
    }
    return merged;
}

export function createLatestCalendarRangeLoader(loadRange) {
    let pendingRequest = null;
    let activePromise = null;

    return function requestCalendarRange(range) {
        pendingRequest = { range };
        if (!activePromise) {
            activePromise = (async () => {
                while (pendingRequest) {
                    const request = pendingRequest;
                    pendingRequest = null;
                    await loadRange(request.range);
                }
            })().finally(() => {
                activePromise = null;
            });
        }
        return activePromise;
    };
}
