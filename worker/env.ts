import type { Context } from 'hono';

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  BUSINESS_TZ: string;
  VAPID_SUBJECT: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY?: string;
  ADMIN_INITIAL_PASSWORD?: string;
}

export type AppEnv = { Bindings: Env };
export type Ctx = Context<AppEnv>;

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

export const bad = (msg: string, status = 400, extra?: Record<string, unknown>) => new HttpError(status, msg, extra);

export const nowISO = () => new Date().toISOString();
