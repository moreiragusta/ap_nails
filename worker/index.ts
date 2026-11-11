import { Hono } from 'hono';
import { nowIn } from '../shared/time';
import { login, logout, requireAuth } from './auth';
import { getSettings } from './db';
import { HttpError, type AppEnv, type Env } from './env';
import { runScheduled } from './cron';
import { appointmentRoutes } from './routes/appointments';
import { clientRoutes } from './routes/clients';
import { financeRoutes } from './routes/finance';
import { publicRoutes } from './routes/public';
import { serviceRoutes } from './routes/services';
import { settingsRoutes } from './routes/settings';

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.message, ...err.extra }, err.status as 400);
  }
  console.error(err);
  return c.json({ error: 'Algo deu errado. Tente novamente.' }, 500);
});

// Fotos dos serviços (R2), com cache longo: a chave muda a cada nova foto.
app.get('/photos/*', async (c) => {
  const key = c.req.path.replace(/^\/photos\//, '');
  const obj = await c.env.PHOTOS.get(key);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

app.route('/api/public', publicRoutes);

// ---------------------------------------------------------------- painel
const admin = new Hono<AppEnv>();

admin.post('/login', async (c) => {
  const { password } = await c.req.json<{ password: string }>().catch(() => ({ password: '' }));
  await login(c, String(password ?? ''));
  return c.json({ ok: true });
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
