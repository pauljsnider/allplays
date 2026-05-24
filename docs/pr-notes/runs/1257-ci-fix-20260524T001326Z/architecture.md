# Architecture Notes

## Root cause hypothesis
`cache-bust-guard` reads the full PR diff with `git diff --unified=0 origin/master...HEAD`. PR #1257 has very large dependency and app changes, especially lockfile churn, so Node's default `execFileSync` buffer overflows before the guard can evaluate the actual cache-bust rules.

## Minimal fix direction
Avoid loading the full diff unless a critical cache-busted source file changed. Use `git diff --name-only` first, identify relevant cache-bust rules, and only inspect targeted diffs for those files.

## Risk and rollback
The change is isolated to CI guard tooling. Rollback is reverting the script change if guard behavior regresses.
