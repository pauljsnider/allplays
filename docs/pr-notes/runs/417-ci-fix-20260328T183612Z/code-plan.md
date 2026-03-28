Skills note: `allplays-orchestrator-playbook`, `allplays-architecture-expert`, `allplays-qa-expert`, and `allplays-code-expert` were not available in this session, so analysis was done inline.

Plan:
1. Edit `.github/workflows/deploy-preview.yml` in the prune loop only.
2. Capture delete output to a temp file and inspect failures.
3. Continue when the failure is the known missing-channel `404`; otherwise print the captured error and exit 1.
4. Run focused validation on the workflow file and commit the scoped fix.
