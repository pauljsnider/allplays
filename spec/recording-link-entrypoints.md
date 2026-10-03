# Recorded-game link entrypoints

Base: cf7b8936ab70453054e96524d30c66bf7a9913aa.

The existing replay implementation from #4831 is the canonical contract. An additional real Rules emulator check found pre-existing expression-budget failures for authorized replay writes; production persistence remains blocked pending separate diagnosis/review, and this UI PR does not change Rules. This change makes it discoverable from the legacy schedule list and edit form and the React/Capacitor game editor, and adds cancel/reset to the legacy report editor. It does not change permissions, lifecycle, persistence, scores, stats, or events.

## Paths and schema

- Legacy: Edit Schedule → Recording, or Edit → Edit recording link → game report recording editor.
- React web/iOS/Android: Schedule → game → Game → Edit recording link → YouTube replay editor.
- Both current overlay playback and legacy replay use the existing replay resolvers. Only validated exact YouTube videos produce canonical embeds.
- Store the existing `replayVideo` object: provider, videoId, embedUrl, publicUrl, status, linkedBy, linkedAt, optional title. Use existing guarded replay-only transactions and clear existing historical aliases through their established contract. Removal preserves the provider video and sets the existing fallback-disabled marker.
- A past date alone is not final. Existing Rules require final/completed lifecycle before linking. Shared schedule copies must be managed at the original canonical game. Never mark historical games final implicitly.
- Hosting deploy updates legacy and React web. Installed native bundles require a separate signed mobile build and store/TestFlight release; Hosting is not proof of installed-app delivery.

## Coordinated association plan (not executed)

1. Receive verified team ID, canonical game ID, exact YouTube video ID, matching evidence, lifecycle, visibility, and existing replay state from the read-only inventory owner. Fix an explicit bounded manifest; do not scan-and-write.
2. Re-read each target and current operator access. Reject nonfinal, shared, missing, ambiguous, conflicting, or changed records. Confirm visibility intentionally supports the intended viewers. Do not change visibility or lifecycle.
3. Record a private rollback journal containing the target, pre-write update time, complete prior replay archive state, intended canonical state, and non-replay preservation fingerprint. Keep identifying game data out of public PR artifacts.
4. Skip targets already associated to the exact video. Otherwise use the existing canonical replay-only transaction under the authorized principal, comparing all prior replay fields. Existing different recordings require a reviewed replacement decision.
5. After each bounded write, read back canonical replay metadata and the non-replay preservation fingerprint. A timeout is unknown: read back before retry. Stop on conflict or failed readback; do not continue blindly.
6. Verify both replay experiences resolve the exact video, including a fresh reload. Preserve a per-item outcome and rollback precondition.
7. Rollback only a write still matching this run's exact after-state, under the same access controls. Restore supported prior replay state through an approved path; if historical provider restoration is not supported by current Rules, stop for a separately reviewed recovery plan, never broaden Rules or use an admin bypass.

No associations, lifecycle changes, broadcasts, emails, or unrelated live writes are part of this PR.
