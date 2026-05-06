## Requirements

- Re-import must preserve configured roster field imports when registration payloads include empty wrapper objects before populated later sources.
- Empty `submittedData` or `player` objects must not block fallback to supported later sources such as `submission`, `payload`, or `athlete`.
- Existing source priority remains unchanged when an earlier candidate is materially populated.
- Public/private roster field visibility behavior must remain unchanged.

## Acceptance Criteria

1. `submittedData: {}` falls through to populated later registration answer containers.
2. `player: {}` falls through to later populated player/athlete containers.
3. Configured public fields import into `payload.profile.customFields`.
4. Existing unrelated profile custom fields are preserved.
5. Admin/private field handling remains on the existing private roster field path.
