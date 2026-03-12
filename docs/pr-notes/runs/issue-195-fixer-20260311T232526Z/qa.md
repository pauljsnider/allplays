Primary regression targets:
- Saving a draft should not mark the lineup as published.
- Publishing should increment version and reset read-state.
- `game-day.html` must wire a publish action and team notification call.

Manual smoke checks after unit tests:
- Open `game-day.html` for a game, build a lineup, save draft, refresh, confirm draft persists.
- Publish the lineup, refresh, confirm publish status/version persists.
- Publish again after edits and confirm version increments and a chat message appears.

Edge cases:
- Publishing without a selected formation should still block.
- Empty roster or missing parent links should not break recipient metadata generation.
- Republishing should compare against the previous published snapshot, not a null baseline.

Residual risk:
- No push/email delivery in this patch.
- Parent/player read-state is persisted but not yet surfaced in another page.
