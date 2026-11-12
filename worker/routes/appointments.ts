import { Hono } from 'hono';
import { addDays, isDate, isTime, nowIn, toHHMM, toMin } from '../../shared/time';
import type { Appointment, PaymentMethod } from '../../shared/types';
import {
  APPT_SELECT, findConflict, getAppointment, getService, getSettings, slotsForRange, upsertClient,
} from '../db';
import { bad, nowISO, type AppEnv, type Ctx } from '../env';
import { fmtDateShort, fmtMoney } from '../../shared/format';
import { audit } from '../security';
import { idParam, longText, normalizePhone, text, validPhone } from '../util';

export const appointmentRoutes = new Hono<AppEnv>();

const PAYMENTS: PaymentMethod[] = ['pix', 'cash', 'debit', 'credit'];

/** Lista por dia (?date), período (?from&to) e/ou status (?status=a,b). */
appointmentRoutes.get('/', async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const args: unknown[] = [];
  if (isDate(q.date)) { where.push('a.date = ?'); args.push(q.date); }
  if (isDate(q.from)) { where.push('a.date >= ?'); args.push(q.from); }
  if (isDate(q.to)) { where.push('a.date <= ?'); args.push(q.to); }
  if (q.status) {
    const st = q.status.split(',').filter((s) => /^[a-z_]+$/.test(s));
    where.push(`a.status IN (${st.map(() => '?').join(',')})`);
    args.push(...st);
  }
  if (q.client_id) { where.push('a.client_id = ?'); args.push(Number(q.client_id)); }
  const sql = `${APPT_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.date, a.start_time LIMIT 500`;
  const { results } = await c.env.DB.prepare(sql).bind(...args).all<Appointment>();
  return c.json(results);
});

/** O que pede atenção agora: aguardando, lembretes para enviar e expirados recentes. */
appointmentRoutes.get('/attention', async (c) => {
  const db = c.env.DB;
  const settings = await getSettings(db);
  const today = nowIn(c.env.BUSINESS_TZ).date;
  const reminderDate = settings.reminder_when === 'day_before' ? addDays(today, 1) : today;
  const [pending, reminders, expired] = await Promise.all([
    db.prepare(`${APPT_SELECT} WHERE a.status = 'pending' ORDER BY a.date, a.start_time`).all<Appointment>(),
    db.prepare(`${APPT_SELECT} WHERE a.status = 'confirmed' AND a.date = ? AND a.reminder_sent_at IS NULL ORDER BY a.start_time`)
      .bind(reminderDate).all<Appointment>(),
    db.prepare(`${APPT_SELECT} WHERE a.status = 'expired' AND a.date >= ? ORDER BY a.date, a.start_time`).bind(today).all<Appointment>(),
  ]);
  return c.json({ today, reminder_date: reminderDate, pending: pending.results, reminders: reminders.results, expired: expired.results });
});

/** Horários livres de um dia para o painel (sem antecedência mínima e sem limite de janela). */
appointmentRoutes.get('/slots', async (c) => {
  const date = c.req.query('date');
  const svc = await getService(c.env.DB, Number(c.req.query('service_id')));
  if (!isDate(date) || !svc) throw bad('Informe data e serviço.');
  const excludeId = c.req.query('exclude_id') ? Number(c.req.query('exclude_id')) : null;
  const [free] = await slotsForRange(c.env, svc.duration_min, date, date, { publicMode: false, excludeId });
  const [blocks] = await slotsForRange(c.env, svc.duration_min, date, date, { publicMode: true, excludeId });
  return c.json({ slots: free.slots, suggested: blocks.slots });
});

/** Agendamento + contexto da cliente (visitas, total gasto, última visita, observações). */
appointmentRoutes.get('/:id', async (c) => {
  const a = await getAppointment(c.env.DB, idParam(c.req.param('id')));
  if (!a) throw bad('Agendamento não encontrado.', 404);
  const ctx = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM appointments WHERE client_id = ?1 AND status = 'done') AS visits,
       (SELECT COALESCE(SUM(price_cents), 0) FROM appointments WHERE client_id = ?1 AND status = 'done') AS total_cents,
       (SELECT MAX(date) FROM appointments WHERE client_id = ?1 AND status = 'done' AND id <> ?2 AND date <= ?3) AS last_visit,
       (SELECT notes FROM clients WHERE id = ?1) AS notes`,
  ).bind(a.client_id, a.id, a.date).first<{ visits: number; total_cents: number; last_visit: string | null; notes: string }>();
  return c.json({ ...a, client: ctx });
});

/** Agendamento lançado pela Amanda: já nasce confirmado. */
appointmentRoutes.post('/', async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const db = c.env.DB;
  let clientId: number;
  if (b.client_id) {
    clientId = Number(b.client_id);
    const exists = await db.prepare('SELECT id FROM clients WHERE id = ?').bind(clientId).first();
    if (!exists) throw bad('Cliente não encontrada.');
  } else {
    const name = text(b.client_name, 80);
    const phone = normalizePhone(b.client_phone);
    if (name.length < 2) throw bad('Informe o nome da cliente.');
    if (!validPhone(phone)) throw bad('Informe um WhatsApp válido, com DDD.');
    clientId = await upsertClient(db, name, phone);
  }
  const svc = await getService(db, Number(b.service_id));
  if (!svc) throw bad('Escolha o serviço.');
  const { date, start_time: start } = b;
  if (!isDate(date) || !isTime(start)) throw bad('Informe data e horário.');
  const end = toHHMM(toMin(start) + svc.duration_min);
  if (toMin(start) + svc.duration_min > 24 * 60) throw bad('O atendimento passaria da meia-noite.');
  await assertFree(c, date, start, end, null, !!b.force);

  const now = nowISO();
  const r = await db.prepare(
    `INSERT INTO appointments (client_id, service_id, service_name, price_cents, duration_min, date, start_time, end_time,
       status, source, notes, confirmed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 'admin', ?, ?, ?) RETURNING id`,
  ).bind(clientId, svc.id, svc.name, svc.price_cents, svc.duration_min, date, start, end, longText(b.notes, 1000), now, now).first<{ id: number }>();
  const created = await getAppointment(db, r!.id);
  await audit(c, 'appt_created', `${created?.client_name} · ${svc.name} · ${fmtDateShort(date)} ${start}${b.force ? ' · encaixe forçado' : ''}`);
  return c.json(created, 201);
});

/** Remarcar, trocar serviço ou editar observações. */
appointmentRoutes.patch('/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  const db = c.env.DB;
  const a = await getAppointment(db, id);
  if (!a) throw bad('Agendamento não encontrado.', 404);
  const b = await c.req.json<Record<string, unknown>>();

  let { service_id, service_name, price_cents, duration_min, date, start_time } = a;
  if (b.service_id !== undefined && Number(b.service_id) !== a.service_id) {
    const svc = await getService(db, Number(b.service_id));
    if (!svc) throw bad('Serviço não encontrado.');
    ({ id: service_id, name: service_name, price_cents, duration_min } = svc);
  }
  if (b.date !== undefined) { if (!isDate(b.date)) throw bad('Data inválida.'); date = b.date; }
  if (b.start_time !== undefined) { if (!isTime(b.start_time)) throw bad('Horário inválido.'); start_time = b.start_time; }
  const end = toHHMM(toMin(start_time) + duration_min);
  const moved = date !== a.date || start_time !== a.start_time || duration_min !== a.duration_min;
  if (moved && ['pending', 'confirmed'].includes(a.status)) await assertFree(c, date, start_time, end, id, !!b.force);

  const notes = b.notes !== undefined ? longText(b.notes, 1000) : a.notes;
  // Remarcar zera o lembrete: a cliente precisa ser lembrada da nova data.
  await db.prepare(
    `UPDATE appointments SET service_id = ?, service_name = ?, price_cents = ?, duration_min = ?, date = ?, start_time = ?,
       end_time = ?, notes = ?, reminder_sent_at = CASE WHEN ? THEN NULL ELSE reminder_sent_at END WHERE id = ?`,
  ).bind(service_id, service_name, price_cents, duration_min, date, start_time, end, notes, moved ? 1 : 0, id).run();
  const changes: string[] = [];
  if (date !== a.date || start_time !== a.start_time) changes.push(`${fmtDateShort(a.date)} ${a.start_time} → ${fmtDateShort(date)} ${start_time}`);
  if (service_id !== a.service_id) changes.push(`${a.service_name} → ${service_name}`);
  if (price_cents !== a.price_cents) changes.push(`${fmtMoney(a.price_cents)} → ${fmtMoney(price_cents)}`);
  if (changes.length) await audit(c, 'appt_updated', `${a.client_name} · ${changes.join(' · ')}`);
  return c.json(await getAppointment(db, id));
});

/** Ações de status e registros de envio pelo WhatsApp. */
appointmentRoutes.post('/:id/action', async (c) => {
  const id = idParam(c.req.param('id'));
  const db = c.env.DB;
  const a = await getAppointment(db, id);
  if (!a) throw bad('Agendamento não encontrado.', 404);
  const { action, payment_method, force } = await c.req.json<{ action: string; payment_method?: string; force?: boolean }>();
  const now = nowISO();
  const set = (sql: string, ...args: unknown[]) => db.prepare(`UPDATE appointments SET ${sql} WHERE id = ?`).bind(...args, id).run();
  const need = (...st: string[]) => {
    if (!st.includes(a.status)) throw bad('Essa ação não vale para o status atual do agendamento.');
  };

  switch (action) {
    case 'confirmation_sent':
      need('pending');
      await set('confirmation_sent_at = ?', now);
      break;
    case 'undo_confirmation_sent':
      need('pending');
      await set('confirmation_sent_at = NULL');
      break;
    case 'confirm':
      need('pending');
      await set("status = 'confirmed', confirmed_at = ?", now);
      break;
    case 'reminder_sent':
      need('confirmed');
      await set('reminder_sent_at = ?', now);
      break;
    case 'undo_reminder_sent':
      await set('reminder_sent_at = NULL');
      break;
    case 'complete': {
      need('confirmed', 'pending', 'done');
      if (!PAYMENTS.includes(payment_method as PaymentMethod)) throw bad('Escolha a forma de pagamento.');
      await set("status = 'done', payment_method = ?, completed_at = COALESCE(completed_at, ?), confirmed_at = COALESCE(confirmed_at, ?)",
        payment_method, now, now);
      break;
    }
    case 'cancel':
      need('pending', 'confirmed');
      await set("status = 'cancelled', cancelled_at = ?", now);
      break;
    case 'reopen': {
      need('cancelled', 'expired', 'done');
      if (a.status !== 'done') await assertFree(c, a.date, a.start_time, a.end_time, id, !!force);
      // Concluído volta para confirmado (ex.: forma de pagamento errada); cancelado/expirado volta a aguardar.
      if (a.status === 'done') await set("status = 'confirmed', completed_at = NULL, payment_method = NULL");
      else await set("status = 'pending', cancelled_at = NULL, expired_at = NULL, confirmation_sent_at = NULL, alert_sent_at = NULL");
      break;
    }
    default:
      throw bad('Ação desconhecida.');
  }
  const AUDITED: Record<string, string> = { confirm: 'appt_confirmed', complete: 'appt_completed', cancel: 'appt_cancelled', reopen: 'appt_reopened' };
  if (AUDITED[action]) {
    const extra = action === 'complete' ? ` · ${fmtMoney(a.price_cents)} · ${payment_method}` : action === 'reopen' ? ` · estava ${a.status}` : '';
    await audit(c, AUDITED[action], `${a.client_name} · ${fmtDateShort(a.date)} ${a.start_time}${extra}`);
  }
  return c.json(await getAppointment(db, id));
});

async function assertFree(c: Ctx, date: string, start: string, end: string, excludeId: number | null, force: boolean) {
  const conflict = await findConflict(c.env, date, start, end, excludeId);
  if (conflict && !force) throw bad(conflict, 409, { code: 'conflict', can_force: true });
}
