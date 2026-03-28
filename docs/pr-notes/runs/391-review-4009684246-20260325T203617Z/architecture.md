Decision: preserve the getter-based `createParentDashboardRsvpController` contract introduced by `eee4b13` and move the validation layer to match it.

Why: the getter keeps control equivalence with the prior inline code because it reads the live `allScheduleEvents` binding after `init()` hydration instead of capturing an empty array at controller construction time.

Controls: add a unit regression for schedule-array reassignment and a wiring assertion that `window.submitGameRsvpFromButton` is exported only after controller initialization, preventing the TDZ failure from reappearing silently.
Rollback: revert only the new test commit if needed; no product code changes are introduced in this pass.
