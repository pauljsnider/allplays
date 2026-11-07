# Requirements analysis

The named `allplays-requirements-expert` skill was unavailable, so the role used the issue contract and repository evidence.

## Root cause

The React Register tab models only currently published registration forms. Submitted applications have a separate lifecycle, but the tab has no application-history state or service call, so closing or unpublishing a form removes the parent's only in-app representation of the submission.

## Required behavior

- Add a separate **Submitted applications** section without changing published-form cards or their Review, Legacy form, and Share actions.
- Show player, program, team, optional selected option, and the service-provided normalized status label.
- Never gate application visibility on the published-form list and never render decision or status-mutation controls.
- Distinguish initial loading from a successful empty result.
- Append pagination results, deduplicate by stable application identity, and keep newer results first.
- Preserve successful cards across thrown, query, or enrichment failures; retry the failed cursor.
- Keep loading, error, and retry behavior for applications independent from published forms.

## UX guardrails

- Use a semantic section heading and real buttons for Retry and Load more.
- Keep status text readable without relying on color, and state that status is read-only.
- Keep prior cards visible during pagination and retry; disable duplicate requests in flight.
- Omit the option row when the option label is empty.

## Scope

No Firestore query, rules, indexes, submission, checkout, payment, staff review, or mutation changes. Consume the focused `parentRegistrationsService` boundary only.
