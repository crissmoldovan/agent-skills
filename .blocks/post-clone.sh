#!/usr/bin/env bash
# Blocks runs this after cloning, before the review agent starts.
#
# Its job is to make `npm run verify` possible. Without it the sandbox has Node
# and npm but no `node_modules`, so a reviewer can only read the diff — and this
# repository is almost entirely executable logic: a status classifier, a skill
# verifier, and a routing policy, all with real test suites behind them.
#
# The sibling repository learned what that costs. A review sandbox there ran on
# Node 22.14 and found a build failure that CI on Node 24 and every maintainer's
# machine had never seen, because the bug only existed below Node 22.18. Reading
# the diff would never have found it. Running the code found it immediately.
#
# Nothing private is needed here: this repository publishes to npm and its
# dependencies are public, so unlike the sibling there is no token to arrange.
set -uo pipefail

say() { printf '[post-clone] %s\n' "$*"; }

if ! npm ci; then
  say "INSTALL FAILED. The suite cannot be run; say so in the review rather than"
  say "leaving a reader to infer it from a verdict that does not mention tests."
  exit 0
fi

say "Ready: dependencies installed. Run \`npm run verify\`."
