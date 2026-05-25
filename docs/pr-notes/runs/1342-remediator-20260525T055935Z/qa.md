# QA

## Automated coverage
- Running persisted clock still restores visible clock with elapsed wall-clock time.
- No local snapshot credits active lineup with full persisted running elapsed time.
- Same-device snapshot only credits elapsed time after local `savedAt`.
- Current local snapshot credits zero extra lineup time.
- Invalid local snapshot timestamp credits zero extra lineup time.
- Paused clock credits zero elapsed time.

## Targeted command
- `npx vitest run tests/unit/live-tracker-resume.test.js --reporter=verbose`
