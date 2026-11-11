import type { Context } from 'hono';

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  BUSINESS_TZ: string;
  VAPID_SUBJECT: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY?: string;
  /** Chave pública do Cloudflare Turnstile (antirrobô). */
  TURNSTILE_SITE_KEY?: string;
  /** Segredo do Turnstile (wrangler secret put TURNSTILE_SECRET_KEY). */
  TURNSTILE_SECRET_KEY?: string;
}

export type AppEnv = { Bindings: Env; Variables: { sessionId: number } };
export type Ctx = Context<AppEnv>;

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

export const bad = (msg: string, status = 400, extra?: Record<string, unknown>) => new HttpError(status, msg, extra);

export const nowISO = () => new Date().toISOString();
