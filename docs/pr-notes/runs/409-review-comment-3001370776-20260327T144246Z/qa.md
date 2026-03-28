## QA Role Summary

- Regression target: mixed replay batch containing `reset`, stale pre-reset stat event, and valid post-reset stat event.
- Coverage added: unit assertion that sequential filtering keeps `reset` plus post-reset events and drops stale pre-reset events in the same replay batch.
- Residual risk: browser-level replay UI was not exercised because this runtime lacks a working package manager/test runner installation.
- Suggested follow-up if needed: run the replay viewer manual seek scenario from `test-pr-changes.html` once toolchain access is restored.
