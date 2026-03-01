# QA role notes

Test focus:
- `shouldUpdateChatLastRead` returns true only when user+team context and active-view conditions are true.
- Returns false when page hidden or window unfocused.
- Verify suite passes in affected unit file.

Regression concern:
- Prevent clearing unread state while user is away from visible/focused chat page.
