# Practice Command Center UX Parity Checklist

Reference mock: `mockups/practice-command-center.html`
Implementation target: `drills.html`
Reviewed on: 2026-02-16

## Planning Mode

- [x] Three-column planning composition (Context Rail, AI Coach, Practice Canvas)
- [x] Mode toggle bar with Planning / Practice / Drill Library
- [x] Session metadata controls (date, duration, save/start)
- [x] Practice timeline cards with type badges and duration controls
- [x] Add drill CTA and Home Packet CTA

## Drill Library

- [x] Library tabs (Community, My Drills, Favorites)
- [x] Filter/search row (type, level, skill, search)
- [x] Drill cards include type badge, summary, skills, favorite toggle
- [x] Drill detail side panel with add/edit/delete/custom ownership controls
- [x] Create/edit drill modal in same visual language as mock

## Practice Mode

- [x] Big timer centered with high-contrast controls
- [x] Next Drill CTA with upcoming drill metadata
- [x] Session progress indicator
- [x] Voice note action
- [x] Live attendance panel in practice mode with present/late/absent controls

## Schedule-Linked Workflow

- [x] `edit-schedule.html` provides Plan Practice action for practice events
- [x] Plan action routes to `drills.html#teamId=...&eventId=...&source=edit-schedule`
- [x] Event-linked sessions load/create without cross-event overwrite
- [x] Schedule rows show linked plan summary (status, blocks, duration)

## Intentional Deviations

- Practice Mode includes an expanded attendance module and summary badge not present in the original mock; this is intentional per updated requirements (Req 2.3.5-2.3.6, US-15).
