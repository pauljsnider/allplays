# Requirements analysis

## Existing gap

`StandardTracker` has score, stat, event-log, and recovery-session behavior but no isolated note-draft workflow. Direct tracker access already fails closed unless the loaded event is an active database game, the user can update its score, and the game uses the legacy tracker engine. The game hub exposes the tracker through the same effective capability gate.

## Narrow workflow

1. **Closed:** show `Open note draft` only inside the authorized tracker.
2. **Editing:** show a labeled typed-fallback textarea, an `Unsaved note draft` status, `Start voice draft`, and `Discard draft`.
3. **Active:** keep the textarea editable, explain that microphone capture is not connected, and show `Stop voice draft` and `Cancel voice draft`.
4. **Review:** after stop, preserve the text and show `Edit note draft`, `Start voice draft`, and `Discard draft`.
5. **Cancel:** end only the active voice attempt and preserve typed content in editing state.
6. **Discard:** clear the text and close the workflow. No Save action belongs in this slice.

## Acceptance mapping

- Explicit semantic controls cover open, start, stop, edit, cancel, and discard.
- A persistent unsaved status and loss-on-navigation copy make the local-only lifecycle clear.
- Rendering under the existing `!accessDenied && config` branch prevents unauthorized access.
- Component memory is the only storage; no tracker, schedule, score, stat, event, note, or summary service is called.

## UX and accessibility

- Use native buttons with mobile-sized targets and a real textarea label.
- Announce phase changes with a polite status region.
- Do not rely on color alone to communicate unsaved or active state.
- State clearly that speech capture and audio retention are not part of this version.

## Risks

- Keep Cancel non-destructive and Discard destructive so sideline users do not lose typed notes unexpectedly.
- Do not reuse the nearby tracker-session or stat-event persistence paths.
- Reset naturally when the keyed user/team/game component unmounts or changes identity.
