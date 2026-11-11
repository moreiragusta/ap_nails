// Tarefas automáticas (Cron Trigger a cada 15 minutos).
import { fmtDateShort } from '../shared/format';
import { addDays, localToUtcMs, nowIn, toMin } from '../shared/time';
import { getInternal, getSettings, setInternal } from './db';
import { nowISO, type Env } from './env';
import { notifyAdmin } from './push';
import { purgeSecurityData } from './security';

const H = 3600_000;

export async function runScheduled(env: Env) {
  await Promise.all([alertUnsent(env), expireUnanswered(env), reminderNotice(env), purgeSecurityData(env.DB)]);
}

/** Agendamentos do site sem confirmação enviada há 3h: avisa a Amanda (uma vez). */
async function alertUnsent(env: Env) {
  const limit = new Date(Date.now() - 3 * H).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.date, a.start_time, c.name FROM appointments a JOIN clients c ON c.id = a.client_id
     WHERE a.status = 'pending' AND a.confirmation_sent_at IS NULL AND a.alert_sent_at IS NULL AND a.created_at <= ?`,
  ).bind(limit).all<{ id: number; date: string; start_time: string; name: string }>();
  for (const a of results) {
    await notifyAdmin(env, {
      title: 'Confirmação pendente',
      body: `${a.name} ainda não recebeu a confirmação (${fmtDateShort(a.date)} ${a.start_time}).`,
      url: `/admin?appt=${a.id}`,
      tag: `alert-${a.id}`,
    });
    await env.DB.prepare('UPDATE appointments SET alert_sent_at = ? WHERE id = ?').bind(nowISO(), a.id).run();
  }
}

/**
 * Expira agendamentos aguardando há 48h após o envio da confirmação.
 * Não expira se o atendimento for antes do fim do prazo (fica para a Amanda decidir).
 */
async function expireUnanswered(env: Env) {
  const limit = new Date(Date.now() - 48 * H).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.date, a.start_time, a.confirmation_sent_at, c.name FROM appointments a JOIN clients c ON c.id = a.client_id
     WHERE a.status = 'pending' AND a.confirmation_sent_at IS NOT NULL AND a.confirmation_sent_at <= ?`,
  ).bind(limit).all<{ id: number; date: string; start_time: string; confirmation_sent_at: string; name: string }>();
  for (const a of results) {
    const deadline = Date.parse(a.confirmation_sent_at) + 48 * H;
    const startsAt = localToUtcMs(a.date, a.start_time, env.BUSINESS_TZ);
    if (startsAt <= deadline) continue;
    const r = await env.DB.prepare("UPDATE appointments SET status = 'expired', expired_at = ? WHERE id = ? AND status = 'pending'")
      .bind(nowISO(), a.id).run();
    if (r.meta.changes) {
      await notifyAdmin(env, {
        title: 'Horário liberado',
        body: `${a.name} não confirmou em 48h. O horário de ${fmtDateShort(a.date)} ${a.start_time} foi liberado.`,
        url: '/admin?view=expired',
        tag: `expired-${a.id}`,
      });
    }
  }
}

/** No horário configurado, avisa quantos lembretes há para enviar (uma vez por dia). */
async function reminderNotice(env: Env) {
  const settings = await getSettings(env.DB);
  const now = nowIn(env.BUSINESS_TZ);
  if (now.minutes < toMin(settings.reminder_notice_time)) return;
  if ((await getInternal(env.DB, 'last_reminder_notice')) === now.date) return;
  await setInternal(env.DB, 'last_reminder_notice', now.date);

  const target = settings.reminder_when === 'day_before' ? addDays(now.date, 1) : now.date;
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM appointments WHERE status = 'confirmed' AND date = ? AND reminder_sent_at IS NULL",
  ).bind(target).first<{ n: number }>();
  const n = r?.n ?? 0;
  if (!n) return;
  const quando = settings.reminder_when === 'day_before' ? 'de amanhã' : 'de hoje';
  await notifyAdmin(env, {
    title: 'Lembretes para enviar',
    body: n === 1 ? `1 cliente ${quando} para lembrar.` : `${n} clientes ${quando} para lembrar.`,
    url: '/admin?view=reminders',
    tag: `reminders-${now.date}`,
  });
}
