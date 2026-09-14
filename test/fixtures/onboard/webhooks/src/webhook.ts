import { createHmac, timingSafeEqual } from 'node:crypto';

/** A fixture in the shape of a real delivery handler: the signature header and an env-read key. */
export function verifyDelivery(body: string, headers: Record<string, string>): boolean {
  const provided = headers['x-hub-signature-256'] ?? '';
  const digest = `sha256=${createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET ?? '').update(body).digest('hex')}`;
  return provided.length === digest.length && timingSafeEqual(Buffer.from(digest), Buffer.from(provided));
}
