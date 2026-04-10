Current state:
- `isBasketballConfig(configId)` looks up a config in `allConfigs`.
- If a config object exists, the helper returns a direct comparison on `(config.baseType || '').toLowerCase()`.
- That short-circuits fallback logic for incomplete config documents.

Proposed state:
- Normalize `config.baseType`.
- Only return config-derived truth when the normalized value is non-empty.
- Otherwise defer to `currentTeam.sport`.

Why this path:
- Smallest change that gets 80%+ of the value.
- Preserves existing behavior for valid configs.
- Keeps the fix localized to the shared helper already used by both routing entry points.

Controls:
- No data model change.
- No new dependencies.
- No broader routing refactor.

Rollback:
- Revert the helper change and the matching regression test if behavior proves incorrect.
