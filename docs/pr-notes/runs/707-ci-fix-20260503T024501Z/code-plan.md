# Code Plan

## Root Cause
- Critical Firebase runtime modules changed without corresponding cache-bust import updates visible in the PR diff.
- The guard failed because stale browser module URLs could continue loading old runtime Firebase config code.

## Implementation Plan
- Bump cache-bust query strings for imports that load the changed critical modules.
- Include `js/team-pass.js` because it introduced a Firebase dependency in this PR.
- Validate with the cache-bust guard and affected unit test.
