import { Hono } from 'hono';
import { isDate, isTime, nowIn, toMin } from '../../shared/time';
import { DEFAULT_SETTINGS, type ExceptionKind, type Settings } from '../../shared/types';
import { changePassword, describeDevice, listSessions, recoveryInfo, regenerateRecovery, revokeSessions } from '../auth';
import { getSettings, loadExceptions, loadWeekly, saveSettings } from '../db';
import { bad, type AppEnv } from '../env';
import { notifyAdmin } from '../push';
import { logEvent } from '../security';
import { idParam, longText, normalizePhone, text } from '../util';

export const settingsRoutes = new Hono<AppEnv>();

settingsRoutes.get('/', async (c) => c.json(await getSettings(c.env.DB)));

settingsRoutes.put('/', async (c) => {
  const b = await c.req.json<Partial<Settings>>();
  const patch: Partial<Settings> = {};
  const str = (k: 'business_name' | 'owner_name' | 'address' | 'maps_url' | 'instagram', max = 200) => {
    if (b[k] !== undefined) patch[k] = text(b[k], max);
  };
  str('business_name', 60); str('owner_name', 60); str('address', 200); str('maps_url', 500);
  if (b.instagram !== undefined) patch.instagram = text(b.instagram, 60).replace(/^@/, '');
  if (b.whatsapp !== undefined) patch.whatsapp = normalizePhone(b.whatsapp);
  if (b.booking_mode !== undefined) {
    if (!['blocks', 'free'].includes(b.booking_mode)) throw bad('Modo de encaixe inválido.');
    patch.booking_mode = b.booking_mode;
  }
  const num = (k: 'slot_step_min' | 'buffer_min' | 'min_advance_min' | 'window_days' | 'missing_after_days', min: number, max: number, label: string) => {
    if (b[k] === undefined) return;
    const n = Number(b[k]);
    if (!Number.isInteger(n) || n < min || n > max) throw bad(`Valor inválido para ${label}.`);
    patch[k] = n;
  };
  num('slot_step_min', 5, 120, 'intervalo entre horários');
  num('buffer_min', 0, 120, 'intervalo entre atendimentos');
  num('min_advance_min', 0, 7 * 24 * 60, 'antecedência mínima');
  num('window_days', 1, 365, 'janela de agendamento');
  num('missing_after_days', 7, 365, 'clientes sumidas');
  for (const k of ['tpl_confirm', 'tpl_reminder', 'tpl_reschedule'] as const) {
    if (b[k] !== undefined) patch[k] = longText(b[k], 1500) || DEFAULT_SETTINGS[k];
  }
  if (b.reminder_when !== undefined) {
    if (!['same_day', 'day_before'].includes(b.reminder_when)) throw bad('Opção de lembrete inválida.');
    patch.reminder_when = b.reminder_when;
  }
  if (b.reminder_notice_time !== undefined) {
    if (!isTime(b.reminder_notice_time)) throw bad('Horário do aviso inválido.');
    patch.reminder_notice_time = b.reminder_notice_time;
  }
  if (b.expense_categories !== undefined) {
    const cats = [...new Set((b.expense_categories ?? []).map((x) => text(x, 40)).filter(Boolean))];
    if (!cats.length) throw bad('Mantenha pelo menos uma categoria.');
    patch.expense_categories = cats;
  }
  await saveSettings(c.env.DB, patch);
  return c.json(await getSettings(c.env.DB));
});

// ---------------------------------------------------------- semana padrão

settingsRoutes.get('/hours', async (c) => c.json(await loadWeekly(c.env.DB)));

settingsRoutes.put('/hours', async (c) => {
  const rows = await c.req.json<{ weekday: number; open: boolean; start_time: string; end_time: string }[]>();
  if (!Array.isArray(rows)) throw bad('Dados inválidos.');
  for (const r of rows) {
    if (!Number.isInteger(r.weekday) || r.weekday < 0 || r.weekday > 6) throw bad('Dia inválido.');
    if (!isTime(r.start_time) || !isTime(r.end_time) || toMin(r.end_time) <= toMin(r.start_time)) {
      throw bad('Confira os horários: o fim precisa ser depois do início.');
    }
  }
  const stmt = c.env.DB.prepare(
    'INSERT INTO weekly_hours (weekday, open, start_time, end_time) VALUES (?, ?, ?, ?) ON CONFLICT(weekday) DO UPDATE SET open = excluded.open, start_time = excluded.start_time, end_time = excluded.end_time',
  );
  await c.env.DB.batch(rows.map((r) => stmt.bind(r.weekday, r.open ? 1 : 0, r.start_time, r.end_time)));
  return c.json(await loadWeekly(c.env.DB));
});

// ---------------------------------------------------------- exceções por data

settingsRoutes.get('/exceptions', async (c) => {
  const today = nowIn(c.env.BUSINESS_TZ).date;
  return c.json(await loadExceptions(c.env.DB, c.req.query('from') ?? today, c.req.query('to') ?? '9999-12-31'));
});

settingsRoutes.post('/exceptions', async (c) => {
  const b = await c.req.json<{ kind: ExceptionKind; date_from: string; date_to?: string; start_time?: string; end_time?: string; reason?: string }>();
  if (!['closed', 'block', 'special'].includes(b.kind)) throw bad('Tipo inválido.');
  if (!isDate(b.date_from)) throw bad('Informe a data.');
  const to = b.kind === 'closed' && b.date_to ? b.date_to : b.date_from;
  if (!isDate(to) || to < b.date_from) throw bad('A data final precisa ser depois da inicial.');
  let start: string | null = null;
  let end: string | null = null;
  if (b.kind !== 'closed') {
    if (!isTime(b.start_time) || !isTime(b.end_time) || toMin(b.end_time) <= toMin(b.start_time)) {
      throw bad('Informe o horário de início e fim.');
    }
    start = b.start_time; end = b.end_time;
  }
  if (b.kind === 'special') {
    await c.env.DB.prepare("DELETE FROM date_exceptions WHERE kind = 'special' AND date_from = ?").bind(b.date_from).run();
  }
  const r = await c.env.DB.prepare(
    'INSERT INTO date_exceptions (kind, date_from, date_to, start_time, end_time, reason) VALUES (?, ?, ?, ?, ?, ?) RETURNING *',
  ).bind(b.kind, b.date_from, to, start, end, text(b.reason, 120)).first();

  // Avisa se já existem atendimentos na data afetada.
  const { results } = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM appointments WHERE date BETWEEN ? AND ? AND status IN ('pending','confirmed')",
  ).bind(b.date_from, to).all<{ n: number }>();
  return c.json({ exception: r, affected: results[0]?.n ?? 0 }, 201);
});

settingsRoutes.delete('/exceptions/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM date_exceptions WHERE id = ?').bind(idParam(c.req.param('id'))).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------- senha e notificações

settingsRoutes.post('/password', async (c) => {
  const { current, next } = await c.req.json<{ current?: string; next?: string }>();
  await changePassword(c, c.get('sessionId'), current, next);
  return c.json({ ok: true });
});

/** Gera um novo código de recuperação (o anterior deixa de valer). Exige a senha atual. */
settingsRoutes.post('/recovery-code', async (c) => {
  const { current } = await c.req.json<{ current?: string }>();
  return c.json({ recovery_code: await regenerateRecovery(c, current) });
});

/** Aparelhos conectados, histórico recente e situação do código de recuperação. */
settingsRoutes.get('/security', async (c) => {
  const sessions = (await listSessions(c, c.get('sessionId'))).map(({ user_agent, ip: _ip, ...s }) => ({ ...s, device: describeDevice(user_agent) }));
  const { results } = await c.env.DB.prepare('SELECT type, user_agent, at FROM security_events ORDER BY at DESC LIMIT 15')
    .all<{ type: string; user_agent: string; at: number }>();
  return c.json({
    sessions,
    events: results.map((e) => ({ type: e.type, at: e.at, device: describeDevice(e.user_agent) })),
    recovery: await recoveryInfo(c.env.DB),
  });
});

settingsRoutes.post('/sessions/revoke-others', async (c) => {
  await revokeSessions(c, c.get('sessionId'));
  await logEvent(c, 'sessions_revoked');
  return c.json({ ok: true });
});

settingsRoutes.delete('/sessions/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  if (id === c.get('sessionId')) throw bad('Para sair deste aparelho, use “Sair deste celular”.');
  await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
  await logEvent(c, 'sessions_revoked', 'um aparelho');
  return c.json({ ok: true });
});

settingsRoutes.get('/push/key', (c) => c.json({ key: c.env.VAPID_PUBLIC_KEY || null }));

settingsRoutes.post('/push/subscribe', async (c) => {
  const sub = await c.req.json<{ endpoint: string; keys: { p256dh: string; auth: string } }>();
  if (!sub?.endpoint?.startsWith('https://') || !sub.keys?.p256dh || !sub.keys?.auth) throw bad('Inscrição inválida.');
  await c.env.DB.prepare(
    'INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth',
  ).bind(sub.endpoint, sub.keys.p256dh, sub.keys.auth).run();
  return c.json({ ok: true });
});

settingsRoutes.post('/push/test', async (c) => {
  const sent = await notifyAdmin(c.env, { title: 'Notificações ativadas 💅', body: 'Você vai ser avisada a cada novo agendamento.', url: '/admin', tag: 'test' });
  return c.json({ sent });
});
