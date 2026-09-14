# 01 — Design

## 3. Retention

Records are kept for **30 days**. The window is set in `src/config.js`
(`retentionDays`), which is the home of this fact.

## 4. Configuration

The service reads `WIDGET_API_URL` and `WIDGET_API_TOKEN`. Both are required, and the service
refuses to start when either is missing.
