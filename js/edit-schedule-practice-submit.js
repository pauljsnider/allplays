import { applyPracticeRecurrenceFields } from './edit-schedule-practice-payload.js';

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

    const practiceData = {
        title: formState.title,
        date: Timestamp.fromDate(formState.startDate),
        end: Timestamp.fromDate(formState.endDate),
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
        startDate: formState.startDate,
        endDate: formState.endDate,
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
