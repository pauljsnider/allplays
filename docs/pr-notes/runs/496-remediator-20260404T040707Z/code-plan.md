Implementation plan:
1. Patch `mergeCalendarImportEvents` to guard `dbDate` before calling `getTime()`.
2. Run a targeted Node import/execution against the module to verify null dates no longer throw.
3. Stage changed files and commit with a short imperative message.
