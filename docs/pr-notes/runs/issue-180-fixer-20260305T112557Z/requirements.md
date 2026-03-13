# Requirements role synthesis (local fallback)

## Constraint
Allplays has no bracket entity, seeding model, auto-advance logic, or publication state. Tournament workflows currently rely on plain game metadata.

## Decision
Implement a minimal bracket management domain that supports:
- seeded single-elimination bracket creation
- winner/loser source rules per slot
- result reporting with auto-advancement
- explicit draft/published workflow and public-safe read model

## Success criteria
- Admin can create bracket model with seeded slots.
- Completing a bracket game can auto-advance teams to downstream slots.
- Publish action flips bracket to published state and exposes stable published payload.
- Existing schedule/game workflows remain backward compatible.

## Assumptions
- Initial scope is single-elimination brackets.
- Bracket game resolution is driven by explicit game result payloads.
- UI-heavy bracket editor is out of this minimal patch; API/domain support is prioritized.
