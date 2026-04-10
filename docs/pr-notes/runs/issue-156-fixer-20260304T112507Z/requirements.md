# Requirements Role Synthesis (Fallback)

## Objective
Ensure RSVP summaries count each player in exactly one availability bucket based on their latest effective RSVP.

## Current State
Summary aggregation counts RSVP documents and sums player counts per document. When a parent RSVP and coach override both exist for the same player, both are counted.

## Proposed State
Summary aggregation resolves an effective response per player by latest `respondedAt`, then computes totals from that per-player map.

## User/UX Requirements
- Parent and coach views show internally consistent counts.
- A single player never appears in multiple summary buckets.
- Coach override behavior should replace, not add to, prior parent response for that player.

## Acceptance Criteria
- For same player with parent + coach docs, only latest response counts.
- Summary total remains bounded by active roster size.
- Existing valid RSVP flows are unchanged for players without overlapping docs.
