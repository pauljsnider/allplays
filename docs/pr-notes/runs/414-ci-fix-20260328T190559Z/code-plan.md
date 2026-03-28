Change plan:
1. Patch `.github/workflows/deploy-preview.yml` prune loop.
2. Wrap `hosting:channel:delete` in targeted error handling.
3. Ignore only missing-channel 404/not-found responses.
4. Keep non-404 failures fatal and visible in stderr.
5. Validate workflow file locally with line inspection and git diff.
