#!/usr/bin/env bash
set -euo pipefail

visual_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

docker run --rm --ipc=host \
    --platform linux/amd64 \
    --volume "${visual_repo_root}:/work" \
    --volume /work/node_modules \
    --volume /work/apps/app/node_modules \
    --workdir /work \
    mcr.microsoft.com/playwright:v1.61.1-noble \
    bash -lc '
        set -euo pipefail
        npm ci
        npm ci --prefix apps/app
        python3 -m http.server 4173 >/tmp/allplays-visual-static.log 2>&1 &
        npm --prefix apps/app run dev -- --host 127.0.0.1 --port 5174 >/tmp/allplays-visual-app.log 2>&1 &

        for visual_url in http://127.0.0.1:4173 http://127.0.0.1:5174; do
            for visual_attempt in $(seq 1 60); do
                if curl --fail --silent --show-error --max-time 2 "${visual_url}" >/dev/null; then
                    break
                fi
                if [ "${visual_attempt}" -eq 60 ]; then
                    cat /tmp/allplays-visual-static.log >&2 || true
                    cat /tmp/allplays-visual-app.log >&2 || true
                    exit 1
                fi
                sleep 1
            done
        done

        SMOKE_BASE_URL=http://127.0.0.1:4173 \
        SMOKE_APP_BASE_URL=http://127.0.0.1:5174 \
        SMOKE_SUITE=preview \
        npm run test:smoke:visual:update
    '
