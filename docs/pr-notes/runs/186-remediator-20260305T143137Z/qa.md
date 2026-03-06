# QA Role Notes

- Regression target: Edit-team submit path selection while network is slow.
- Manual checks:
1. Open `edit-team.html?teamId=<valid-id>` with throttled network and quickly click Save.
2. Confirm code path uses update flow (no owner assignment/create flow side effects).
3. Open create mode (`edit-team.html` without `teamId`) and confirm create flow unchanged.
- Repo test guidance indicates manual validation only; no automated test runner available.
