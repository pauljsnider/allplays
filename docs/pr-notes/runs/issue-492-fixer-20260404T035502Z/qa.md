Test strategy:
- Add browser coverage for two issue-defined flows on the real `edit-schedule.html` page.

Scenarios:
1. Imported practice row:
- load with `calendarUrls`
- mock one future untracked practice ICS event with `dtstart`, `dtend`, `uid`, and `location`
- switch to `Upcoming Practices`
- assert calendar/practice badges
- assert `Plan Practice` shows and `Track` does not
- assert generated `drills.html` hash includes `eventId`, `eventDate`, `eventDuration`, `eventLocation`, and `eventTitle`

2. Duplicate suppression and cancellation:
- mock one tracked UID, one event conflicting with a DB event within 60 seconds, and one cancelled import
- assert tracked/conflicting rows do not render
- assert cancelled row renders with `Cancelled`
- assert cancelled row has no action CTA

Validation:
- Run the focused Playwright spec.
- Run the existing unit calendar import test to guard helper behavior.
