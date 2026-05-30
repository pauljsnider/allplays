# Architecture

## Decision
Use a direct Firestore `getDoc(doc(db, 'teams', teamId))` read only for parent-home fallback teams that are not already loaded from the canonical site team list.

## Rationale
- Preserves the existing site-team discovery path and cache behavior.
- Adds canonical visibility validation only where fallback data is insufficient.
- Fails closed on missing or failed document reads to avoid visibility leaks.
- Reuses `isTeamActive()` and existing app-search authorization checks instead of inventing another lifecycle policy.

## Risk Controls
- No Firestore rules change required in this patch.
- Visibility policy remains centralized through `js/team-visibility.js`.
- Blast radius is limited to `apps/app/src/lib/searchService.ts` parent-home search fallback merging.
