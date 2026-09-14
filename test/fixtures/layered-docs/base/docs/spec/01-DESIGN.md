# 01 — Design

## 3. Retention

Records are kept for **30 days**, then deleted by the nightly job. The window is
enforced in `src/config.js` (`retentionDays`), which is the home of this fact.

## 4. Configuration

The service reads `WIDGET_API_URL` and `WIDGET_API_TOKEN`. Both are required, and the service
refuses to start when either is missing.
