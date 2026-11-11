// Proteções transversais: limite de tentativas, antirrobô, origem das requisições,
// registro de eventos de segurança e validação de arquivos enviados.
import type { MiddlewareHandler } from 'hono';
import { bad, type AppEnv, type Ctx, type Env } from './env';

const MIN = 60_000;

export const clientIp = (c: Ctx) => c.req.header('cf-connecting-ip') ?? 'local';
export const userAgent = (c: Ctx) => (c.req.header('user-agent') ?? '').slice(0, 300);
const isLocal = (c: Ctx) => ['localhost', '127.0.0.1'].includes(new URL(c.req.url).hostname);

// ------------------------------------------------------------ limite de tentativas

export interface Limit { key: string; max: number; windowMs: number; message?: string }

/** Lança 429 se alguma das chaves já atingiu o máximo dentro da janela. */
export async function checkLimits(db: D1Database, limits: Limit[]) {
  const now = Date.now();
  for (const l of limits) {
    const r = await db.prepare('SELECT COUNT(*) AS n, MIN(at) AS first FROM rate_hits WHERE key = ? AND at > ?')
      .bind(l.key, now - l.windowMs).first<{ n: number; first: number | null }>();
    if ((r?.n ?? 0) >= l.max) {
      const retryMin = Math.max(1, Math.ceil(((r?.first ?? now) + l.windowMs - now) / MIN));
      throw bad(l.message ?? `Muitas tentativas. Tente de novo em ${retryMin} min.`, 429, { code: 'rate_limited', retry_after_min: retryMin });
    }
  }
}

export async function hit(db: D1Database, ...keys: string[]) {
  const now = Date.now();
  await db.batch(keys.map((k) => db.prepare('INSERT INTO rate_hits (key, at) VALUES (?, ?)').bind(k, now)));
}

export async function clearHits(db: D1Database, ...keys: string[]) {
  await db.batch(keys.map((k) => db.prepare('DELETE FROM rate_hits WHERE key = ?').bind(k)));
}

/** Atraso proposital após uma falha (dificulta tentativas em sequência). */
export const failDelay = () => new Promise((r) => setTimeout(r, 400 + Math.random() * 300));

// ------------------------------------------------------------ antirrobô (Cloudflare Turnstile)

export function turnstileEnabled(env: Env) {
  return !!env.TURNSTILE_SITE_KEY;
}

/**
 * Valida o token do Turnstile no servidor. Fora do localhost, falha fechado:
 * sem chaves configuradas, nenhuma ação protegida é aceita.
 */
export async function verifyTurnstile(c: Ctx, token: unknown) {
  const { TURNSTILE_SITE_KEY: site, TURNSTILE_SECRET_KEY: secret } = c.env;
  if (!site || !secret) {
    if (isLocal(c) && !site && !secret) return;
    console.error('[turnstile] chaves ausentes; requisição recusada');
    throw bad('Proteção antirrobô não configurada. Avise a NUKKI.', 503);
  }
  if (typeof token !== 'string' || !token || token.length > 2048) {
    throw bad('Confirme a verificação de segurança e tente de novo.', 400, { code: 'turnstile' });
  }
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  form.append('remoteip', clientIp(c));
  form.append('idempotency_key', crypto.randomUUID());
  let ok = false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const data = await res.json<{ success: boolean; 'error-codes'?: string[] }>();
    ok = data.success === true;
    if (!ok) console.warn('[turnstile] recusado', data['error-codes']);
  } catch (e) {
    console.error('[turnstile] falha ao verificar', e);
  }
  if (!ok) throw bad('Não conseguimos confirmar que você não é um robô. Tente de novo.', 400, { code: 'turnstile' });
}

// ------------------------------------------------------------ origem (CSRF)

/** Ações que alteram dados no painel só são aceitas vindas do próprio site. */
export const sameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') return next();
  const origin = c.req.header('origin');
  const expected = new URL(c.req.url).origin;
  if (origin !== expected) {
    return c.json({ error: 'Requisição recusada.' }, 403);
  }
  return next();
};

/** Cabeçalhos de segurança para as respostas da API. */
export const apiHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (c.req.path.startsWith('/api/admin')) c.header('Cache-Control', 'no-store');
};

// ------------------------------------------------------------ eventos de segurança

export type SecurityEvent =
  | 'login_ok' | 'login_fail' | 'login_locked' | 'account_locked' | 'logout'
  | 'password_created' | 'password_changed' | 'recovery_used' | 'recovery_fail' | 'recovery_regenerated'
  | 'setup_link_used' | 'setup_link_fail' | 'sessions_revoked';

export async function logEvent(c: Ctx, type: SecurityEvent, detail = '') {
  await c.env.DB.prepare('INSERT INTO security_events (type, ip, user_agent, detail, at) VALUES (?, ?, ?, ?, ?)')
    .bind(type, clientIp(c), userAgent(c), detail.slice(0, 200), Date.now()).run();
}

/** Limpeza periódica: tentativas com mais de 1 dia e eventos com mais de 90 dias. */
export async function purgeSecurityData(db: D1Database) {
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM rate_hits WHERE at < ?').bind(now - 24 * 60 * MIN),
    db.prepare('DELETE FROM security_events WHERE at < ?').bind(now - 90 * 24 * 60 * MIN),
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
  ]);
}

// ------------------------------------------------------------ arquivos enviados

/** Confere a assinatura real do arquivo (não confia no tipo informado pelo navegador). */
export function detectImage(bytes: Uint8Array): 'image/webp' | 'image/jpeg' | 'image/png' | null {
  const b = bytes;
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  return null;
}
