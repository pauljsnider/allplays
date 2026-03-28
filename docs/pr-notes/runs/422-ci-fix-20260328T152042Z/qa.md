# QA notes

- Validate by inspecting workflow syntax and running the jq expression locally through `jq` with representative data.
- Repo has no automated test suite; use targeted command-level validation for the affected workflow snippet only.
- Risk: none to deployed app; only PR comment reporting could regress if expression is malformed.
