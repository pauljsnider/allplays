# Code Plan

Subagent spawning with role-specific agents was unavailable in this runtime, so this note captures the inline code plan.

## Implementation Plan
1. In `syncSharedScheduleCounterpart`, introduce `createdCounterpartRef` initialized to `null`.
2. Set it only when `addDoc` creates a new counterpart.
3. Wrap the final `updateDoc(sourceRef, buildSharedScheduleSourceUpdate(...))` in `try/catch`.
4. On failure, delete `createdCounterpartRef` if present, log cleanup failure non-fatally, and rethrow the original error.
