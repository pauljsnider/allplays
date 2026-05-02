# QA

## Risk Matrix
- Medium: Public sponsor reads expose any sponsor document marked published in `teams/{teamId}/sponsors`, not only local-attraction placements. This is acceptable if published sponsor records contain only public-safe fields.
- Medium: `team.html` now performs an additional sponsor load during team page initialization. Failures must stay non-blocking.
- Low: Sponsor card rendering escapes text and normalizes website URLs to HTTP/HTTPS only.
- Low: Duplicate sponsor matches across supported publication queries are de-duped by document ID.

## Automated Validation
Targeted helper coverage exists in `tests/unit/local-attractions.test.js` for filtering, sorting, field fallback mapping, website URL normalization, and unsafe protocol rejection.

Validation command:

```bash
npx vitest run tests/unit/local-attractions.test.js --reporter=dot
```

Expected result: targeted unit tests pass.

## Manual Test Plan
1. Open `team.html?id={teamId}` logged out for a team with at least one published local-attraction sponsor.
2. Verify “Local Attractions” appears and cards render image, name, description, phone link, and safe website link.
3. Verify a team with no published local-attraction sponsors does not show an empty section.
4. Verify unpublished local-attraction sponsors do not render for anonymous users.
5. Verify published sponsors without local-attraction placement do not render.
6. Verify malformed, `javascript:`, and non-HTTP URLs do not render as website links.
7. Confirm existing team page sections still render: header, schedule, tournament standings, playing time insights, and chat counts.

## Release Gate
Amazon Q found no blockers. Before merge, run the targeted unit test and perform one browser spot check against representative sponsor docs if a Firebase environment is available.
