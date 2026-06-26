# Architecture

## Current State
- Tournament creation was embedded inline in the Manage schedule tools area once opened.
- There was no separate shell/modal open state and no dismiss control that returned to the prior state.

## Proposed State
- Keep the tournament entry point in Schedule staff tools.
- Open a local modal shell for tournament creation.
- Cancel or dismiss resets local draft state and closes the shell.

## Architecture Decisions
- Use transient component state only.
- Reuse existing tournament form component inside a modal wrapper.
- Preserve existing team-staff gating and tracker-config loading.

## Risks / Blast Radius
- Low. Scope is limited to Schedule UI state and focused tests.

## Rollback
- Revert the Schedule page modal wrapper and entry-point wiring.
