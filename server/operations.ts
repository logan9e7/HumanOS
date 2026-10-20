export type OperationalEnvironment = {
  USAGE_HASH_KEY?: string;
  OPS_TOKEN?: string;
  AI_ENABLED?: string;
  AI_DAILY_REQUEST_LIMIT?: string;
  AI_DAILY_TOKEN_BUDGET?: string;
  USER_DAILY_MESSAGE_LIMIT?: string;
  USER_MINUTE_MESSAGE_LIMIT?: string;
  APP_DAILY_MESSAGE_LIMIT?: string;
  APP_MINUTE_MESSAGE_LIMIT?: string;
};
export function positiveLimit(value: string | undefined, fallback: number, maximum: number) {
  if (!value || !/^\d+$/.test(value)) return fallback;
  return Math.max(1, Math.min(Number(value), maximum));
}
export async function userUsageKey(env: OperationalEnvironment, user: string) {
  if (!env.USAGE_HASH_KEY || env.USAGE_HASH_KEY.length < 32) throw new Error('usage_key_not_configured');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.USAGE_HASH_KEY), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(user));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
// Atomic conditional upserts protect limits across Worker instances. Reservations
// are not refunded after provider failures, so retries cannot exceed the budget.
export async function reserve(db: D1Database, key: string, limit: number, expires: string, units = 0, unitLimit = 2147483647) {
  if (units > unitLimit) return false;
  return !!await db.prepare('INSERT INTO usage_buckets (id,count,units,expires_at) VALUES (?,1,?,?) ON CONFLICT(id) DO UPDATE SET count=count+1,units=units+excluded.units WHERE count<? AND units+excluded.units<=? RETURNING id')
    .bind(key, units, expires, limit, unitLimit).first();
}
export async function reserveProvider(db: D1Database, env: OperationalEnvironment, units: number) {
  if (env.AI_ENABLED === 'false') return false;
  const date = new Date(), day = date.toISOString().slice(0, 10);
  const window = Math.floor(date.getTime() / 300000);
  const failed: any = await db.prepare('SELECT count FROM usage_buckets WHERE id=?').bind(`provider-fail:${window}`).first();
  if ((failed?.count || 0) >= 3) return false;
  return reserve(db, `provider:${day}`, positiveLimit(env.AI_DAILY_REQUEST_LIMIT, 200, 10000), new Date(date.getTime() + 172800000).toISOString(), units, positiveLimit(env.AI_DAILY_TOKEN_BUDGET, 1000000, 100000000));
}
export async function recordProviderFailure(db: D1Database) {
  const current = Date.now();
  await reserve(db, `provider-fail:${Math.floor(current / 300000)}`, 10000, new Date(current + 600000).toISOString());
}
export async function housekeeping(db: D1Database) {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare('DELETE FROM usage_buckets WHERE id IN (SELECT id FROM usage_buckets WHERE expires_at<? LIMIT 100)').bind(now),
    db.prepare('DELETE FROM app_metrics WHERE id IN (SELECT id FROM app_metrics WHERE expires_at<? LIMIT 100)').bind(now),
    db.prepare('DELETE FROM quotas WHERE day<?').bind(new Date(Date.now() - 172800000).toISOString().slice(0, 10)),
  ]);
}
export async function recordMetric(db: D1Database, route: string, status: number, duration: number) {
  const hour = new Date().toISOString().slice(0, 13);
  const key = `${hour}|${route}|${status}`;
  await db.prepare('INSERT INTO app_metrics (id,count,duration_ms,expires_at) VALUES (?,1,?,?) ON CONFLICT(id) DO UPDATE SET count=count+1,duration_ms=duration_ms+excluded.duration_ms')
    .bind(key, duration, new Date(Date.now() + 604800000).toISOString()).run();
}
export async function validOpsToken(request: Request, expected?: string) {
  if (!expected || expected.length < 32) return false;
  const provided = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
  if (provided.length > 256) return false;
  const digest = async (v: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
  const [a, b] = await Promise.all([digest(provided), digest(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
