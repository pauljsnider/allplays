# Code Plan

- Inspect PR branch call sites for removed helper references.
- Replace the stale login submit handler call with `redirectCoordinator.getPostAuthRedirect(...)`.
- Run targeted tests and a repository search to verify the stale symbol is gone.
