// Acesso ao painel. A senha é criada e gerenciada pela própria administradora:
// - primeiro acesso por link de uso único (gerado pela NUKKI, que nunca vê a senha);
// - código de recuperação, mostrado uma única vez, para redefinir a senha sozinha;
// - sessões por aparelho, com opção de encerrar as outras.
import type { MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { getInternal, setInternal } from './db';
import { bad, type AppEnv, type Ctx } from './env';
import { notifyAdmin } from './push';
import { checkLimits, clearHits, clientIp, failDelay, hit, logEvent, userAgent } from './security';

const COOKIE = 'apn_session';
const SESSION_DAYS = 30;
const ITERATIONS = 100_000; // limite do PBKDF2 nos Workers
const MIN = 60_000;

const enc = new TextEncoder();
const toHex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));
export const sha256 = async (t: string) => toHex(await crypto.subtle.digest('SHA-256', enc.encode(t)));

function safeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ------------------------------------------------------------ senha

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${toHex(await pbkdf2(password, salt, ITERATIONS))}`;
}

// Hash fictício para gastar o mesmo tempo quando não há senha (não revela o estado da conta).
const DUMMY = `pbkdf2$${ITERATIONS}$${'00'.repeat(16)}$${'00'.repeat(32)}`;

async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [alg, it, salt, hash] = (stored ?? DUMMY).split('$');
  if (alg !== 'pbkdf2') return false;
  const ok = safeEqual(new Uint8Array(await pbkdf2(password, fromHex(salt), Number(it))), fromHex(hash));
  return ok && !!stored;
}

const COMMON = new Set([
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234', '123123123',
  'password', 'password1', 'senha123', 'senha1234', 'senhasenha', 'mudar123', 'qwerty123', 'abc12345',
  'apnails', 'apnails1', 'apnails123', 'apnails2026', 'amanda123', 'amanda2026', 'penteado', 'nails123',
  'iloveyou', 'admin123', 'brasil123', 'teamo123',
]);

/** Regras de senha: mínimo 8 caracteres, não óbvia, não repetitiva. */
export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string') return 'Informe a senha.';
  if (pw.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (pw.length > 128) return 'Senha longa demais.';
  const low = pw.toLowerCase();
  if (COMMON.has(low) || /^(.)\1+$/.test(pw) || /^\d+$/.test(pw) && pw.length < 10) {
    return 'Essa senha é fácil de adivinhar. Misture letras e números ou use uma frase.';
  }
  return null;
}

// ------------------------------------------------------------ código de recuperação

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sem I, L, O, 0, 1
const normalizeCode = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function newRecoveryCode(db: D1Database): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const raw = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  await setInternal(db, 'recovery', JSON.stringify({ hash: await sha256(raw), created_at: Date.now() }));
  return raw.match(/.{4}/g)!.join('-');
}

export async function recoveryInfo(db: D1Database): Promise<{ created_at: number } | null> {
  const r = await getInternal(db, 'recovery');
  if (!r) return null;
  const { created_at } = JSON.parse(r) as { created_at: number };
  return { created_at };
}

// ------------------------------------------------------------ sessões

async function startSession(c: Ctx) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  const maxAge = SESSION_DAYS * 86400;
  await c.env.DB.prepare('INSERT INTO sessions (token_hash, created_at, last_seen, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await sha256(token), now, now, now + maxAge * 1000, userAgent(c), clientIp(c)).run();
  setCookie(c, COOKIE, token, {
    path: '/', httpOnly: true, sameSite: 'Strict', maxAge,
    secure: new URL(c.req.url).protocol === 'https:',
  });
}

async function currentSession(c: Ctx) {
  const t = getCookie(c, COOKIE);
  if (!t || !/^[0-9a-f]{64}$/.test(t)) return null;
  const row = await c.env.DB.prepare('SELECT id, last_seen, expires_at FROM sessions WHERE token_hash = ?')
    .bind(await sha256(t)).first<{ id: number; last_seen: number; expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return null;
  return row;
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const s = await currentSession(c);
  if (!s) return c.json({ error: 'Faça login para continuar.' }, 401);
  // Atualiza "visto por último" no máximo a cada 10 minutos (economiza escritas).
  if (Date.now() - s.last_seen > 10 * MIN) {
    await c.env.DB.prepare('UPDATE sessions SET last_seen = ?, ip = ? WHERE id = ?').bind(Date.now(), clientIp(c), s.id).run();
  }
  c.set('sessionId', s.id);
  return next();
};

export async function listSessions(c: Ctx, currentId: number) {
  const { results } = await c.env.DB.prepare('SELECT id, created_at, last_seen, user_agent, ip FROM sessions WHERE expires_at > ? ORDER BY last_seen DESC')
    .bind(Date.now()).all<{ id: number; created_at: number; last_seen: number; user_agent: string; ip: string }>();
  return results.map((s) => ({ ...s, current: s.id === currentId }));
}

export async function revokeSessions(c: Ctx, keepId: number | null) {
  await c.env.DB.prepare('DELETE FROM sessions WHERE id IS NOT ?').bind(keepId).run();
}

export async function logout(c: Ctx) {
  const s = await currentSession(c);
  if (s) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(s.id).run();
  deleteCookie(c, COOKIE, { path: '/' });
  await logEvent(c, 'logout');
}

// ------------------------------------------------------------ login

const LOGIN_IP = (ip: string) => `login:ip:${ip}`;
const LOGIN_ALL = 'login:all';

export async function login(c: Ctx, password: unknown) {
  const db = c.env.DB;
  const ip = clientIp(c);
  await checkLimits(db, [
    { key: LOGIN_IP(ip), max: 5, windowMs: 15 * MIN },
    { key: LOGIN_ALL, max: 20, windowMs: 60 * MIN, message: 'O acesso foi bloqueado por 1 hora após muitas tentativas erradas. Se esqueceu a senha, use o código de recuperação.' },
  ]);
  const stored = await getInternal(db, 'password_hash');
  const ok = typeof password === 'string' && password.length <= 128 && await verifyPassword(password, stored);
  if (!ok) {
    await hit(db, LOGIN_IP(ip), LOGIN_ALL);
    await logEvent(c, 'login_fail');
    await failDelay();
    if (!stored) throw bad('A senha ainda não foi criada. Use o link de primeiro acesso.', 401);
    throw bad('Senha incorreta.', 401);
  }
  await clearHits(db, LOGIN_IP(ip));
  await startSession(c);
  await logEvent(c, 'login_ok');
  c.executionCtx.waitUntil(notifyAdmin(c.env, {
    title: 'Novo acesso ao painel',
    body: `${describeDevice(userAgent(c))} entrou agora. Não foi você? Abra Ajustes → Senha e acesso.`,
    url: '/admin/ajustes/conta',
    tag: `login-${Date.now()}`,
  }));
}

// ------------------------------------------------------------ primeiro acesso (link de uso único)

export async function setupWithToken(c: Ctx, token: unknown, password: unknown) {
  const db = c.env.DB;
  const ip = clientIp(c);
  await checkLimits(db, [{ key: `setup:ip:${ip}`, max: 5, windowMs: 60 * MIN }, { key: 'setup:all', max: 20, windowMs: 24 * 60 * MIN }]);
  const raw = await getInternal(db, 'setup');
  const setup = raw ? JSON.parse(raw) as { hash: string; exp: number } : null;
  const valid = !!setup && typeof token === 'string' && setup.exp > Date.now()
    && safeEqual(fromHex(await sha256(token)), fromHex(setup.hash));
  if (!valid) {
    await hit(db, `setup:ip:${ip}`, 'setup:all');
    await logEvent(c, 'setup_link_fail');
    await failDelay();
    throw bad('Este link de primeiro acesso é inválido ou expirou. Peça um novo à NUKKI.', 400);
  }
  const problem = passwordProblem(password);
  if (problem) throw bad(problem);
  await setInternal(db, 'password_hash', await hashPassword(password as string));
  await db.prepare("DELETE FROM settings WHERE key = '_setup'").run();
  await revokeSessions(c, null);
  const code = await newRecoveryCode(db);
  await logEvent(c, 'setup_link_used');
  await logEvent(c, 'password_created');
  await startSession(c);
  return code;
}

// ------------------------------------------------------------ recuperação

export async function recoverWithCode(c: Ctx, code: unknown, password: unknown) {
  const db = c.env.DB;
  const ip = clientIp(c);
  await checkLimits(db, [
    { key: `recover:ip:${ip}`, max: 5, windowMs: 60 * MIN },
    { key: 'recover:all', max: 10, windowMs: 24 * 60 * MIN, message: 'A recuperação foi bloqueada por hoje após muitas tentativas. Tente amanhã ou fale com a NUKKI.' },
  ]);
  const problem = passwordProblem(password);
  if (problem) throw bad(problem);
  const raw = await getInternal(db, 'recovery');
  const rec = raw ? JSON.parse(raw) as { hash: string } : null;
  const ok = !!rec && safeEqual(fromHex(await sha256(normalizeCode(code))), fromHex(rec.hash));
  if (!ok) {
    await hit(db, `recover:ip:${ip}`, 'recover:all');
    await logEvent(c, 'recovery_fail');
    await failDelay();
    throw bad('Código de recuperação incorreto.', 401);
  }
  await setInternal(db, 'password_hash', await hashPassword(password as string));
  await revokeSessions(c, null);
  await clearHits(db, LOGIN_ALL, `login:ip:${ip}`);
  const fresh = await newRecoveryCode(db); // o código usado deixa de valer
  await logEvent(c, 'recovery_used');
  await startSession(c);
  c.executionCtx.waitUntil(notifyAdmin(c.env, {
    title: 'Senha redefinida', body: 'A senha do painel foi trocada com o código de recuperação.', url: '/admin/ajustes/conta', tag: 'recovery',
  }));
  return fresh;
}

// ------------------------------------------------------------ dentro do painel

async function requireCurrentPassword(c: Ctx, current: unknown) {
  const db = c.env.DB;
  const ip = clientIp(c);
  await checkLimits(db, [{ key: `reauth:ip:${ip}`, max: 5, windowMs: 15 * MIN }]);
  const ok = typeof current === 'string' && await verifyPassword(current, await getInternal(db, 'password_hash'));
  if (!ok) {
    await hit(db, `reauth:ip:${ip}`);
    await failDelay();
    throw bad('Senha atual incorreta.', 401);
  }
}

export async function changePassword(c: Ctx, sessionId: number, current: unknown, next: unknown) {
  await requireCurrentPassword(c, current);
  const problem = passwordProblem(next);
  if (problem) throw bad(problem);
  if (current === next) throw bad('A nova senha precisa ser diferente da atual.');
  await setInternal(c.env.DB, 'password_hash', await hashPassword(next as string));
  await revokeSessions(c, sessionId); // os outros aparelhos precisam entrar de novo
  await logEvent(c, 'password_changed');
}

export async function regenerateRecovery(c: Ctx, current: unknown) {
  await requireCurrentPassword(c, current);
  const code = await newRecoveryCode(c.env.DB);
  await logEvent(c, 'recovery_regenerated');
  return code;
}

export async function hasPassword(db: D1Database) {
  return !!(await getInternal(db, 'password_hash'));
}

/** "Chrome no Android", "Safari no iPhone"… */
export function describeDevice(ua: string): string {
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'aparelho desconhecido';
  const br = /SamsungBrowser/i.test(ua) ? 'Samsung Internet' : /Edg\//i.test(ua) ? 'Edge' : /Chrome\//i.test(ua) ? 'Chrome' : /Firefox\//i.test(ua) ? 'Firefox' : /Safari\//i.test(ua) ? 'Safari' : 'Navegador';
  return `${br} no ${os}`;
}
