# Requirements

## Objective
Remove the stored XSS path in the organization shared matchup flow without changing how organization admins create shared games between teams in the same organization grouping.

## Acceptance Criteria
- Team names render in the Home Team and Away Team selects as plain text, not HTML.
- User-controlled team identifiers and names do not get injected through `innerHTML` in the organization schedule flow.
- Shared matchup publish success still shows links back to each team schedule.
- Existing organization schedule validation and schedule creation behavior remain unchanged.

## User/Risk Framing
- Organization admins, coaches, and program operators need the page to stay fast and familiar.
- A malicious team name must not be able to execute script in another admin's browser.
- The fix should not add new workflow steps or alter the publish flow.

## Out of Scope
- Broader sanitization across unrelated pages.
- Firestore schema changes.
- Changes to shared-game payload rules or schedule permissions.
