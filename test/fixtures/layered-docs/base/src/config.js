// The two variables the service reads. Both are required; loadConfig throws when
// either is missing, before any request is made.
export function loadConfig(env = process.env) {
  const url = env.WIDGET_API_URL;
  const token = env.WIDGET_API_TOKEN;
  if (!url || !token) {
    throw new Error('WIDGET_API_URL and WIDGET_API_TOKEN are both required');
  }
  return { url, token, retentionDays: 30 };
}
