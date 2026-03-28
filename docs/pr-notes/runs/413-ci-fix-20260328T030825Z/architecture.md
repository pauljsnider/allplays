Skill status: `allplays-orchestrator-playbook` and role subagent skills were not available in this session, so analysis is inline.
Root cause hypothesis: GitHub Actions deploy-preview workflow uses a jq filter with backslash-escaped quotes inside a single-quoted shell string, causing gh jq parsing to fail after successful Firebase deploy.
