import { Hono } from 'hono';
import { nowIn } from '../shared/time';
import { hasPassword, lockStatus, login, logout, recoverWithCode, requireAuth, setupWithToken } from './auth';
import { runScheduled } from './cron';
import { getSettings } from './db';
import { HttpError, type AppEnv, type Env } from './env';
import { appointmentRoutes } from './routes/appointments';
import { clientRoutes } from './routes/clients';
import { financeRoutes } from './routes/finance';
import { publicRoutes } from './routes/public';
import { serviceRoutes } from './routes/services';
import { settingsRoutes } from './routes/settings';
import { apiHeaders, clientIp, geoBlocked, geoGuard, ipBlock, requireHttps, sameOrigin, verifyTurnstile } from './security';

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.message, ...err.extra }, err.status as 400);
  }
  console.error(err);
  return c.json({ error: 'Algo deu errado. Tente novamente.' }, 500);
});

app.use('*', requireHttps);
app.use('/api/*', apiHeaders);

// Fotos dos serviços (R2), com cache longo: a chave muda a cada nova foto.
app.get('/photos/*', async (c) => {
  const key = c.req.path.replace(/^\/photos\//, '');
  if (!/^services\/[\w.-]+$/.test(key)) return c.notFound();
  const obj = await c.env.PHOTOS.get(key);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
});

app.use('/api/public/*', sameOrigin);
app.route('/api/public', publicRoutes);

// ---------------------------------------------------------------- painel
const admin = new Hono<AppEnv>();
admin.use('*', sameOrigin);
admin.use('*', geoGuard); // painel só nos países liberados (padrão: Brasil)

/** Dados para a tela de entrada: antirrobô e se a senha já foi criada. */
admin.get('/auth/config', async (c) => c.json({
  turnstile_site_key: c.env.TURNSTILE_SITE_KEY || null,
  has_password: await hasPassword(c.env.DB),
  locked_until: await lockStatus(c.env.DB),
  ip_locked_until: await ipBlock(c.env.DB, clientIp(c)).then((b) => (b && b.until > Date.now() ? b.until : null)),
  geo_blocked: await geoBlocked(c),
}));

admin.post('/login', async (c) => {
  const b = await c.req.json<{ password?: string; turnstile?: string }>().catch(() => ({} as { password?: string; turnstile?: string }));
  await verifyTurnstile(c, b.turnstile);
  await login(c, b.password);
  return c.json({ ok: true });
});

admin.post('/setup', async (c) => {
  const b = await c.req.json<{ token?: string; password?: string; turnstile?: string }>().catch(() => ({} as Record<string, string>));
  await verifyTurnstile(c, b.turnstile);
  const recovery_code = await setupWithToken(c, b.token, b.password);
  return c.json({ ok: true, recovery_code });
});

admin.post('/recover', async (c) => {
  const b = await c.req.json<{ code?: string; password?: string; turnstile?: string }>().catch(() => ({} as Record<string, string>));
  await verifyTurnstile(c, b.turnstile);
  const recovery_code = await recoverWithCode(c, b.code, b.password);
  return c.json({ ok: true, recovery_code });
});

admin.post('/logout', async (c) => {
  await logout(c);
  return c.json({ ok: true });
});

admin.use('*', requireAuth);
admin.get('/me', async (c) => {
  const now = nowIn(c.env.BUSINESS_TZ);
  return c.json({ today: now.date, minutes: now.minutes, settings: await getSettings(c.env.DB) });
});
admin.route('/appointments', appointmentRoutes);
admin.route('/services', serviceRoutes);
admin.route('/clients', clientRoutes);
admin.route('/finance', financeRoutes);
admin.route('/settings', settingsRoutes);

app.route('/api/admin', admin);
app.all('/api/*', (c) => c.json({ error: 'Rota não encontrada.' }, 404));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(env));
  },
} satisfies ExportedHandler<Env>;
