# QA analysis

The named `allplays-qa-expert` skill was unavailable, so the role used the issue contract and repository evidence.

## Regression coverage

- Initial history loading is distinct from a successful empty state.
- Player, program, team, optional option, and all normalized labels render verbatim.
- An application renders when its form is absent from published results.
- Published-form cards retain Review, Legacy form, and Share actions.
- Load more sends the continuation cursor, appends older results, and deduplicates overlapping records.
- Returned partial/enrichment errors and thrown page failures retain successful cards and expose Retry.
- Retry targets the failed cursor and merges recovered results without duplicates.
- No application decision or status-mutation controls are present.

## Validation

Run the dedicated component test, the existing Parent Tools component test for mock compatibility, and the app build for strict TypeScript/import validation.

## Recurrence risk

Medium: history combines independent retained state, overlapping identity-query pages, cursor retry, and partial enrichment failures; a shared all-or-nothing loading model can easily regress it.
