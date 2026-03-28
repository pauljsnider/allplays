# Architecture synthesis

- Root cause 1: `buildModuleSource()` depends on exact `import ... from './module.js?v=N';` strings, so any cache-buster or formatting change can leave raw ESM imports inside the `AsyncFunction` body.
- Root cause 2: the injected timeout stub calls the callback before returning the timeout handle, which inverts the ordering assumed by production code that assigns `liveSync.opponentTimeout = setTimeout(...)`.
- Control comparison:
  - Current: test harness fidelity depends on literal import versions and impossible synchronous timer behavior.
  - Proposed: regex-based import substitution normalizes version drift, and a queued timeout runner preserves the "handle assigned first, callback later" contract.
- Smallest viable change: replace the chained exact-string `.replace()` calls with a helper that rewrites imports by module specifier regex, then swap the timer stub for a small queued scheduler flushed by the test.
- Risk surface:
  - Low product risk because the patch is test-only.
  - Moderate harness risk if import regexes are too broad, so each pattern should stay anchored to full import statements and known specifiers.
- Rollback: revert the test harness file if this introduces any unexpected evaluation issue.
