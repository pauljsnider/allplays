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

slack_notify() {
  local text="$1"
  local resp ok err dm_resp dm_chan

  [[ "$SLACK_NOTIFY_ENABLED" == "true" ]] || return 0
  if [[ -z "$SLACK_BOT_TOKEN" || -z "$SLACK_NOTIFY_CHANNEL" ]]; then
    log "slack notify skipped: missing token/channel"
    return 0
  fi

  resp="$(curl -sS -X POST "https://slack.com/api/chat.postMessage" \
    -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
    -H "Content-Type: application/json; charset=utf-8" \
    --data "$(jq -cn --arg ch "$SLACK_NOTIFY_CHANNEL" --arg t "$text" '{channel:$ch,text:$t}')" \
  )" || {
    log "slack notify failed: curl error"
    return 0
  }

  ok="$(jq -r '.ok // false' <<<"$resp" 2>/dev/null || echo false)"
  if [[ "$ok" == "true" ]]; then
    return 0
  fi

  err="$(jq -r '.error // "unknown_error"' <<<"$resp" 2>/dev/null || echo unknown_error)"
  log "slack notify failed: $err"

  if [[ "$err" != "not_in_channel" || -z "$SLACK_NOTIFY_FALLBACK_USER" ]]; then
    return 0
  fi

  dm_resp="$(curl -sS -X POST "https://slack.com/api/conversations.open" \
    -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
    -H "Content-Type: application/json; charset=utf-8" \
    --data "$(jq -cn --arg u "$SLACK_NOTIFY_FALLBACK_USER" '{users:$u}')" \
  )" || true
  dm_chan="$(jq -r '.channel.id // ""' <<<"$dm_resp" 2>/dev/null || true)"
  if [[ -n "$dm_chan" ]]; then
    curl -sS -X POST "https://slack.com/api/chat.postMessage" \
      -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
      -H "Content-Type: application/json; charset=utf-8" \
      --data "$(jq -cn --arg ch "$dm_chan" --arg t "$text" '{channel:$ch,text:$t}')" \
      >/dev/null || true
  fi
}

require_bin() {
  command -v "$1" >/dev/null 2>&1 || {
    log "missing required binary: $1"
    exit 1
  }
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
  bash -lc "$TEST_CMD"
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
