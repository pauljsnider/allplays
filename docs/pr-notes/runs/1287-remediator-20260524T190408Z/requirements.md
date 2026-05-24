# Requirements

Acceptance criteria:
- Only one team-fee checkout request may be in flight at a time.
- A second click while any checkout is pending must not call Stripe again.
- The selected fee still shows scoped loading text.
- Other unpaid fee buttons are disabled during the pending checkout without showing the selected fee loading label.
- On success or failure, pending state clears and existing error behavior is preserved.
