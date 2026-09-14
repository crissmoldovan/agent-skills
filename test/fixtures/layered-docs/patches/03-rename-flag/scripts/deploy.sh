#!/usr/bin/env bash
# Usage: deploy.sh --target <staging|production> [--dry-run]
#   --target    which environment to deploy to. Required. Renamed from --env.
#   --dry-run   print the plan and exit without deploying.
set -euo pipefail

environment=""
dry_run="no"
while [ $# -gt 0 ]; do
  case "$1" in
    --target) environment="${2:-}"; shift 2 ;;
    --dry-run) dry_run="yes"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$environment" ] || { echo "--target is required" >&2; exit 2; }
echo "deploy: ${environment} (dry-run: ${dry_run})"
