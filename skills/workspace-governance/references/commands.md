# Install and invoke

The skill is portable prose. Install `workspacectl` separately from the reviewed
source checkout's `packages/workspace-governance` directory. No registry release
is claimed. Choose explicit local artifact/consumer paths; no global install.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run verify
npm pack --ignore-scripts --pack-destination "$ARTIFACT_DIR"
npm install --prefix "$CONSUMER_DIR" --ignore-scripts --no-audit --no-fund "$TARBALL"
"$CONSUMER_DIR/node_modules/.bin/workspacectl" --help
```

Use the real tarball name printed by npm. Either invoke that exact installed bin
or add only its directory to your terminal's PATH. Node 24+ and trusted Git are
required on Linux. GitHub additionally requires trusted gh and authorized access.
Do not copy credentials into manifests or ask users to disclose them in chat.

```sh
workspacectl validate --manifest manifest.json
workspacectl catalog --manifest manifest.json --principal reader
workspacectl explain --manifest manifest.json --node repo --principal reader
workspacectl workflow --manifest manifest.json --node repo --principal reader --workflow feature
workspacectl discover --root "$SCAN_ROOT" --depth 8
workspacectl discover-github --owner example
workspacectl plan --manifest manifest.json --node org --principal reader --root "$SCAN_ROOT"
workspacectl audit --manifest manifest.json --node org --principal reader --root "$SCAN_ROOT"
workspacectl verify-plan --manifest manifest.json --node org --principal reader --root "$SCAN_ROOT" --plan preview.json
```

Do not run the example remote command blindly: choose an explicitly approved
organization. Validate/discover are local administrative views, not filtered by a
principal. Catalog is a fixed readable projection. Explain/workflow resolve rules;
workflow requires `--workflow ID`. Explain/plan/audit/verify-plan optionally accept
it. Plan/audit/verify-plan discover locally with `--depth N` (default8, range0–32).
Never trust a saved plan to choose root/principal/scope/workflow.

Save preview JSON outside the scan root so the output does not change its own
inventory. All commands are read-only. Unknown/duplicate flags fail; no `--human`,
apply, execution or editing flags exist. Help/version are text, other output JSON.
Exit0 success, exit2 invalid/unavailable/unsupported/tool failure, exit3 incomplete,
audit drift or stale plan. Plans can validly show drift with exit0; audit adds a
drift boolean and exits3. Errors have static code/message JSON on stderr, no raw
Git/GitHub error strings. Incomplete plans emit no partial stdout.
