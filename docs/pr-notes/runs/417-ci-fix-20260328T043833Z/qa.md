# QA

- Root cause evidence: CI log shows `unexpected token "\\"` at escaped quotes inside the jq expression.
- Validation plan: inspect workflow, run a local syntax-level reproduction against jq-compatible filter quoting, then confirm git diff is scoped.
- Residual risk: no full GitHub Actions run locally, so final confirmation depends on CI rerun.
