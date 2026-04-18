# Architecture

## Root Cause
The parent dashboard day modal rebuilt its event list from `getFilteredScheduleEvents()`, which applies the upcoming/past cutoff. In CI, the shared game fixture sits in the past relative to runtime, so the modal resolves to an empty day and drops the grouped RSVP buttons.

## Decision
Keep the existing schedule filters for the main schedule surfaces, but make the day modal fall back to matching calendar events from `allScheduleEvents` when the filtered view returns none for the selected day.

## Minimal Change
Scope the fix to `parent-dashboard.html` only. Preserve selected-player filtering, grouped child IDs, and current RSVP rendering.

## Rollback
Revert the modal fallback block in `openScheduleDayModal` if unexpected modal-only event exposure appears.
