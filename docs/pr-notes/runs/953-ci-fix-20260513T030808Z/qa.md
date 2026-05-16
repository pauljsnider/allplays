# QA Notes

Failing assertions all share the same symptom: `#schedule-list` remains empty and submit does not call `addGame`. That is consistent with a boot-time module import failure, not with calendar merge logic or season record logic.

Validation should run the focused edit-schedule smoke spec and, with a local server for baseURL-backed specs, the cancelled import smoke spec.
