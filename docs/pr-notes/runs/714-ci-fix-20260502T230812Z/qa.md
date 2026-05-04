# QA Notes

Validate the two affected smoke specs:
- tests/smoke/edit-schedule-calendar-import.spec.js
- tests/smoke/edit-schedule-calendar-cancelled-import.spec.js

Expected coverage: imported practice rows render, cancelled imported rows remain visible without actions, season record fields hydrate/persist, and addGame is called for new league games.
