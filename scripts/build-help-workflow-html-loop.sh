#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Rendering workflow help HTML from workflow-docs/"
node "${ROOT}/scripts/build-help-workflow-html-loop.mjs"
