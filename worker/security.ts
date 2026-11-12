// Proteções transversais: limite de tentativas, antirrobô, origem das requisições,
// registro de eventos de segurança e validação de arquivos enviados.
import type { MiddlewareHandler } from 'hono';
import { getInternal, setInternal } from './db';
import { bad, type AppEnv, type Ctx, type Env } from './env';
import { notifyAdmin } from './push';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const isLocal = (c: Ctx) => ['localhost', '127.0.0.1'].includes(new URL(c.req.url).hostname);
/** IP real do visitante. Em desenvolvimento, "x-dev-ip" simula outro IP (ignorado em produção). */
export const clientIp = (c: Ctx) => (isLocal(c) && c.req.header('x-dev-ip')) || c.req.header('cf-connecting-ip') || 'local';
export const userAgent = (c: Ctx) => (c.req.header('user-agent') ?? '').slice(0, 300);

// ------------------------------------------------------------ localização (dados da Cloudflare)

export interface Geo { country: string; city: string; network: string }

/**
 * País, cidade e provedor de internet, informados pela Cloudflare em cada requisição.
 * Em desenvolvimento, "x-dev-country" e "x-dev-city" permitem simular (ignorados em produção).
 */
export function geoOf(c: Ctx): Geo {
  if (isLocal(c)) {
    return { country: c.req.header('x-dev-country') ?? '', city: c.req.header('x-dev-city') ?? '', network: '' };
  }
  const cf = (c.req.raw as Request & { cf?: IncomingRequestCfProperties }).cf;
  return {
    country: String(cf?.country ?? ''),
    city: String(cf?.city ?? '').slice(0, 80),
    network: String(cf?.asOrganization ?? '').slice(0, 80),
  };
}

// ------------------------------------------------------------ HTTPS obrigatório

/** Fora do localhost, todo acesso sem HTTPS é redirecionado (GET) ou recusado (demais métodos). */
export const requireHttps: MiddlewareHandler<AppEnv> = async (c, next) => {
  const url = new URL(c.req.url);
  if (url.protocol === 'https:' || isLocal(c)) return next();
  if (c.req.method === 'GET' || c.req.method === 'HEAD') {
    const target = `https://${url.host}${url.pathname}${url.search}`;
    return new Response(null, { status: 301, headers: { Location: target } });
  }
  return c.json({ error: 'Use o endereço com https://.' }, 403);
};

// ------------------------------------------------------------ acesso ao painel por país

export interface GeoPolicy { enabled: boolean; countries: string[] }
const DEFAULT_GEO: GeoPolicy = { enabled: true, countries: ['BR'] };

export async function geoPolicy(db: D1Database): Promise<GeoPolicy> {
  const raw = await getInternal(db, 'geo');
  return raw ? { ...DEFAULT_GEO, ...JSON.parse(raw) as GeoPolicy } : DEFAULT_GEO;
}

export async function setGeoPolicy(db: D1Database, p: GeoPolicy) {
  await setInternal(db, 'geo', JSON.stringify(p));
}

/** Verdadeiro quando o país do acesso não está liberado para o painel. */
export async function geoBlocked(c: Ctx): Promise<boolean> {
  const { country } = geoOf(c);
  if (isLocal(c) && !country) return false;
  const p = await geoPolicy(c.env.DB);
  // País desconhecido ("XX") ou rede Tor ("T1") também ficam de fora quando a restrição está ligada.
  return p.enabled && !p.countries.includes(country);
}

/** Bloqueia o painel inteiro (inclusive o login) fora dos países liberados. */
export const geoGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.path.endsWith('/auth/config') || !(await geoBlocked(c))) return next();
  const { country } = geoOf(c);
  if (!(await recentlyLogged(c, 'geo_blocked', 30 * MIN))) {
    await logEvent(c, 'geo_blocked', countryName(country), 'alert');
    c.executionCtx.waitUntil(notifyAdmin(c.env, {
      title: 'Acesso de fora do Brasil bloqueado',
      body: `Alguém tentou abrir o painel de ${countryName(country)}. O acesso foi barrado.`,
      url: '/admin/ajustes/registro',
      tag: 'geo-blocked',
    }));
  }
  return c.json({ error: 'O painel só pode ser acessado de dentro do Brasil.', code: 'geo_blocked' }, 403);
};

async function recentlyLogged(c: Ctx, type: string, windowMs: number) {
  const r = await c.env.DB.prepare('SELECT 1 FROM security_events WHERE type = ? AND ip = ? AND at > ? LIMIT 1')
    .bind(type, clientIp(c), Date.now() - windowMs).first();
  return !!r;
}

export function countryName(code: string) {
  if (!code || code === 'XX') return 'local desconhecido';
  if (code === 'T1') return 'rede anônima (Tor)';
  try { return new Intl.DisplayNames(['pt-BR'], { type: 'region' }).of(code) ?? code; } catch { return code; }
}

// ------------------------------------------------------------ bloqueio de IP

const IP_FAILS = 3;
const IP_STEPS = [HOUR, 6 * HOUR, DAY, 7 * DAY];
const failKey = (ip: string) => `authfail:ip:${ip}`;

export async function ipBlock(db: D1Database, ip: string) {
  return db.prepare('SELECT until, level FROM ip_blocks WHERE ip = ?').bind(ip).first<{ until: number; level: number }>();
}

/** Recusa a requisição se o IP estiver bloqueado. */
export async function assertIpAllowed(c: Ctx) {
  const b = await ipBlock(c.env.DB, clientIp(c));
  if (b && b.until > Date.now()) {
    await failDelay();
    throw bad(
      'Este aparelho foi bloqueado por segurança após tentativas erradas. Se é você, use “Esqueci minha senha” com o código de recuperação.',
      423,
      { code: 'ip_blocked', locked_until: b.until },
    );
  }
}

/**
 * Registra uma tentativa errada (senha, código de recuperação ou link de acesso).
 * 3 erros do mesmo IP em 24h bloqueiam o IP: 1h, 6h, 24h e depois 7 dias.
 * Também detecta ataque distribuído (vários IPs errando ao mesmo tempo).
 */
export async function registerAuthFailure(c: Ctx, kind: string) {
  const db = c.env.DB;
  const ip = clientIp(c);
  await hit(db, failKey(ip));
  const r = await db.prepare('SELECT COUNT(*) AS n FROM rate_hits WHERE key = ? AND at > ?').bind(failKey(ip), Date.now() - DAY)
    .first<{ n: number }>();
  if ((r?.n ?? 0) >= IP_FAILS) {
    const prev = await ipBlock(db, ip);
    const level = Math.min(prev && Date.now() - prev.until < 7 * DAY ? prev.level + 1 : 1, IP_STEPS.length);
    const until = Date.now() + IP_STEPS[level - 1];
    await db.batch([
      db.prepare('INSERT INTO ip_blocks (ip, until, level, reason, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(ip) DO UPDATE SET until = excluded.until, level = excluded.level, reason = excluded.reason, at = excluded.at')
        .bind(ip, until, level, kind, Date.now()),
      db.prepare('DELETE FROM rate_hits WHERE key = ?').bind(failKey(ip)),
    ]);
    await logEvent(c, 'ip_blocked', `${ip} · nível ${level}`, 'alert');
  }
  await detectDistributedAttack(c);
}

export async function clearIpFailures(db: D1Database, ip: string) {
  await db.batch([
    db.prepare('DELETE FROM rate_hits WHERE key = ?').bind(failKey(ip)),
    db.prepare('DELETE FROM ip_blocks WHERE ip = ?').bind(ip),
  ]);
}

export async function listIpBlocks(db: D1Database) {
  const { results } = await db.prepare('SELECT ip, until, level, reason, at FROM ip_blocks WHERE until > ? ORDER BY at DESC')
    .bind(Date.now()).all<{ ip: string; until: number; level: number; reason: string; at: number }>();
  return results;
}

/** 3 ou mais IPs diferentes errando em 1 hora: avisa a Amanda (no máximo a cada 6h). */
async function detectDistributedAttack(c: Ctx) {
  const db = c.env.DB;
  const r = await db.prepare("SELECT COUNT(DISTINCT ip) AS n FROM security_events WHERE type IN ('login_fail','recovery_fail','setup_link_fail') AND at > ?")
    .bind(Date.now() - HOUR).first<{ n: number }>();
  if ((r?.n ?? 0) < 3) return;
  const already = await db.prepare("SELECT 1 FROM security_events WHERE type = 'distributed_attack' AND at > ? LIMIT 1")
    .bind(Date.now() - 6 * HOUR).first();
  if (already) return;
  await logEvent(c, 'distributed_attack', `${r!.n} IPs diferentes em 1h`, 'alert');
  c.executionCtx.waitUntil(notifyAdmin(c.env, {
    title: 'Tentativas de acesso suspeitas',
    body: `${r!.n} endereços diferentes erraram a senha do painel na última hora. O acesso segue protegido.`,
    url: '/admin/ajustes/registro',
    tag: 'distributed-attack',
  }));
}

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
  | 'setup_link_used' | 'setup_link_fail' | 'sessions_revoked' | 'geo_changed' | 'ip_unblocked'
  // alertas
  | 'ip_blocked' | 'geo_blocked' | 'distributed_attack' | 'new_country' | 'new_device' | 'odd_hour';

export type EventCategory = 'security' | 'action' | 'alert';

/** Grava um evento no registro, com IP, aparelho, localização e sessão. */
export async function logEvent(c: Ctx, type: SecurityEvent | (string & {}), detail = '', category: EventCategory = 'security') {
  const g = geoOf(c);
  const sessionId = (c.get('sessionId') as number | undefined) ?? null;
  await c.env.DB.prepare(
    'INSERT INTO security_events (type, ip, user_agent, detail, at, category, country, city, network, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(type, clientIp(c), userAgent(c), detail.slice(0, 300), Date.now(), category, g.country, g.city, g.network, sessionId).run();
}

/** Ação crítica feita no painel (auditoria). */
export const audit = (c: Ctx, type: string, detail = '') => logEvent(c, type, detail, 'action');

/**
 * Limpeza periódica (LGPD: guardar só o necessário):
 * tentativas após 1 dia, acessos e alertas após 90 dias, ações após 1 ano.
 */
export async function purgeSecurityData(db: D1Database) {
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM rate_hits WHERE at < ?').bind(now - DAY),
    db.prepare("DELETE FROM security_events WHERE category != 'action' AND at < ?").bind(now - 90 * DAY),
    db.prepare("DELETE FROM security_events WHERE category = 'action' AND at < ?").bind(now - 365 * DAY),
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    db.prepare('DELETE FROM ip_blocks WHERE until < ?').bind(now - 7 * DAY),
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
