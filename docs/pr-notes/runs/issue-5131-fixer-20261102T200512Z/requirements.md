# Requirements Analysis

> Fallback artifact: the requested requirements subagent was dispatched, but the runtime rejected the role before execution. This analysis was completed in the main lane from repository and issue evidence.

## User need

People who enter Help from a team need every related-workflow transition to remain inside that same team-scoped Help journey. Coaches and managers should not need to reconstruct the team or role filter after reading an adjacent article, and parents should not be shown the unfiltered Help catalog after following a related topic.

## Acceptance criteria

- From a workflow URL containing `context=team` and `teamId`, every link in the article's Related Workflows section carries those values.
- A present `role` value is carried with the team context.
- The destination article uses the carried values when rewriting its Back to Help Center link.
- Direct, non-team workflow visits remain unchanged.
- Context propagation is shared across workflow articles rather than hard-coded into one page.

## UX risk

Appending team context to unrelated or external links could disclose or misapply navigation state, so propagation should be limited to same-origin Back and Related Workflows links.
