#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_PATH="$REPO_ROOT/scripts/nightly-playwright-smoke.sh"
TMP_DIR="$(mktemp -d)"
FAKE_BIN="$TMP_DIR/fake-bin"
FAKE_WORKDIR="$TMP_DIR/workdir"
STATE_DIR="$TMP_DIR/state"
LOG_DIR="$TMP_DIR/logs"
OUT_FILE="$TMP_DIR/run.out"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$FAKE_BIN" "$FAKE_WORKDIR" "$STATE_DIR" "$LOG_DIR"
cat >"$FAKE_WORKDIR/package.json" <<'JSON'
{"name":"fake","version":"1.0.0"}
JSON

cat >"$FAKE_BIN/npm" <<'EOF_NPM'
#!/usr/bin/env bash
exit 0
EOF_NPM

cat >"$FAKE_BIN/npx" <<'EOF_NPX'
#!/usr/bin/env bash
exit 0
EOF_NPX

cat >"$FAKE_BIN/rg" <<'EOF_RG'
#!/usr/bin/env bash
exit 0
EOF_RG

cat >"$FAKE_BIN/jq" <<'EOF_JQ'
#!/usr/bin/env bash
echo '{}'
exit 0
EOF_JQ

cat >"$FAKE_BIN/curl" <<'EOF_CURL'
#!/usr/bin/env bash
echo "curl: (22) sent Authorization: Bearer xoxb-real-secret-token" >&2
exit 22
EOF_CURL

chmod +x "$FAKE_BIN/"*

if PATH="$FAKE_BIN:$PATH" \
  WORKDIR="$FAKE_WORKDIR" \
  STATE_DIR="$STATE_DIR" \
  LOG_DIR="$LOG_DIR" \
  TEST_CMD=true \
  SLACK_NOTIFY_ENABLED=true \
  SLACK_NOTIFY_ON_SUCCESS=true \
  SLACK_NOTIFY_CHANNEL="C1234567890" \
  SLACK_BOT_TOKEN="xoxb-your-token-here" \
  "$SCRIPT_PATH" >"$OUT_FILE" 2>&1; then
  echo "script execution unexpectedly passed with placeholder token"
  cat "$OUT_FILE"
  exit 1
fi

if ! grep -Fq "invalid SLACK_BOT_TOKEN" "$OUT_FILE"; then
  echo "placeholder token validation did not trigger"
  cat "$OUT_FILE"
  exit 1
fi

if grep -Fq "if ! resp=\"\$(curl" "$SCRIPT_PATH"; then
  echo "legacy curl failure pattern still present"
  exit 1
fi

if ! grep -Fq "curl_exit=\$?" "$SCRIPT_PATH"; then
  echo "missing explicit curl exit-code capture"
  exit 1
fi

if ! grep -Fq "if [[ \"\$curl_exit\" -ne 0 ]]; then" "$SCRIPT_PATH"; then
  echo "missing explicit curl non-zero branch"
  exit 1
fi

if ! grep -Fq "trap 'exec 9>&-' EXIT" "$SCRIPT_PATH"; then
  echo "missing fd-9 close trap"
  exit 1
fi

if grep -n "bash -lc" "$SCRIPT_PATH" >/dev/null 2>&1; then
  echo "unexpected bash -lc usage in nightly script"
  exit 1
fi

echo "PASS: nightly smoke script validates placeholders and preserves hardening patterns"
