Objective: validate the deploy-preview CI fix locally as far as the environment allows.

Evidence:
- CI log shows Firebase deploy succeeded and provided `PREVIEW_URL`.
- Failure occurs at jq parse time with `unexpected token "\\"`.

Targeted validation:
- Confirm the workflow now contains an unescaped jq filter string.
- Run the filter through local `jq` with representative JSON to verify it selects the expected comment id.

Risk:
- No automated test suite exists for GitHub Actions in this repo.
- Validation is limited to syntax and command-shape correctness.

Success criteria:
- Local jq evaluation succeeds with the same filter logic.
- Git diff is scoped to the workflow and required run notes only.
