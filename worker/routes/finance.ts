import { Hono } from 'hono';
import { addMonths, endOfMonth, isDate, nowIn, startOfMonth } from '../../shared/time';
import type { Appointment, Expense } from '../../shared/types';
import { APPT_SELECT, getSettings } from '../db';
import { bad, type AppEnv, type Ctx } from '../env';
import { idParam, int, text } from '../util';

export const financeRoutes = new Hono<AppEnv>();

/** Resumo financeiro e relatórios de um período (?from&to). */
financeRoutes.get('/', async (c) => {
  const today = nowIn(c.env.BUSINESS_TZ).date;
  const from = c.req.query('from') ?? startOfMonth(today);
  const to = c.req.query('to') ?? endOfMonth(today);
  if (!isDate(from) || !isDate(to) || to < from) throw bad('Período inválido.');
  const db = c.env.DB;
  const DONE = "status = 'done' AND date BETWEEN ?1 AND ?2";

  const monthsFrom = startOfMonth(addMonths(to, -5));
  const [totals, expTotal, expected, byDay, byService, byClient, byMethod, byCategory, months, monthsExp, history, expenses] = await Promise.all([
    db.prepare(`SELECT COALESCE(SUM(price_cents),0) AS revenue, COUNT(*) AS count FROM appointments WHERE ${DONE}`).bind(from, to).first<{ revenue: number; count: number }>(),
    db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS total FROM expenses WHERE date BETWEEN ?1 AND ?2').bind(from, to).first<{ total: number }>(),
    db.prepare("SELECT COALESCE(SUM(price_cents),0) AS total, COUNT(*) AS count FROM appointments WHERE status IN ('pending','confirmed') AND date BETWEEN ?1 AND ?2").bind(from, to).first<{ total: number; count: number }>(),
    db.prepare(`SELECT date, SUM(price_cents) AS total, COUNT(*) AS count FROM appointments WHERE ${DONE} GROUP BY date ORDER BY date`).bind(from, to).all<{ date: string; total: number; count: number }>(),
    db.prepare(`SELECT service_name AS name, COUNT(*) AS count, SUM(price_cents) AS total FROM appointments WHERE ${DONE} GROUP BY service_name ORDER BY count DESC, total DESC LIMIT 10`).bind(from, to).all(),
    db.prepare(`SELECT c.id, c.name, COUNT(*) AS count, SUM(a.price_cents) AS total FROM appointments a JOIN clients c ON c.id = a.client_id WHERE a.status = 'done' AND a.date BETWEEN ?1 AND ?2 GROUP BY c.id ORDER BY count DESC, total DESC LIMIT 10`).bind(from, to).all(),
    db.prepare(`SELECT payment_method AS method, COUNT(*) AS count, SUM(price_cents) AS total FROM appointments WHERE ${DONE} GROUP BY payment_method ORDER BY total DESC`).bind(from, to).all(),
    db.prepare('SELECT category, SUM(amount_cents) AS total FROM expenses WHERE date BETWEEN ?1 AND ?2 GROUP BY category ORDER BY total DESC').bind(from, to).all(),
    db.prepare("SELECT substr(date,1,7) AS month, SUM(price_cents) AS revenue FROM appointments WHERE status = 'done' AND date BETWEEN ?1 AND ?2 GROUP BY month").bind(monthsFrom, endOfMonth(to)).all<{ month: string; revenue: number }>(),
    db.prepare('SELECT substr(date,1,7) AS month, SUM(amount_cents) AS expenses FROM expenses WHERE date BETWEEN ?1 AND ?2 GROUP BY month').bind(monthsFrom, endOfMonth(to)).all<{ month: string; expenses: number }>(),
    db.prepare(`${APPT_SELECT} WHERE a.status = 'done' AND a.date BETWEEN ?1 AND ?2 ORDER BY a.date DESC, a.start_time DESC LIMIT 300`).bind(from, to).all<Appointment>(),
    db.prepare('SELECT * FROM expenses WHERE date BETWEEN ?1 AND ?2 ORDER BY date DESC, id DESC').bind(from, to).all<Expense>(),
  ]);

  const revenue = totals?.revenue ?? 0;
  const count = totals?.count ?? 0;
  const monthly = Array.from({ length: 6 }, (_, i) => {
    const m = addMonths(monthsFrom, i).slice(0, 7);
    const r = months.results.find((x) => x.month === m)?.revenue ?? 0;
    const e = monthsExp.results.find((x) => x.month === m)?.expenses ?? 0;
    return { month: m, revenue: r, expenses: e, profit: r - e };
  });

  return c.json({
    from, to,
    summary: {
      revenue, expenses: expTotal?.total ?? 0, profit: revenue - (expTotal?.total ?? 0), count,
      ticket: count ? Math.round(revenue / count) : 0,
      expected: expected?.total ?? 0, expected_count: expected?.count ?? 0,
    },
    by_day: byDay.results,
    by_service: byService.results,
    by_client: byClient.results,
    by_method: byMethod.results,
    by_category: byCategory.results,
    monthly,
    history: history.results,
    expenses: expenses.results,
  });
});

// ---------------------------------------------------------- despesas

async function readExpense(c: Ctx) {
  const b = await c.req.json<Record<string, unknown>>();
  if (!isDate(b.date)) throw bad('Informe a data.');
  const description = text(b.description, 120);
  if (!description) throw bad('Informe a descrição.');
  const amount = int(b.amount_cents, 'valor', 1, 100_000_00);
  const settings = await getSettings(c.env.DB);
  const category = settings.expense_categories.includes(String(b.category)) ? String(b.category) : 'Outros';
  return { date: b.date, description, amount, category };
}

financeRoutes.post('/expenses', async (c) => {
  const e = await readExpense(c);
  const r = await c.env.DB.prepare('INSERT INTO expenses (date, description, category, amount_cents) VALUES (?, ?, ?, ?) RETURNING *')
    .bind(e.date, e.description, e.category, e.amount).first<Expense>();
  return c.json(r, 201);
});

financeRoutes.put('/expenses/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  const e = await readExpense(c);
  await c.env.DB.prepare('UPDATE expenses SET date = ?, description = ?, category = ?, amount_cents = ? WHERE id = ?')
    .bind(e.date, e.description, e.category, e.amount, id).run();
  return c.json({ ok: true });
});

financeRoutes.delete('/expenses/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM expenses WHERE id = ?').bind(idParam(c.req.param('id'))).run();
  return c.json({ ok: true });
});
