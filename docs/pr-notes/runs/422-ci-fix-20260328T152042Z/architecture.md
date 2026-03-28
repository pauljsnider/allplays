# Architecture notes

- Objective: fix deploy-preview PR comment step without changing deploy behavior.
- Current state: workflow passes a jq expression with backslash-escaped quotes to `gh api --jq`; `gh` parses it as invalid jq.
- Proposed state: use a valid jq expression string and keep comment upsert behavior unchanged.
- Blast radius: one GitHub Actions step in preview deploy reporting only; no runtime app impact.
- Assumptions: workflow uses `gh` built-in jq evaluator as shown in logs; failure is reproducible from the logged command.
