## Requirements Role

Thinking level: medium
Reason: narrow bug fix in an existing import workflow with user-visible retry risk.

Objective:
- Prevent users from seeing a generic CSV import failure after rows were already created.

Current state:
- Row persistence already tracks partial success and keeps failed rows for retry.
- A later `loadSchedule()` failure can still collapse the batch into a generic error after persisted rows exist.

Proposed state:
- Treat post-persist refresh failures as warnings.
- Preserve failed-row retry context when partial success already happened.

Risk surface and blast radius:
- Affects only the CSV import completion path in `edit-schedule.html`.
- Main risk is misleading users into retrying already-created rows and creating duplicates.

Acceptance criteria:
- If any rows persist and the post-import schedule refresh fails, the UI reports imported rows explicitly.
- If some rows failed, those failed rows remain in the preview for retry even when refresh fails.
- Full-success imports never fall back to a generic batch failure because of refresh only.
