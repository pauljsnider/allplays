Objective: validate the workflow change without broadening behavior.

Checks:
- Confirm the failing step matches the logged `404` on `hosting:channel:delete`.
- Ensure the new logic continues on `404`/`Not Found`.
- Ensure non-404 delete failures still exit non-zero.

Manual validation:
- Review the workflow shell block for `set -euo pipefail` compatibility.
- Run YAML parse check with `python3 -c 'import yaml'` fallback unavailable, so use `git diff --check` and direct file inspection.

Residual risk: Firebase CLI error wording could change; matching `HTTP Error: 404` and `Not Found` reduces that risk.
