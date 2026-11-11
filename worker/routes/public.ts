import { Hono } from 'hono';
import { fmtDateShort } from '../../shared/format';
import { addDays, isDate, isTime, nowIn, toHHMM, toMin } from '../../shared/time';
import { PUBLIC_SETTING_KEYS } from '../../shared/types';
import { getService, getSettings, listServices, loadWeekly, slotsForRange, upsertClient } from '../db';
import { bad, nowISO, type AppEnv } from '../env';
import { notifyAdmin } from '../push';
import { normalizePhone, text, validPhone } from '../util';

export const publicRoutes = new Hono<AppEnv>();

/** Dados da landing: serviços ativos (com foto), contatos e semana padrão. */
publicRoutes.get('/catalog', async (c) => {
  const [settings, services, weekly] = await Promise.all([
    getSettings(c.env.DB), listServices(c.env.DB, true), loadWeekly(c.env.DB),
  ]);
  const business = Object.fromEntries(PUBLIC_SETTING_KEYS.map((k) => [k, settings[k]]));
  c.header('Cache-Control', 'no-store');
  return c.json({ business, services: services.map(({ active: _a, sort: _s, ...s }) => s), weekly });
});

/** Dias e horários livres para um serviço, dentro da janela de agendamento. */
publicRoutes.get('/availability', async (c) => {
  const svc = await getService(c.env.DB, Number(c.req.query('service_id')));
  if (!svc || !svc.active) throw bad('Serviço indisponível.', 404);
  const settings = await getSettings(c.env.DB);
  const today = nowIn(c.env.BUSINESS_TZ).date;
  const days = await slotsForRange(c.env, svc.duration_min, today, addDays(today, settings.window_days - 1), { publicMode: true });
  c.header('Cache-Control', 'no-store');
  return c.json({ today, days });
});

publicRoutes.post('/book', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const name = text(body.name, 80);
  const phone = normalizePhone(body.phone);
  const date = body.date;
  const time = body.time;
  if (name.length < 2) throw bad('Informe seu nome.');
  if (!validPhone(phone)) throw bad('Informe um WhatsApp válido, com DDD.');
  if (!isDate(date) || !isTime(time)) throw bad('Escolha o dia e o horário.');

  const db = c.env.DB;
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  const hourAgo = Date.now() - 3600_000;
  const attempts = await db.prepare('SELECT COUNT(*) AS n FROM booking_attempts WHERE ip = ? AND at > ?').bind(ip, hourAgo).first<{ n: number }>();
  if ((attempts?.n ?? 0) >= 10) throw bad('Muitas tentativas. Tente de novo mais tarde ou chame no WhatsApp.', 429);
  await db.batch([
    db.prepare('DELETE FROM booking_attempts WHERE at < ?').bind(hourAgo),
    db.prepare('INSERT INTO booking_attempts (ip, at) VALUES (?, ?)').bind(ip, Date.now()),
  ]);

  const svc = await getService(db, Number(body.service_id));
  if (!svc || !svc.active || !svc.photo_key) throw bad('Esse serviço não está disponível.');

  const pending = await db.prepare(
    `SELECT COUNT(*) AS n FROM appointments a JOIN clients c ON c.id = a.client_id
     WHERE c.phone = ? AND a.status = 'pending'`,
  ).bind(phone).first<{ n: number }>();
  if ((pending?.n ?? 0) >= 2) {
    throw bad('Você já tem agendamentos aguardando confirmação. A Amanda vai falar com você pelo WhatsApp.', 409);
  }

  const [day] = await slotsForRange(c.env, svc.duration_min, date, date, { publicMode: true });
  const settings = await getSettings(db);
  const today = nowIn(c.env.BUSINESS_TZ).date;
  if (date > addDays(today, settings.window_days - 1) || !day.slots.includes(time)) {
    throw bad('Esse horário acabou de ser ocupado. Escolha outro, por favor.', 409, { code: 'slot_taken' });
  }

  const clientId = await upsertClient(db, name, phone);
  const end = toHHMM(toMin(time) + svc.duration_min);
  // Inserção condicional: só grava se ninguém ocupou o horário entre a checagem e agora.
  const inserted = await db.prepare(
    `INSERT INTO appointments (client_id, service_id, service_name, price_cents, duration_min, date, start_time, end_time, status, source, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'site', ?
     WHERE NOT EXISTS (
       SELECT 1 FROM appointments WHERE date = ? AND status IN ('pending','confirmed','done') AND start_time < ? AND end_time > ?
     ) RETURNING id`,
  ).bind(clientId, svc.id, svc.name, svc.price_cents, svc.duration_min, date, time, end, nowISO(), date, end, time).first<{ id: number }>();
  if (!inserted) throw bad('Esse horário acabou de ser ocupado. Escolha outro, por favor.', 409, { code: 'slot_taken' });

  c.executionCtx.waitUntil(notifyAdmin(c.env, {
    title: 'Novo agendamento 💅',
    body: `${name} · ${svc.name} · ${fmtDateShort(date)} ${time}`,
    url: `/admin?appt=${inserted.id}`,
    tag: `appt-${inserted.id}`,
  }));

  return c.json({
    ok: true,
    appointment: { id: inserted.id, service_name: svc.name, price_cents: svc.price_cents, date, start_time: time, end_time: end },
  });
});
