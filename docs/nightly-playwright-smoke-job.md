# Nightly Playwright Smoke Job (03:00 Daily)

This mirrors the `paul-bot-1` job style:
- one shell script that does the work
- one `systemd` oneshot service
- one `systemd` timer
- env-driven Slack notifications

## Files

- `scripts/nightly-playwright-smoke.sh`
- `systemd/allplays-nightly-playwright-smoke.service`
- `systemd/allplays-nightly-playwright-smoke.timer`
- `config/nightly-playwright-smoke.env.example`

## What the job does

1. Acquires a lock file to avoid overlapping runs.
2. Runs `TEST_CMD` (default: `npm run test:e2e:smoke`) in the repo.
3. Logs full output to `~/.local/state/allplays/nightly-playwright-smoke-logs/`.
4. Counts open checklist tasks in the Playwright test plan doc.
5. Posts success/failure summary to Slack (with failure log tail).

## Setup

1. Create config directory and env file:

```bash
mkdir -p ~/.config/allplays
cp config/nightly-playwright-smoke.env.example ~/.config/allplays/nightly-playwright-smoke.env
```

2. Edit `~/.config/allplays/nightly-playwright-smoke.env`:
- set `SLACK_BOT_TOKEN`
- set `SLACK_NOTIFY_CHANNEL`
- optionally set `SLACK_NOTIFY_FALLBACK_USER`
- optionally override `TEST_CMD` for wider nightly scope

3. Install user units:

```bash
mkdir -p ~/.config/systemd/user
cp systemd/allplays-nightly-playwright-smoke.service ~/.config/systemd/user/
cp systemd/allplays-nightly-playwright-smoke.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now allplays-nightly-playwright-smoke.timer
```

## Verify

```bash
systemctl --user status allplays-nightly-playwright-smoke.timer
systemctl --user list-timers allplays-nightly-playwright-smoke.timer
systemctl --user start allplays-nightly-playwright-smoke.service
journalctl --user -u allplays-nightly-playwright-smoke.service -n 200 --no-pager
```

The timer is configured for local time `03:00` every day (`OnCalendar=*-*-* 03:00:00`).
