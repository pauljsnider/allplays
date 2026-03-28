# Code plan

1. Open the workflow file containing the deploy preview comment step.
2. Replace the invalid escaped-quote jq expression with a valid single-quoted jq filter.
3. Validate the expression against sample JSON locally.
4. Stage changed files and commit with the required CI-fix message.
