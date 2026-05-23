# Architecture Notes

## Root cause
The workflow failure occurred during `actions/checkout@v5`, before application code or the smoke test ran. Checkout could not fetch the PR merge ref because GitHub did not provide usable repository read credentials to the job.

## Minimal change
Add explicit top-level `permissions: contents: read` to `.github/workflows/regression-guards.yml` so checkout has the read scope it requires.

## Related smoke regression
Local validation also exposed that `edit-roster.html` eagerly imported Firebase AI modules on page load, which broke the roster fallback smoke test stubs before roster data could render. Lazy-loading the Bulk AI modules only when that tab/action is used preserves page-load behavior and keeps the smoke isolated.
