Test focus: confirm the Edit Team page references a versioned `team-access.js` import and no unrelated behavior changes were introduced.

Checks:
- Verify `edit-team.html` imports `./js/team-access.js?v=1`.
- Verify the imported symbols still match the module exports: `hasFullTeamAccess`, `normalizeAdminEmailList`.
- Review diff scope to ensure only the review-driven change plus required note files were added.

Manual validation plan:
- Serve the repo locally.
- Open `edit-team.html` and confirm the page loads without module import errors.
- In devtools network tab, confirm the module request URL includes `?v=1`.
