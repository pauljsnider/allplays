# Code Plan

1. Update the existing dependency contract to require Firebase `12.17.0` everywhere and all four pnpm peer bindings.
2. Run it against the current `12.16.0` state and confirm the expected failure.
3. Regenerate only `package.json`, `package-lock.json`, `apps/app/package.json`, `apps/app/package-lock.json`, and `apps/app/pnpm-lock.yaml` for exact Firebase `12.17.0`.
4. Reject unrelated package-manager churn.
5. Run the focused contract, runtime tests, peer-resolution checks, frozen pnpm resolution, and React build.
6. Commit the six targeted dependency/test files plus these required role artifacts.

Root cause: Firebase is pinned in two manifests and represented in three lockfiles, so a partial maintenance update can leave npm and pnpm or peer-qualified snapshots inconsistent. Prevention: treat shared dependency changes as one atomic manifest-and-lockfile cohort guarded by a deterministic contract test. Recurrence risk is low after the contract covers every representation.
