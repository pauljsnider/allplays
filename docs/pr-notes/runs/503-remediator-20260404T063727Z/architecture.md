Current state vs proposed state:
- Current: values are serialized with `JSON.stringify()` and embedded directly into a JavaScript template literal that becomes the mock module source.
- Proposed: values are serialized to JSON, base64-encoded in the test runtime, embedded as inert ASCII, then decoded and parsed in the generated module.

Controls:
- Eliminates backtick and `${...}` breakout from the template literal context.
- Keeps generated source deterministic and local to the test.
- Avoids broad test harness changes.

Rollback plan: revert the helper and restore direct interpolation in this spec file.
