# Requirements Notes

- Thread: PRRT_kwDOQe-T586A1SNn
- Acceptance: `getUpcomingLiveGames` must not throw when `status` is a truthy non-string legacy Firestore value.
- Acceptance: Existing excluded string statuses remain excluded: `completed`, `cancelled`, `canceled`, `deleted`, case-insensitive.
- Acceptance: Malformed or non-string statuses should not be treated as excluded by this helper; they should flow through existing date/type/liveStatus filtering.
