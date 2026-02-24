#!/usr/bin/env bash
set -euo pipefail

STATE_DIR="${STATE_DIR:-$HOME/.local/state/allplays}"
LOCK_FILE="${LOCK_FILE:-$STATE_DIR/nightly-playwright-smoke.lock}"
LOG_DIR="${LOG_DIR:-$STATE_DIR/nightly-playwright-smoke-logs}"
WORKDIR="${WORKDIR:-$HOME/.openclaw/workspace/allplays}"
TEST_CMD="${TEST_CMD:-npm run test:e2e:smoke}"
TEST_PLAN_FILE="${TEST_PLAN_FILE:-$WORKDIR/spec/playwright-coverage-plan-2026-02-21.md}"
SLACK_NOTIFY_ENABLED="${SLACK_NOTIFY_ENABLED:-false}"
SLACK_BOT_TOKEN="${SLACK_BOT_TOKEN:-}"
SLACK_NOTIFY_CHANNEL="${SLACK_NOTIFY_CHANNEL:-}"
SLACK_NOTIFY_FALLBACK_USER="${SLACK_NOTIFY_FALLBACK_USER:-}"
SLACK_NOTIFY_ON_SUCCESS="${SLACK_NOTIFY_ON_SUCCESS:-true}"
SLACK_LOG_TAIL_LINES="${SLACK_LOG_TAIL_LINES:-40}"

timestamp_utc() {
  date -u +'%Y-%m-%dT%H:%M:%SZ'
}

log() {
  printf '[%s] %s\n' "$(timestamp_utc)" "$*"
}

redact_sensitive() {
  local input="$1"
  local redacted="$input"

  if [[ -n "$SLACK_BOT_TOKEN" ]]; then
    redacted="${redacted//${SLACK_BOT_TOKEN}/[REDACTED_SLACK_BOT_TOKEN]}"
  fi
  # Best-effort masking for bearer tokens and Slack token formats in upstream errors.
  redacted="$(sed -E \
    -e 's/(Bearer[[:space:]]+)[^[:space:]]+/\1[REDACTED]/g' \
    -e 's/xox[baprs]-[A-Za-z0-9-]+/[REDACTED_SLACK_TOKEN]/g' <<<"$redacted")"
  printf '%s' "$redacted"
}

slack_api_post() {
  local endpoint="$1"
  local payload="$2"
  local resp stderr_file curl_err curl_exit

  stderr_file="$(mktemp)"
  if resp="$(curl -sS -X POST "https://slack.com/api/${endpoint}" \
    -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
    -H "Content-Type: application/json; charset=utf-8" \
    --data "$payload" \
    2>"$stderr_file")"; then
    curl_exit=0
  else
    curl_exit=$?
  fi
  if [[ "$curl_exit" -ne 0 ]]; then
    curl_err="$(cat "$stderr_file" 2>/dev/null || true)"
    rm -f "$stderr_file"
    if [[ -n "$curl_err" ]]; then
      log "slack notify failed: curl error (exit=${curl_exit}): $(redact_sensitive "$curl_err")" >&2
    else
      log "slack notify failed: curl error (exit=${curl_exit})" >&2
    fi
    return 1
  fi
  rm -f "$stderr_file"
  printf '%s' "$resp"
}

slack_notify() {
  local text="$1"
  local resp ok err dm_resp dm_chan

  [[ "$SLACK_NOTIFY_ENABLED" == "true" ]] || return 0
  if [[ -z "$SLACK_BOT_TOKEN" || -z "$SLACK_NOTIFY_CHANNEL" ]]; then
    log "slack notify skipped: missing token/channel"
    return 0
  fi

  resp="$(slack_api_post "chat.postMessage" \
    "$(jq -cn --arg ch "$SLACK_NOTIFY_CHANNEL" --arg t "$text" '{channel:$ch,text:$t}')")" || {
    return 0
  }

  ok="$(jq -r '.ok // false' <<<"$resp" 2>/dev/null || echo false)"
  if [[ "$ok" == "true" ]]; then
    return 0
  fi

  err="$(jq -r '.error // "unknown_error"' <<<"$resp" 2>/dev/null || echo unknown_error)"
  log "slack notify failed: $(redact_sensitive "$err")"

  if [[ "$err" != "not_in_channel" || -z "$SLACK_NOTIFY_FALLBACK_USER" ]]; then
    return 0
  fi

  dm_resp="$(slack_api_post "conversations.open" \
    "$(jq -cn --arg u "$SLACK_NOTIFY_FALLBACK_USER" '{users:$u}')")" || true
  dm_chan="$(jq -r '.channel.id // ""' <<<"$dm_resp" 2>/dev/null || true)"
  if [[ -n "$dm_chan" ]]; then
    slack_api_post "chat.postMessage" \
      "$(jq -cn --arg ch "$dm_chan" --arg t "$text" '{channel:$ch,text:$t}')" \
      >/dev/null || true
  fi
}

require_bin() {
  command -v "$1" >/dev/null 2>&1 || {
    log "missing required binary: $1"
    exit 1
  }
}

is_placeholder_value() {
  local value="${1:-}"
  local lowered
  lowered="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"

  [[ -z "$value" ]] && return 0
  [[ "$value" == "xoxb-your-token-here" ]] && return 0
  [[ "$value" == "C0123456789" ]] && return 0
  [[ "$value" == "U0123456789" ]] && return 0
  [[ "$value" == *"your-token-here"* ]] && return 0
  [[ "$lowered" == *"placeholder"* ]] && return 0
  [[ "$lowered" == *"example"* ]] && return 0
  [[ "$lowered" == *"changeme"* ]] && return 0
  return 1
}

validate_slack_settings() {
  [[ "$SLACK_NOTIFY_ENABLED" == "true" ]] || return 0

  if is_placeholder_value "$SLACK_BOT_TOKEN"; then
    log "invalid SLACK_BOT_TOKEN: set a real token instead of example/placeholder text"
    exit 1
  fi
  if is_placeholder_value "$SLACK_NOTIFY_CHANNEL"; then
    log "invalid SLACK_NOTIFY_CHANNEL: set a real channel ID instead of example/placeholder text"
    exit 1
  fi
  if [[ -n "$SLACK_NOTIFY_FALLBACK_USER" ]] && is_placeholder_value "$SLACK_NOTIFY_FALLBACK_USER"; then
    log "invalid SLACK_NOTIFY_FALLBACK_USER: set a real user ID or leave it empty"
    exit 1
  fi
}

count_open_tasks() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "n/a"
    return 0
  fi
  rg -n '^- \[ \]' "$file" | wc -l | xargs
}

mkdir -p "$STATE_DIR" "$LOG_DIR"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "nightly smoke job is already running; exiting"
  exit 0
fi
trap 'exec 9>&-' EXIT

validate_slack_settings

require_bin npm
require_bin npx
require_bin jq
require_bin curl
require_bin rg

if [[ ! -d "$WORKDIR" ]]; then
  log "WORKDIR does not exist: $WORKDIR"
  exit 1
fi

if [[ ! -f "$WORKDIR/package.json" ]]; then
  log "missing package.json in $WORKDIR"
  exit 1
fi

run_id="$(date -u +'%Y%m%dT%H%M%SZ')"
run_log="$LOG_DIR/nightly-playwright-smoke-${run_id}.log"
open_tasks="$(count_open_tasks "$TEST_PLAN_FILE")"
start_epoch="$(date -u +%s)"

log "starting nightly Playwright smoke run: id=$run_id open_tasks=$open_tasks"

set +e
(
  cd "$WORKDIR"
  # Parse TEST_CMD into argv and run directly (no login shell/profile loading).
  read -r -a test_cmd_argv <<<"$TEST_CMD"
  "${test_cmd_argv[@]}"
) >"$run_log" 2>&1
test_exit=$?
set -e

end_epoch="$(date -u +%s)"
duration="$((end_epoch - start_epoch))"
tail_output="$(tail -n "$SLACK_LOG_TAIL_LINES" "$run_log" 2>/dev/null || true)"

if [[ "$test_exit" -eq 0 ]]; then
  log "nightly Playwright smoke passed in ${duration}s"
  if [[ "$SLACK_NOTIFY_ON_SUCCESS" == "true" ]]; then
    slack_notify ":white_check_mark: AllPlays nightly smoke passed at $(timestamp_utc) (duration ${duration}s, open test-plan tasks: ${open_tasks}). Log: ${run_log}"
  fi
  exit 0
fi

log "nightly Playwright smoke failed in ${duration}s (exit=$test_exit)"
slack_notify ":x: AllPlays nightly smoke FAILED at $(timestamp_utc) (duration ${duration}s, exit ${test_exit}, open test-plan tasks: ${open_tasks}). Log: ${run_log}\nRecent output:\n\`\`\`\n${tail_output}\n\`\`\`"
exit "$test_exit"
