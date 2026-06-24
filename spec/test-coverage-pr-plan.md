# Test Coverage PR Plan

This plan breaks the repo-wide test expansion into reviewable PRs. Each feature PR should add the right mix of unit, integration, and workflow coverage, then fix bugs found while writing the tests.

## Guardrail PR

1. Coverage map and gap reporter
   - Add `tests/coverage/feature-coverage-map.json` as the feature-to-surface inventory.
   - Add `scripts/report-test-coverage-map.mjs --check` to fail when a shipped HTML page, React page file, or Cloud Function export is not assigned to a feature area.
   - Keep known gaps visible without failing the check, so follow-up PRs can close them incrementally.

## Feature PRs

2. Auth, invites, account recovery, and profile
   - Cover reset/verify page boundaries, invite acceptance, signed-in redirects, account merge preview/confirm, and access-code redemption.

3. Schedule, calendar, RSVP, availability, and reminders
   - Cover schedule sharing, ICS feeds, recurring RSVP, public RSVP tokens, availability panels, import/cancel flows, and notification payloads.

4. Registration, provider sync, and checkout retry
   - Cover registration editor parity, Sports Connect/manual provider sync, public registration capacity states, checkout retry/cancel, and failed-payment reminders.

5. Teams, roster, settings, discovery, and player profile
   - Cover roster contact import, AI roster import, public team browsing, staff permissions, team rollover, athlete profile fields, and home dashboard flows.

6. Team fees, installments, payment reminders, refunds, and team pass
   - Cover paid-recipient cancellation blocking, parent fee states, installments, Stripe checkout/webhooks/refunds, and unpaid reminders.

7. Messaging, notifications, email, inbox, and device tokens
   - Cover mention and mute behavior, unread state, email drafts/templates/send queue, notification recipient indexes, inbox mark-read, and stale-token cleanup.

8. Media, athlete media, certificates, awards, and publish/export
   - Cover media upload/fallback, staff albums, pagination, media notification batches, certificate direct links, publish, and export flows.

9. Game day, tracking, live stats, statsheet, replay, and scoreboard
   - Cover tracker undo, opponent stats, statsheet review defaults, live tracker/watch replay, score updates, game reports, and scoreboard widgets.

10. Parent tools, family share, rideshare, and practice packets
    - Cover family share anonymous access, household invites, parent tools panels, rideshare offers/claims/cancel, and practice packet reminders.

11. Officials, organization schedule, tournaments, and drills
    - Cover officiating claim/results flows, open-slot notifications, organization schedule publish, tournament metadata, drills picker, and practice planning.

12. Help, workflow, and static page coverage
    - Add a static workflow-page sweep so every help and workflow page boots, has valid internal links, and keeps mobile navigation usable.

## Validation Pattern

Each PR should run targeted unit tests, targeted app/function tests where applicable, `npm run app:build` when React code changes, targeted Playwright smoke tests for changed workflows, and the coverage-map check.
