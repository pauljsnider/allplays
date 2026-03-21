const RECURRENCE_FIELD_KEYS = [
    'isSeriesMaster',
    'recurrence',
    'seriesId',
    'startTime',
    'endTime',
    'exDates',
    'overrides'
];

export function applyPracticeRecurrenceFields({
    practiceData,
    isRecurring,
    editingPracticeId = null,
    editingSeriesId = null,
    recurrenceConfig = {},
    startDate,
    endDate,
    Timestamp,
    deleteField,
    generateSeriesId
} = {}) {
    if (!practiceData || !Timestamp || !deleteField || !generateSeriesId) {
        throw new Error('applyPracticeRecurrenceFields requires practice data, firestore helpers, and a series ID generator');
    }

    if (isRecurring) {
        const {
            freq = 'weekly',
            interval = 1,
            byDays = [],
            endType = 'never',
            untilValue = '',
            countValue = 10
        } = recurrenceConfig;

        practiceData.isSeriesMaster = true;
        practiceData.seriesId = editingPracticeId
            ? (editingSeriesId || practiceData.seriesId || generateSeriesId())
            : generateSeriesId();
        practiceData.startTime = startDate.toTimeString().slice(0, 5);
        practiceData.endTime = endDate.toTimeString().slice(0, 5);
        practiceData.recurrence = {
            freq,
            interval,
            byDays
        };

        if (endType === 'until' && untilValue) {
            practiceData.recurrence.until = Timestamp.fromDate(new Date(untilValue));
        } else if (endType === 'count') {
            practiceData.recurrence.count = Number.parseInt(countValue, 10) || 10;
        }

        if (!editingPracticeId) {
            practiceData.exDates = [];
            practiceData.overrides = {};
        }

        return practiceData;
    }

    if (editingPracticeId) {
        RECURRENCE_FIELD_KEYS.forEach((fieldName) => {
            practiceData[fieldName] = deleteField();
        });
    }

    return practiceData;
}
