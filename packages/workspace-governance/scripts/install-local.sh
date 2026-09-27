#!/bin/sh
set -eu

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' \
    'workspacectl installer: Node.js 24 or newer is required.' \
    'Remedy: Install it separately, put node on PATH, and rerun this installer.' >&2
  exit 2
fi

node_path=$(command -v node)
node_major=$("$node_path" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || printf '0')
case "$node_major" in
  ''|*[!0-9]*) node_major=0 ;;
esac
if [ "$node_major" -lt 24 ]; then
  printf '%s\n' \
    'workspacectl installer: Node.js 24 or newer is required.' \
    'Remedy: Install it separately, put that node on PATH, and rerun this installer.' >&2
  exit 2
fi
node_path=$("$node_path" -p 'process.execPath')

if ! command -v git >/dev/null 2>&1; then
  printf '%s\n' \
    'workspacectl installer: Git is required.' \
    'Remedy: Install it separately, put the trusted git executable on PATH, and rerun this installer.' >&2
  exit 2
fi
if ! git --version >/dev/null 2>&1; then
  printf '%s\n' \
    'workspacectl installer: Git is unavailable or unusable.' \
    'Remedy: Repair the trusted Git installation separately and rerun this installer.' >&2
  exit 2
fi

if ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' \
    'workspacectl installer: npm is required to install the reviewed package archive.' \
    'Remedy: Install npm separately for the selected Node.js 24+ runtime and rerun this installer.' >&2
  exit 2
fi
npm_path=$(command -v npm)

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
export WORKSPACECTL_INSTALL_NODE="$node_path"
export WORKSPACECTL_INSTALL_NPM="$npm_path"
exec "$node_path" "$script_dir/install-local.mjs" "$@"
