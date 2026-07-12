const PRACTICE_DEFAULT_DURATION_MS = 90 * 60 * 1000;

export function getBulkOperationEventType(operation) {
    const raw = typeof operation?.eventType === 'string' ? operation.eventType.trim().toLowerCase() : '';
    return raw === 'practice' ? 'practice' : 'game';
}

export function normalizeBulkPracticeForAdd(practice = {}) {
    const startDate = new Date(practice.date);
    if (!practice.date || !Number.isFinite(startDate.getTime())) {
        throw new Error('Practice date must be a valid date');
    }

    const endSource = practice.endTime || practice.end;
    let endDate = endSource ? new Date(endSource) : null;
    if (!endDate || !Number.isFinite(endDate.getTime()) || endDate.getTime() <= startDate.getTime()) {
        endDate = new Date(startDate.getTime() + PRACTICE_DEFAULT_DURATION_MS);
    }

    const title = typeof practice.title === 'string' && practice.title.trim() ? practice.title.trim() : 'Practice';

    return {
        type: 'practice',
        title,
        date: startDate.toISOString(),
        end: endDate.toISOString(),
        location: typeof practice.location === 'string' ? practice.location.trim() : '',
        notes: practice.notes ? String(practice.notes).trim() : null
    };
}
