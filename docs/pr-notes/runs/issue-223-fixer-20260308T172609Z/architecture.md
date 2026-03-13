# Architecture role

- Data model: top-level `athleteProfiles/{profileId}` document with `parentUserId`, `athlete`, `bio`, `privacy`, `clips`, `seasons`, `careerSummary`, `createdAt`, `updatedAt`.
- Control equivalence: source player private docs stay untouched; public page reads only `athleteProfiles`.
- Aggregation path: on save, resolve allowed seasons from `users/{uid}.parentOf`, fetch each selected team's games plus `aggregatedStats/{playerId}`, and persist precomputed totals/averages to the profile document.
- Share model: `privacy == "public"` readable by anyone; `privacy == "private"` readable only by owner.
- Blast radius: limited to a new collection, one builder page, one public page, one parent-dashboard link, and one pure helper module with tests.
