# Code Plan

1. Edit `.github/workflows/deploy-preview.yml` to remove unnecessary backslash escaping inside the single-quoted `--jq` argument.
2. Verify the updated line and diff scope.
3. Stage workflow and note files, commit with required message.
