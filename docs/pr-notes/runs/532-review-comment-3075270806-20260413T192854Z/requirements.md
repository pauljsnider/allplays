## Objective
Preserve the correct on-field player after a substitution is saved and the page reloads, using stable player identity rather than mutable display name. The fix should be as small as possible and still work when two players share a name or a player is renamed later.

## User/Roster Risk
- Coaches can make the wrong next substitution if the field view reloads with the wrong player in a position.
- Stats, playing-time decisions, and live-game trust can attach to the wrong player.
- Parents lose confidence quickly if the app shows the wrong child on the field.
- Duplicate names, preferred-name changes, and midseason roster edits are normal in youth sports, so this is a real game-day risk.

## Acceptance Criteria
1. After a coach records a substitution, reloads the page, and returns to the same period, the same player remains shown in that position.
2. If two rostered players have the same display name, a substitution for one of them does not resolve to the other after reload.
3. If a substituted player is renamed after the substitution is recorded, the app still restores the correct player after reload.
4. Subsequent substitutions in that period use the correct current on-field player, not a name-matched lookalike.
5. Existing planned lineups with no actual substitutions still behave exactly as they do today.
6. Older saved substitution records without stable player identity do not break the page and fall back safely.

## Assumptions
- Each rostered player already has a stable unique player ID available in game-day state.
- This PR should prefer a minimal, low-risk patch over a broader rotation-data redesign.
- Historical `rotationActual` entries may exist with names only, so backward-safe handling matters.

## Open Questions
- Forward-only additive support plus graceful fallback is sufficient for this PR. No migration is included.
- Internal correctness is the priority for this fix. UI duplicate-name disambiguation can be handled separately if needed.
- If a stored player ID no longer resolves because the player was removed, current logic should fail safe by preserving the prior assignment instead of guessing.
