# Requirements

## Problem
Parent-home app search fallback can surface teams that are not present in the site team list. If fallback metadata lacks canonical visibility fields, archived or inactive teams can leak into search.

## Acceptance Criteria
1. Parent-home fallback teams absent from `getTeams()` must be validated against the canonical `teams/{teamId}` document before app search adds them.
2. Active private parent-home teams remain searchable for the linked parent.
3. Fallback teams with `archived: true`, `active: false`, or inactive status values are excluded.
4. Missing or unreadable canonical team documents fail closed and are not added.
5. Existing site-list teams merge parent-home display data without duplicate results.
6. Regression tests cover active, archived, inactive, missing-doc, and cache fallback behavior.

## User Impact
Parents keep access to active private teams they are linked to, while archived or inactive season/team records stay hidden from app search.
