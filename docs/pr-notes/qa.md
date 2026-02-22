# QA Role Notes (Issue #28)

## Objective
Validate issue #28 behavior across drill form, library tabs, planning canvas, and practice mode.

## Validation Matrix
1. Resource URL behavior
- Create/edit drill with YouTube URL: confirm embed renders in Drill Detail.
- Create/edit drill with non-YouTube URL (e.g., kinoli): confirm clickable external resource link renders.

2. Instruction linkification
- Put URL in Instructions text and confirm it renders as clickable hyperlink in Drill Detail.

3. Diagram upload fallback
- Verify diagram upload still succeeds in normal path.
- Verify fallback path code exists for `storage/unauthorized` / `storage/unauthenticated` to main storage.

4. Community visibility
- Mark custom drill `publishedToCommunity = true` and confirm it appears in Community tab results.

5. Cross-team My Drills
- With access to multiple teams, confirm My Drills tab shows aggregated drills from accessible teams.

6. Free Text block
- Add Free Text block, edit title/notes/duration, save draft, reload session, confirm block persists.

7. Practice Mode drill access
- In practice mode with linked drill block, confirm “View Drill Details” opens drill modal.
- On non-linked block (Free Text), button hidden.

## Evidence Run (this PR)
- Automated: `./node_modules/.bin/vitest run` (existing unit suite in repo)
- Static/manual verification performed via code-path review for all issue #28 requirements.

## Residual Risk
- Community merged feed currently paginates seeded community results only; very large published custom sets may require follow-up paging enhancement.
