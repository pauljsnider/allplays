# Requirements

- Acceptance criterion: editing an existing recurring practice with recurrence disabled must send Firestore deleteField sentinels for all recurrence-only fields.
- Fields in scope: isSeriesMaster, recurrence, seriesId, startTime, endTime, endDayOffset, exDates, overrides.
- Existing one-time practice creation/update behavior must remain unchanged outside recurrence metadata cleanup.
- Review thread addressed: PRRT_kwDOQe-T586EZXaH.
