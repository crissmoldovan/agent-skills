# widget-service

Serves the widget registry to the internal apps.

Status: live in production.

## Running it

Install, then run the checks. The checks run on every push, so a green branch is
a branch you can merge. All 12 tests pass today.

```bash
npm install
npm test
npm run lint
```

Set `WIDGET_API_URL` and `WIDGET_API_KEY` before starting the service.

Deploy with `npm run deploy -- --env staging`, or `--env production` once the
staging run is green. Use `--dry-run` first.

## What it keeps

Records are kept for 14 days and then deleted by the nightly job.

## Where to go next

See HANDOFF.md for the current state of play, and docs/MANUAL.md for everything
else.
