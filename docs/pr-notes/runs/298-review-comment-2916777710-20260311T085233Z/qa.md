## QA role summary

- Primary regression to guard: browser receives new HTML but serves cached older `utils.js`, causing missing named export failures.
- Validation targets:
  - `edit-schedule.html`
  - `parent-dashboard.html`
  - `game-plan.html`
  - `team.html`
- Evidence expected:
  - source assertions for `./js/utils.js?v=10` on all impacted pages
  - existing recurring ICS tracking tests still passing
