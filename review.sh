#!/usr/bin/env bash
# Launches the Cold Exit review dashboard.
exec node "$(dirname "$0")/tools/review-dashboard.mjs"
