# Code Role Plan

## Plan
1. Patch `js/utils.js` recurrence block to remove UTC/local mixing.
2. Keep weekly interval math anchored to week boundaries using consistent local day-of-week values.
3. Preserve existing recurrence behavior outside the reviewed logic.
4. Run recurrence unit test to validate no regression in interval handling.

## Fallback
If tests are unavailable in this workspace, provide exact command attempted and failure output in run notes.
