# Requirements Role (allplays-requirements-expert equivalent fallback)

Requested orchestration skill `allplays-orchestrator-playbook`, role skill `allplays-requirements-expert`, and `sessions_spawn` are unavailable in this runtime. This artifact captures equivalent requirements analysis.

## Objective

Add automated coverage for the Parent Dashboard rideshare modal flow where a multi-child parent selects a specific child, requests a spot, and can later cancel from the rerendered modal state.

## Current State

- Parent Dashboard rideshare coverage is limited to helper and wiring tests.
- The user-facing flow depends on inline modal rendering and several async write handlers.
- Multi-child selection state is high risk because modal events are aggregated per event/day, not per child row.

## Proposed State

- Add automated tests for child-specific request and cancel behavior using the repo's existing Vitest framework.
- Make the child selection logic deterministic so the modal prefers the child that already has the parent's request.
- Preserve the active child selection across the request write and modal rerender path.

## Assumptions

- Vitest is the supported automated framework in this branch, despite the issue text referencing Playwright.
- A targeted extraction into a small JS module is acceptable if it improves testability without changing UX.

## Success Criteria

- A test proves the request path submits child B when child B is selected.
- A test proves cancel triggers the backend call and rerender path.
- The modal state resolves to the child with the parent's existing request instead of defaulting to the first child.
