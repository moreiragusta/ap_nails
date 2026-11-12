import { Hono } from 'hono';
import { addDays, nowIn } from '../../shared/time';
import type { Appointment, Client } from '../../shared/types';
import { APPT_SELECT, getSettings } from '../db';
import { bad, type AppEnv } from '../env';
import { audit } from '../security';
import { idParam, longText, normalizePhone, text, validPhone } from '../util';

export const clientRoutes = new Hono<AppEnv>();

const CLIENT_SELECT = `
  SELECT c.*,
    (SELECT COUNT(*) FROM appointments a WHERE a.client_id = c.id AND a.status = 'done') AS visits,
    (SELECT COALESCE(SUM(price_cents), 0) FROM appointments a WHERE a.client_id = c.id AND a.status = 'done') AS total_cents,
    (SELECT MAX(date) FROM appointments a WHERE a.client_id = c.id AND a.status = 'done') AS last_visit,
    (SELECT MIN(date) FROM appointments a WHERE a.client_id = c.id AND a.status IN ('pending','confirmed') AND a.date >= ?) AS next_visit
  FROM clients c`;

/** ?q= busca por nome/telefone · ?filter=missing lista clientes sumidas. */
clientRoutes.get('/', async (c) => {
  const today = nowIn(c.env.BUSINESS_TZ).date;
  const q = text(c.req.query('q'), 60);
  const filter = c.req.query('filter');
  let sql = `SELECT * FROM (${CLIENT_SELECT}) t`;
  const args: unknown[] = [today];
  const where: string[] = [];
  if (q) {
    const digits = q.replace(/\D/g, '');
    where.push(digits.length >= 3 ? '(name LIKE ? OR phone LIKE ?)' : 'name LIKE ?');
    args.push(`%${q}%`);
    if (digits.length >= 3) args.push(`%${digits}%`);
  }
  if (filter === 'missing') {
    const settings = await getSettings(c.env.DB);
    where.push('last_visit IS NOT NULL AND last_visit <= ? AND next_visit IS NULL');
    args.push(addDays(today, -settings.missing_after_days));
  }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += filter === 'missing' ? ' ORDER BY last_visit' : ' ORDER BY name COLLATE NOCASE';
  const { results } = await c.env.DB.prepare(`${sql} LIMIT 300`).bind(...args).all<Client>();
  return c.json(results);
});

clientRoutes.get('/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  const today = nowIn(c.env.BUSINESS_TZ).date;
  const client = await c.env.DB.prepare(`${CLIENT_SELECT} WHERE c.id = ?`).bind(today, id).first<Client>();
  if (!client) throw bad('Cliente não encontrada.', 404);
  const { results } = await c.env.DB.prepare(`${APPT_SELECT} WHERE a.client_id = ? ORDER BY a.date DESC, a.start_time DESC`)
    .bind(id).all<Appointment>();
  return c.json({ ...client, history: results });
});

clientRoutes.put('/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  const b = await c.req.json<Record<string, unknown>>();
  const name = text(b.name, 80);
  const phone = normalizePhone(b.phone);
  if (name.length < 2) throw bad('Informe o nome.');
  if (!validPhone(phone)) throw bad('WhatsApp inválido.');
  const dup = await c.env.DB.prepare('SELECT id FROM clients WHERE phone = ? AND id <> ?').bind(phone, id).first();
  if (dup) throw bad('Já existe outra cliente com esse WhatsApp.');
  const before = await c.env.DB.prepare('SELECT name, phone FROM clients WHERE id = ?').bind(id).first<{ name: string; phone: string }>();
  if (!before) throw bad('Cliente não encontrada.', 404);
  await c.env.DB.prepare('UPDATE clients SET name = ?, phone = ?, notes = ? WHERE id = ?')
    .bind(name, phone, longText(b.notes, 2000), id).run();
  const ch: string[] = [];
  if (before.name !== name) ch.push(`nome: ${before.name} → ${name}`);
  if (before.phone !== phone) ch.push('WhatsApp alterado');
  await audit(c, 'client_updated', `${name}${ch.length ? ` · ${ch.join(' · ')}` : ' · observações'}`);
  return c.json({ ok: true });
});
