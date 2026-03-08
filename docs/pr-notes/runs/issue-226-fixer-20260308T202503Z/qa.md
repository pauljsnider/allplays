Coverage target:
- Reproduce the ambiguous same-team sibling case in a unit seam.
- Prove single-child teams still allow one-click submission.
- Prove invalid or missing child selection is rejected when multiple linked children exist.

Planned validation:
- `tests/unit/calendar-rsvp.test.js`
- `tests/unit/parent-dashboard-rsvp.test.js`

Manual spot checks after code change:
1. Parent with one linked child on a team can still RSVP from the calendar with one click.
2. Parent with two linked children on the same team sees a child selector before submitting.
3. Selecting Child A and clicking Going writes only Child A through the per-player RSVP path.
4. Selecting Child B later does not overwrite Child A's prior response.

Residual risk:
- Calendar still renders one team event card, so the button highlight remains a simplified view for multi-child families until the page gains full per-child hydration.
