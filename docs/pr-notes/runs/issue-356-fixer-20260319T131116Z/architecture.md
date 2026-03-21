Objective: preserve footer support-link behavior at the user-visible HTML boundary and ensure CI executes the corresponding smoke guard.

Current state:
- The homepage ships its own footer markup in `index.html`.
- Most other pages rely on the shared `renderFooter(container)` helper in `js/utils.js`.
- Smoke workflows target one bootstrap spec explicitly, leaving any new smoke specs inert.

Proposed state:
- Keep footer destinations unchanged.
- Add browser coverage against both footer implementations: static homepage footer and shared rendered footer.
- Change smoke workflows to invoke the smoke suite so future footer regressions are caught in PR, post-deploy, and scheduled smoke lanes.

Blast radius:
- `tests/smoke`
- `.github/workflows/*smoke.yml`
- documentation artifacts under `docs/pr-notes/runs/...`

Controls:
- No runtime footer behavior changes.
- No auth, Firestore, or routing logic changes.
- Shared-footer guard uses a public page and checks only stable footer links.

Rollback:
- Revert the smoke spec and workflow command changes in one commit if the suite introduces unexpected flakiness.
