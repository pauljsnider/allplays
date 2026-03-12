Manual validation scope:
- Load `edit-schedule.html` and `parent-dashboard.html` through a local static server and confirm module imports resolve after the `utils.js` version bump.
- For a recurring ICS practice with existing offers under the legacy UID key, confirm the parent dashboard still shows offers.
- Confirm ride request, cancel, and offer close/reopen actions continue to work when the loaded offer came from the legacy UID path.
- Confirm a recurring ICS practice with no legacy offers can still create a new offer.

Residual risk:
- This is a fallback strategy, not a migration, so duplicate data could still exist if some environments already created offers under both keys.
