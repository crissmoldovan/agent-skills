import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifySignature(body: string, header: string, secretName: string): boolean {
  const digest = 'sha256=' + createHmac('sha256', process.env[secretName] ?? '').update(body).digest('hex');
  return timingSafeEqual(Buffer.from(digest), Buffer.from(header));
}
