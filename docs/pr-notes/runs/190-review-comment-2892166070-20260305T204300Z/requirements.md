# Requirements Role Summary

## Objective
Remove hardcoded Firebase web credentials from version-controlled source while preserving existing app behavior for authenticated flows and image uploads.

## Current State
- `js/firebase.js` and `js/firebase-images.js` embed Firebase config objects directly in source.
- Review feedback flags this as CWE-798 hardcoded credentials.

## Proposed State
- Firebase config is resolved from runtime configuration (`window.__ALLPLAYS_CONFIG__`) or hosting-provided init endpoint.
- No Firebase API key/project identifiers are committed in main initialization modules.

## Risk Surface / Blast Radius
- Startup dependency shifts from static config to runtime config.
- Missing runtime config can break auth/storage initialization on affected pages.

## Acceptance Criteria
1. `js/firebase.js` and `js/firebase-images.js` contain no hardcoded Firebase config values.
2. Main app config supports runtime injection and Firebase Hosting `__/firebase/init.json` fallback.
3. Image app config requires explicit runtime injection and fails with clear error if absent.
4. Repo docs describe runtime config keys and locations.
