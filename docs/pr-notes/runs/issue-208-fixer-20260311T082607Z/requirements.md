# Requirements role

- Objective: recurring ICS events must remain visible as separate schedule items until each occurrence is individually tracked into Firestore.
- User impact: coaches, parents, and shared calendar viewers need all weekly practices or games from a single `VEVENT` + `RRULE`, not just the first or the untracked subset collapsed by master `UID`.
- Acceptance criteria:
  - recurring ICS feeds render one item per generated occurrence in `edit-schedule.html`, `calendar.html`, and `parent-dashboard.html`
  - tracking one occurrence does not hide future occurrences from the same series
  - existing single-instance ICS events still de-duplicate correctly when tracked

