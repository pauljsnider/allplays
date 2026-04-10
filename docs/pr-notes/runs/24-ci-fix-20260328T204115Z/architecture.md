Objective: fix CI syntax failure caused by duplicate calendar tracking-id declaration.
Current state: unit test import graph fails before executing 13 suites due to duplicate identifier in JS module.
Proposed state: single canonical helper export/import path, no duplicate declaration, minimal blast radius limited to calendar/ICS helpers.
Risk surface: low, parser-level fix in shared calendar utility module; blast radius includes ICS parsing, calendar fetch, live-game importers that depend on the module.
Assumptions: preview-smoke failures are secondary to the same broken bundle/import state; local targeted tests will validate.
