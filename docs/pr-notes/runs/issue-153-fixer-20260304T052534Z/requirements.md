# Requirements Role Synthesis

## Objective
Enable rideshare support for practice events on parent dashboard schedule views.

## Current State
Rideshare UI/data hydration is keyed to `isDbGame` events only.
Practice events sourced from non-DB schedule feeds are marked `type: practice` but `isDbGame: false`, so rideshare is hidden and not hydrated.

## Proposed State
Rideshare is available for:
- Any tracked DB event (`isDbGame: true`), and
- Practice events (`type: practice`) that have stable `teamId` + `id`.

## UX/Behavior Requirements
- Practice cards should show rideshare controls and summary similar to games.
- No change to RSVP gating for non-DB events.
- Cancelled events keep rideshare hidden.
- No change to permissions or backend path model.

## Risk Surface / Blast Radius
- Surface area: parent dashboard only.
- Data path remains existing `/teams/{teamId}/games/{eventId}/rideOffers`.
- Potential risk: exposing rideshare on malformed practice events without IDs. Mitigation: retain `teamId` and `id` guards.

## Assumptions
- Practice event IDs are stable enough across renders for offer retrieval.
- Firestore rules allow rideshare subcollections under event IDs used by practices.
