#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_PATH="$REPO_ROOT/scripts/nightly-playwright-smoke.sh"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

mock_bin="$tmpdir/mock-bin"
workdir="$tmpdir/workdir"
state_dir="$tmpdir/state"
mkdir -p "$mock_bin" "$workdir" "$state_dir"
echo '{}' >"$workdir/package.json"

cat >"$mock_bin/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl: (7) failed to connect with Bearer xoxb-test-secret-token" >&2
exit 7
EOF
chmod +x "$mock_bin/curl"

cat >"$mock_bin/npm" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$mock_bin/npm"

cat >"$mock_bin/npx" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$mock_bin/npx"

output_file="$tmpdir/output.log"
set +e
env \
  PATH="$mock_bin:$PATH" \
  WORKDIR="$workdir" \
  STATE_DIR="$state_dir" \
  TEST_CMD="true" \
  SLACK_NOTIFY_ENABLED="true" \
  SLACK_NOTIFY_ON_SUCCESS="true" \
  SLACK_BOT_TOKEN="xoxb-test-secret-token" \
  SLACK_NOTIFY_CHANNEL="C1234567890" \
  bash "$SCRIPT_PATH" >"$output_file" 2>&1
script_exit=$?
set -e

if [[ "$script_exit" -ne 0 ]]; then
  echo "expected script to exit 0 when only Slack notify fails; got $script_exit"
  cat "$output_file"
  exit 1
fi

if ! rg -q 'slack notify failed: curl error \(exit=7\)' "$output_file"; then
  echo "missing expected curl exit code log"
  cat "$output_file"
  exit 1
fi

if rg -q 'xoxb-test-secret-token' "$output_file"; then
  echo "raw Slack token leaked in logs"
  cat "$output_file"
  exit 1
fi

if ! rg -q '\[REDACTED\]|\[REDACTED_SLACK_TOKEN\]|\[REDACTED_SLACK_BOT_TOKEN\]' "$output_file"; then
  echo "expected redaction marker not found"
  cat "$output_file"
  exit 1
fi

echo "nightly-playwright-smoke slack curl failure redaction test passed"
