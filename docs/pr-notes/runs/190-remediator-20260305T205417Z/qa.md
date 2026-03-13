# QA role notes

Validation focus:
- Static verification of recipient resolution path uses Admin SDK Auth lookup.
- Static verification that multicast sends iterate in chunks of 500 tokens max.
- Static verification that empty text + present image still produces a notification body.

Repo test guidance check:
- No automated test runner for Cloud Functions in this repo.
- Manual testing guidance is documented for frontend flows; no dedicated function test command provided in AGENTS.md.

Residual risk:
- Runtime behavior of Firebase calls is not exercised locally in this run.
