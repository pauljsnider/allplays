# Code Plan

1. Move `DAY_CODES` and `MS_PER_DAY` definitions to ICS recurrence constant block near `ICS_DAY_TO_INDEX`.
2. Add local helpers for calendar-day stepping and day-number comparison.
3. Update `expandRecurringICSEvent` loops:
   - daily: step with `setDate` helper
   - weekly: iterate days with `setDate` helper, compute week diff by day numbers, remove hard fixed-year cap
4. Return `occurrences` directly after expansion so EXDATE can produce zero items.
5. Remove duplicate late constant definitions to avoid redeclaration.
