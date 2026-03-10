Decision: move config defaulting to the UI selection phase, not the persistence phase.

Why:
- Submit-time fallback collapses two distinct states: "user explicitly chose none" and "new form inherited a default".
- The page already has a dedicated defaulting point in `loadConfigs()`, which is the correct place to express a recommendation without mutating saved data later.

Controls comparison:
- Previous behavior increased hidden state mutation and widened blast radius by silently assigning config IDs during edits.
- New behavior preserves auditability because persisted values now match the visible form state at submission time.

Tradeoff:
- If a future code path submits before `loadConfigs()` populates defaults, that path will now save `null` instead of inferring a config. That is preferable to silently overriding an explicit blank choice.

Rollback:
- Revert the helper rename and restore submit-time fallback in `edit-schedule.html`.
