import { applyPracticeRecurrenceFields } from './edit-schedule-practice-payload.js';

const MAX_OVERNIGHT_PRACTICE_MS = 12 * 60 * 60 * 1000;

function isSameLocalDate(firstDate, secondDate) {
    return firstDate.getFullYear() === secondDate.getFullYear()
        && firstDate.getMonth() === secondDate.getMonth()
        && firstDate.getDate() === secondDate.getDate();
}

export function validatePracticeDateRange(startDate, endDate) {
    const startTime = startDate instanceof Date ? startDate.getTime() : Number.NaN;
    const endTime = endDate instanceof Date ? endDate.getTime() : Number.NaN;

    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
        throw new Error('Practice start and end times must be valid dates');
    }
    if (endTime <= startTime) {
        if (!isSameLocalDate(startDate, endDate)) {
            throw new Error('End time must be after the start time');
        }
        const overnightEndDate = new Date(endTime);
        overnightEndDate.setDate(overnightEndDate.getDate() + 1);
        const overnightDuration = overnightEndDate.getTime() - startTime;
        if (overnightDuration > 0 && overnightDuration <= MAX_OVERNIGHT_PRACTICE_MS) {
            return {
                startDate,
                endDate: overnightEndDate
            };
        }
        throw new Error('End time must be after the start time');
    }

    return {
        startDate,
        endDate
    };
}

export async function savePracticeForm({
    teamId,
    editingPracticeId = null,
    editingSeriesId = null,
    formState,
    recurrenceState = {},
    Timestamp,
    deleteField,
    generateSeriesId,
    addPractice,
    updateEvent
} = {}) {
    if (!teamId || !formState || !Timestamp || !deleteField || !generateSeriesId || !addPractice || !updateEvent) {
        throw new Error('savePracticeForm requires team, form state, firestore helpers, and persistence functions');
    }
    const { startDate, endDate } = validatePracticeDateRange(formState.startDate, formState.endDate);

    const practiceData = {
        title: formState.title,
        date: Timestamp.fromDate(startDate),
        end: Timestamp.fromDate(endDate),
        location: formState.location,
        notes: formState.notes,
        scheduleNotifications: formState.scheduleNotifications
    };

    applyPracticeRecurrenceFields({
        practiceData,
        isRecurring: recurrenceState.isRecurring,
        editingPracticeId,
        editingSeriesId,
        recurrenceConfig: {
            freq: recurrenceState.freq,
            interval: recurrenceState.interval,
            byDays: recurrenceState.byDays,
            endType: recurrenceState.endType,
            untilValue: recurrenceState.untilValue,
            countValue: recurrenceState.countValue
        },
        startDate,
        endDate,
        Timestamp,
        deleteField,
        generateSeriesId
    });

    let savedPracticeId = editingPracticeId;
    if (editingPracticeId) {
        await updateEvent(teamId, editingPracticeId, practiceData);
    } else {
        savedPracticeId = await addPractice(teamId, practiceData);
    }

    return {
        practiceData,
        savedPracticeId
    };
}
