#!/usr/bin/env bash
# Usage: deploy.sh --env <staging|production> [--dry-run]
#   --env       which environment to deploy to. Required.
#   --dry-run   print the plan and exit without deploying.
set -euo pipefail

environment=""
dry_run="no"
while [ $# -gt 0 ]; do
  case "$1" in
    --env) environment="${2:-}"; shift 2 ;;
    --dry-run) dry_run="yes"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$environment" ] || { echo "--env is required" >&2; exit 2; }
if [ "$dry_run" = "yes" ]; then
  echo "plan: deploy the current build to ${environment}"
else
  echo "deploying the current build to ${environment}"
fi
