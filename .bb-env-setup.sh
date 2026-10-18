#!/usr/bin/env bash
# Fresh bb worktrees only have tracked files; install dependencies.
set -euo pipefail
npm ci --no-audit --no-fund --loglevel=error
