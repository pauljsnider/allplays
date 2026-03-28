Plan:
1. Add a smoke test for the platform-admin Edit Configs workflow using existing route-stub patterns.
2. Tighten unit wiring expectations so `edit-config.html` is explicitly pinned to the shared access helper import.
3. Apply a minimal runtime hardening change in `edit-config.html` so the platform-admin-aware helper is cache-busted on deploy.
4. Run targeted unit and smoke validation.
5. Commit tests and code together with an issue-referencing message.
