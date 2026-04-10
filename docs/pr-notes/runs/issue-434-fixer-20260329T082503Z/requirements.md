# Requirements Role

## Objective
Close the parent dashboard coverage gap for multi-child incentive packet behavior.

## Current State
- Practice packet rows are built per session with all linked children attached to a shared row.
- The player filter limits which rows render, but not which children render inside a visible row.
- Existing coverage does not assert multi-child packet counts, child buttons, or child-specific completion state.

## Proposed State
- Multi-child packet rendering respects the selected child when a specific player filter is active.
- Packet completion UI remains child-specific and optimistic updates only affect the selected child.
- Tests cover both all-player and single-player filter states for packet counts, labels, and completion controls.

## Risk Surface
- Parent-facing workflow.
- Wrong child scoping is user-visible and can create incorrect trust in incentive progress.
- Blast radius is limited to parent dashboard packet rendering and completion UI state.

## Assumptions
- Unit coverage is the repo-standard path for this regression.
- Existing completion writes are already keyed by `sessionId + childId`; the main product bug is render scoping.
- The issue-fixer lane does not have access to the requested external subagent runtime, so this note is the direct substitute artifact.

## Recommendation
Use a shared helper that derives the visible children, names, and completion counts from a row plus selected player id. Reuse it in packet card rendering so the filter affects denominator, labels, and buttons consistently.
