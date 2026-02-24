#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/nightly-playwright-smoke.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

FAKE_BIN="$TMP_DIR/fake-bin"
WORKDIR="$TMP_DIR/workdir"
STATE_DIR="$TMP_DIR/state"
LOG_DIR="$TMP_DIR/logs"
PLAN_FILE="$TMP_DIR/plan.md"
RUN_OUTPUT="$TMP_DIR/run-output.log"
mkdir -p "$FAKE_BIN" "$WORKDIR" "$STATE_DIR" "$LOG_DIR"

cat >"$WORKDIR/package.json" <<'JSON'
{"name":"tmp"}
JSON

echo "- [ ] todo" >"$PLAN_FILE"

cat >"$FAKE_BIN/npm" <<'EOF_STUB'
#!/usr/bin/env bash
exit 0
EOF_STUB

cat >"$FAKE_BIN/npx" <<'EOF_STUB'
#!/usr/bin/env bash
exit 0
EOF_STUB

cat >"$FAKE_BIN/jq" <<'EOF_STUB'
#!/usr/bin/env bash
echo '{}'
exit 0
EOF_STUB

cat >"$FAKE_BIN/rg" <<'EOF_STUB'
#!/usr/bin/env bash
# Return one unchecked task for count_open_tasks.
echo "1:- [ ] todo"
exit 0
EOF_STUB

cat >"$FAKE_BIN/flock" <<'EOF_STUB'
#!/usr/bin/env bash
exit 0
EOF_STUB

cat >"$FAKE_BIN/curl" <<'EOF_STUB'
#!/usr/bin/env bash
echo "curl: (7) failed Authorization: Bearer xoxb-secret-123 xoxb-leak-987" >&2
exit 7
EOF_STUB

chmod +x "$FAKE_BIN"/*

set +e
PATH="$FAKE_BIN:$PATH" \
STATE_DIR="$STATE_DIR" \
LOCK_FILE="$STATE_DIR/lock" \
LOG_DIR="$LOG_DIR" \
WORKDIR="$WORKDIR" \
TEST_PLAN_FILE="$PLAN_FILE" \
TEST_CMD="false" \
SLACK_NOTIFY_ENABLED="true" \
SLACK_NOTIFY_ON_SUCCESS="false" \
SLACK_BOT_TOKEN="xoxb-secret-123" \
SLACK_NOTIFY_CHANNEL="C1234567890" \
"$SCRIPT" >"$RUN_OUTPUT" 2>&1
script_exit=$?
set -e

if [[ "$script_exit" -ne 1 ]]; then
  echo "expected exit 1 from failed TEST_CMD, got $script_exit"
  cat "$RUN_OUTPUT"
  exit 1
fi

if ! grep -q 'slack notify failed: curl error (exit=7)' "$RUN_OUTPUT"; then
  echo "expected curl exit code 7 in logs"
  cat "$RUN_OUTPUT"
  exit 1
fi

if grep -q 'xoxb-secret-123' "$RUN_OUTPUT"; then
  echo "raw SLACK_BOT_TOKEN leaked in logs"
  cat "$RUN_OUTPUT"
  exit 1
fi

if grep -q 'Bearer xoxb' "$RUN_OUTPUT"; then
  echo "raw bearer token leaked in logs"
  cat "$RUN_OUTPUT"
  exit 1
fi

echo "PASS nightly-playwright-smoke token redaction + curl exit logging"
