# QA role notes
- Run targeted unit tests for invite flow.
- Validate expected behavior:
  - admin invite calls atomic redemption dependency and returns dashboard redirect.
  - errors from atomic redemption bubble up.
- Manual smoke (if needed): accept invite with valid/used/expired admin code paths.
