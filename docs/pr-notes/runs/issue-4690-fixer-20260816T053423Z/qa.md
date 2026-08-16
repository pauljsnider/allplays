# QA Role

## 1. Risk Matrix

- High: private/admin fields cross the public boundary.
- High: scheduled, live, private, practice, deleted, mismatched, or non-public-team games enter standings.
- High: away games reverse names or scores.
- Medium: configured scoring/tiebreakers, dates, or tournament metadata are lost.
- Medium: malformed values create plausible incorrect standings inputs.
- Low: discovery/roster behavior or native standings behavior changes.

## 2. Automated Tests To Add/Update

Update `tests/unit/app-public-teams-service.test.ts` to cover:

1. Exact profile allow-listing and configured standings values.
2. Unsafe URL and malformed configuration normalization.
3. Completed home/away normalization, zero-score ties, and tournament metadata.
4. Table-driven exclusion of scheduled/live/private/practice/deleted/mismatched/malformed inputs.
5. Rejection of private profiles and public callable failures without fallback.
6. Complete multi-page projection loading and fail-closed malformed pagination.

Keep native standings source and tests unchanged.

## 3. Manual Test Plan

- Signed out: compare one public profile and completed home/away projections with source data.
- Admin: confirm configuration is present without privileged fields.
- Private team: confirm not-found and no canonical-game fallback.
- UI rendering is out of scope.

## 4. Negative Tests

- Reject every non-final/private/practice/deleted/mismatched projection class.
- Reject invalid dates, names, and scores while retaining zero-zero finals.
- Reject non-public profiles.
- Drop unsafe/credential-bearing URLs and unknown config/tournament fields.
- Reject missing/repeated pagination cursors.

## 5. Release Gates

- `npx vitest run tests/unit/app-public-teams-service.test.ts tests/unit/native-standings.test.js --reporter=verbose`
- Focused app typecheck if TypeScript surfaces adapter/type issues.
- No UI, query, publishing, cache-critical legacy module, or native-engine changes.

## 6. Post-Deploy Checks

- Request one public and one private team signed out.
- Compare one completed home, away, and tournament final.
- Confirm scheduled/live games do not appear.
- Monitor callable errors and projection pagination failures.
