import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { getInternal, setInternal } from './db';
import { bad, type AppEnv, type Ctx } from './env';

const COOKIE = 'apn_session';
const SESSION_DAYS = 60;
const ITERATIONS = 100_000; // limite do PBKDF2 nos Workers

const enc = new TextEncoder();
const toHex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

/** Formato: pbkdf2$<iterações>$<salt hex>$<hash hex> (mesmo formato de scripts/set-password.mjs). */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${toHex(await pbkdf2(password, salt, ITERATIONS))}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, it, salt, hash] = stored.split('$');
  if (alg !== 'pbkdf2') return false;
  const got = new Uint8Array(await pbkdf2(password, fromHex(salt), Number(it)));
  const want = fromHex(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

const sha256 = async (t: string) => toHex(await crypto.subtle.digest('SHA-256', enc.encode(t)));

async function storedHash(c: Ctx): Promise<string | null> {
  const h = await getInternal(c.env.DB, 'password_hash');
  if (h) return h;
  // Primeira execução: usa a senha inicial definida como segredo do Worker.
  if (c.env.ADMIN_INITIAL_PASSWORD) {
    const created = await hashPassword(c.env.ADMIN_INITIAL_PASSWORD);
    await setInternal(c.env.DB, 'password_hash', created);
    return created;
  }
  return null;
}

export async function login(c: Ctx, password: string) {
  const stored = await storedHash(c);
  if (!stored) throw bad('Senha ainda não configurada. Fale com a NUKKI.', 503);
  if (!(await verifyPassword(password, stored))) throw bad('Senha incorreta.', 401);
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const maxAge = SESSION_DAYS * 86400;
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()),
    c.env.DB.prepare('INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)').bind(await sha256(token), Date.now() + maxAge * 1000),
  ]);
  setCookie(c, COOKIE, token, {
    path: '/', httpOnly: true, sameSite: 'Lax', maxAge,
    secure: new URL(c.req.url).protocol === 'https:',
  });
}

export async function logout(c: Ctx) {
  const t = getCookie(c, COOKIE);
  if (t) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(t)).run();
  deleteCookie(c, COOKIE, { path: '/' });
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const t = getCookie(c, COOKIE);
  if (t) {
    const row = await c.env.DB.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').bind(await sha256(t)).first<{ expires_at: number }>();
    if (row && row.expires_at > Date.now()) return next();
  }
  return c.json({ error: 'Faça login para continuar.' }, 401);
};

export async function changePassword(c: Ctx, current: string, next: string) {
  const stored = await storedHash(c);
  if (!stored || !(await verifyPassword(current, stored))) throw bad('Senha atual incorreta.');
  if (next.length < 6) throw bad('A nova senha precisa ter pelo menos 6 caracteres.');
  await setInternal(c.env.DB, 'password_hash', await hashPassword(next));
}
