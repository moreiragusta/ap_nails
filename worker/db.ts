import { computeSlots, dayBlocks, dayWindow, overlaps, type Interval } from '../shared/schedule';
import { addDays, nowIn, toMin } from '../shared/time';
import {
  DEFAULT_SETTINGS, serviceColor, type Appointment, type DateException, type Service, type Settings, type WeeklyHour,
} from '../shared/types';
import type { Env } from './env';

// ------------------------------------------------------------------ settings

export async function getSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare("SELECT key, value FROM settings WHERE key NOT LIKE '\\_%' ESCAPE '\\'").all<{ key: string; value: string }>();
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of results) {
    if (r.key in DEFAULT_SETTINGS) {
      try { s[r.key] = JSON.parse(r.value); } catch { /* ignora valor inválido */ }
    }
  }
  return s as unknown as Settings;
}

export async function saveSettings(db: D1Database, patch: Partial<Settings>) {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const batch = Object.entries(patch).map(([k, v]) => stmt.bind(k, JSON.stringify(v)));
  if (batch.length) await db.batch(batch);
}

/** Valores internos (prefixo "_"), ex.: hash de senha. */
export async function getInternal(db: D1Database, key: string): Promise<string | null> {
  const r = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(`_${key}`).first<{ value: string }>();
  return r?.value ?? null;
}
export async function setInternal(db: D1Database, key: string, value: string) {
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(`_${key}`, value).run();
}

// ------------------------------------------------------------------ catálogo

interface ServiceRow {
  id: number; name: string; description: string; price_cents: number; duration_min: number;
  photo_key: string | null; is_combo: number; active: number; sort: number; color: string | null;
}

export async function listServices(db: D1Database, onlyPublic = false): Promise<Service[]> {
  const where = onlyPublic ? 'WHERE active = 1 AND photo_key IS NOT NULL' : '';
  const { results } = await db.prepare(`SELECT * FROM services ${where} ORDER BY sort, name`).all<ServiceRow>();
  const { results: items } = await db.prepare(
    'SELECT ci.combo_id, s.id, s.name FROM combo_items ci JOIN services s ON s.id = ci.service_id ORDER BY s.sort, s.name',
  ).all<{ combo_id: number; id: number; name: string }>();
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    price_cents: r.price_cents,
    duration_min: r.duration_min,
    photo_url: r.photo_key ? `/photos/${r.photo_key}` : null,
    is_combo: !!r.is_combo,
    active: !!r.active,
    sort: r.sort,
    color: serviceColor(r.id, r.color),
    items: items.filter((i) => i.combo_id === r.id).map((i) => ({ id: i.id, name: i.name })),
  }));
}

export async function getService(db: D1Database, id: number): Promise<ServiceRow | null> {
  return db.prepare('SELECT * FROM services WHERE id = ?').bind(id).first<ServiceRow>();
}

// ------------------------------------------------------------------ agenda

export async function loadWeekly(db: D1Database): Promise<WeeklyHour[]> {
  const { results } = await db.prepare('SELECT * FROM weekly_hours ORDER BY weekday').all<Omit<WeeklyHour, 'open'> & { open: number }>();
  return results.map((r) => ({ ...r, open: !!r.open }));
}

export async function loadExceptions(db: D1Database, from: string, to: string): Promise<DateException[]> {
  const { results } = await db.prepare(
    'SELECT * FROM date_exceptions WHERE date_to >= ? AND date_from <= ? ORDER BY date_from, start_time',
  ).bind(from, to).all<DateException>();
  return results;
}

const ACTIVE = "('pending','confirmed','done')";

/** Intervalos ocupados por agendamentos ativos, agrupados por data. */
export async function loadBusy(db: D1Database, from: string, to: string, excludeId: number | null = null) {
  const { results } = await db.prepare(
    `SELECT date, start_time, end_time FROM appointments
     WHERE date BETWEEN ? AND ? AND status IN ${ACTIVE} AND id IS NOT ?`,
  ).bind(from, to, excludeId).all<{ date: string; start_time: string; end_time: string }>();
  const map = new Map<string, Interval[]>();
  for (const r of results) {
    const list = map.get(r.date) ?? [];
    list.push({ s: toMin(r.start_time), e: toMin(r.end_time) });
    map.set(r.date, list);
  }
  return map;
}

export interface SlotOptions { publicMode: boolean; excludeId?: number | null }

/** Horários livres para cada dia de [from, to]. */
export async function slotsForRange(env: Env, durationMin: number, from: string, to: string, opts: SlotOptions) {
  const [settings, weekly, exceptions, busy] = await Promise.all([
    getSettings(env.DB), loadWeekly(env.DB), loadExceptions(env.DB, from, to),
    loadBusy(env.DB, from, to, opts.excludeId ?? null),
  ]);
  const now = nowIn(env.BUSINESS_TZ);
  const days: { date: string; slots: string[] }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    let minStart = -1;
    if (d < now.date) { days.push({ date: d, slots: [] }); continue; }
    if (d === now.date) minStart = now.minutes + (opts.publicMode ? settings.min_advance_min : 0);
    const slots = computeSlots(
      { date: d, weekly, exceptions, busy: busy.get(d) ?? [] },
      durationMin,
      {
        mode: opts.publicMode ? settings.booking_mode : 'free',
        stepMin: opts.publicMode ? settings.slot_step_min : 15,
        bufferMin: settings.buffer_min,
        minStart,
      },
    );
    days.push({ date: d, slots });
  }
  return days;
}

/** Descreve o conflito de um intervalo com agendamentos, bloqueios ou expediente; null se livre. */
export async function findConflict(env: Env, date: string, start: string, end: string, excludeId: number | null) {
  const a = await env.DB.prepare(
    `SELECT a.start_time, a.end_time, c.name FROM appointments a JOIN clients c ON c.id = a.client_id
     WHERE a.date = ? AND a.status IN ${ACTIVE} AND a.id IS NOT ? AND a.start_time < ? AND a.end_time > ?`,
  ).bind(date, excludeId, end, start).first<{ start_time: string; end_time: string; name: string }>();
  if (a) return `Conflita com ${a.name} (${a.start_time}–${a.end_time}).`;
  const [weekly, exceptions] = await Promise.all([loadWeekly(env.DB), loadExceptions(env.DB, date, date)]);
  const iv = { s: toMin(start), e: toMin(end) };
  if (dayBlocks(date, exceptions).some((b) => overlaps(iv, b))) return 'Esse horário está bloqueado.';
  const win = dayWindow(date, weekly, exceptions);
  if (!win) return 'Esse dia está fechado na agenda.';
  if (iv.s < win.s || iv.e > win.e) return 'Fora do horário de atendimento do dia.';
  return null;
}

// ------------------------------------------------------------ agendamentos

export const APPT_SELECT = `SELECT a.*, c.name AS client_name, c.phone AS client_phone, s.color AS service_color
  FROM appointments a JOIN clients c ON c.id = a.client_id LEFT JOIN services s ON s.id = a.service_id`;

export async function getAppointment(db: D1Database, id: number): Promise<Appointment | null> {
  return db.prepare(`${APPT_SELECT} WHERE a.id = ?`).bind(id).first<Appointment>();
}

/** Cria ou reaproveita a cliente pelo WhatsApp e devolve o id. */
export async function upsertClient(db: D1Database, name: string, phone: string): Promise<number> {
  const existing = await db.prepare('SELECT id FROM clients WHERE phone = ?').bind(phone).first<{ id: number }>();
  if (existing) return existing.id;
  const r = await db.prepare('INSERT INTO clients (name, phone) VALUES (?, ?) RETURNING id').bind(name, phone).first<{ id: number }>();
  return r!.id;
}
