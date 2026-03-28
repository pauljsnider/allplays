# Architecture Role Notes

## Current State
`canShowRideshareForEvent(event)` allows all practices regardless of source, causing non-DB ICS recurring instances to reuse a shared `uid`-based `id`.

## Proposed State
Restrict rideshare eligibility to DB-backed events only (`event.isDbGame === true`) while preserving existing cancellation/team/id guards.

## Blast Radius
Low. Scope is parent dashboard rideshare rendering/hydration only; no Firestore schema or utility-layer recurrence logic changes.
