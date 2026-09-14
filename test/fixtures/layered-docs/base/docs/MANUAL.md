# widget-service manual

How to get things done here, and what each command and variable is.

Sources re-read at {{BASELINE_SHA}}.

## Tasks

### Deploy to staging

Build, then deploy with `--env staging`. Check the plan with `--dry-run` first.
It worked if the deploy script exits 0.

### Add a widget

Edit `generated/registry.json` and add the widget's name to the list. Commit the
change with the pull request that needs it.

## Reference

### Commands

| Command | What it does |
|---|---|
| `npm start` | Starts the service on port 8080 |
| `npm test` | Runs the test files under `test/` |
| `npm run build` | Writes `generated/registry.json` |
| `npm run deploy` | Deploys; takes `--env` and `--dry-run` |

### Variables

| Variable | Read by |
|---|---|
| `WIDGET_API_URL` | `src/config.js` |
| `WIDGET_API_TOKEN` | `src/config.js` |

## Docs map

Tier 2: another system reads the registry this service generates.

| File | Kind | Audience | Edit rule |
|---|---|---|---|
| `README.md` | Quick start | anyone arriving | PR |
| `docs/MANUAL.md` | Manual | people using or changing it | PR |
| `HANDOFF.md` | Working: handoff | the next person | delete when accepted |
| `docs/RUNBOOK.md` | Runbook | whoever deploys | PR |
| `docs/spec/01-DESIGN.md` | Record: spec | people changing behaviour | amend |
| `docs/decisions.md` | Record: decisions | anyone asking why | supersede |
| `AGENTS.md` | Agent file | agent sessions | PR |
| `generated/registry.json` | Generated | machines | never |
