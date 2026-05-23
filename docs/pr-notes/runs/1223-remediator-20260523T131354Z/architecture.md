# Architecture

- Keep the screening decision isolated in `js/volunteer-screening-access.js` and the data-loading error boundary in `js/db.js`.
- Use conservative text matching against app-written registration fields rather than adding a schema migration.
- Re-throw caught data-access errors after logging to preserve existing caller behavior and avoid accidental access grants when registration data is unavailable.
