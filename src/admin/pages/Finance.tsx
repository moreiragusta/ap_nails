import { useEffect, useState } from 'react';
import { fmtDayMonth, monthName, monthShort } from '../../../shared/format';
import { addDays, addMonths, daysBetween, endOfMonth, startOfMonth, weekdayOf } from '../../../shared/time';
import { PAYMENT_LABEL, type Appointment, type Expense, type PaymentMethod } from '../../../shared/types';
import { api, errorMessage } from '../../lib/api';
import { useApptActions } from '../actions';
import { useAdmin } from '../context';
import { Avatar, bumpData, centsToInput, confirmDialog, Empty, Icon, Loading, Money, PageHead, parseMoney, SecHead, Sheet, toast, useDataVersion } from '../ui';

interface Report {
  from: string; to: string;
  summary: { revenue: number; expenses: number; profit: number; count: number; ticket: number; expected: number; expected_count: number };
  previous: { revenue: number; count: number } | null;
  by_day: { date: string; total: number; count: number }[];
  by_month: { month: string; revenue: number; expenses: number }[];
  by_service: { name: string; count: number; total: number; photo_url: string | null }[];
  by_client: { id: number; name: string; count: number; total: number }[];
  by_method: { method: PaymentMethod | null; count: number; total: number }[];
  by_category: { category: string; total: number }[];
  history: Appointment[];
  expenses: Expense[];
}

type Period = 'week' | 'month' | 'year' | 'custom';
const PAY_COLORS: Record<string, string> = { pix: '#32BCAD', cash: '#2F8A57', debit: '#3B6FB6', credit: '#8A4FBF', null: '#d8cdc9' };

function rangeFor(period: Period, anchor: string, custom: { from: string; to: string }) {
  if (period === 'week') {
    const from = addDays(anchor, -weekdayOf(anchor));
    return { from, to: addDays(from, 6), cmpFrom: addDays(from, -7), cmpTo: addDays(from, -1) };
  }
  if (period === 'month') {
    const from = startOfMonth(anchor);
    const prev = addMonths(from, -1);
    return { from, to: endOfMonth(anchor), cmpFrom: prev, cmpTo: endOfMonth(prev) };
  }
  if (period === 'year') {
    const y = Number(anchor.slice(0, 4));
    return { from: `${y}-01-01`, to: `${y}-12-31`, cmpFrom: `${y - 1}-01-01`, cmpTo: `${y - 1}-12-31` };
  }
  const len = daysBetween(custom.from, custom.to) + 1;
  return { from: custom.from, to: custom.to, cmpFrom: addDays(custom.from, -len), cmpTo: addDays(custom.from, -1) };
}

function label(period: Period, from: string, to: string) {
  if (period === 'month') return `${monthName(Number(from.slice(5, 7)))} de ${from.slice(0, 4)}`;
  if (period === 'year') return from.slice(0, 4);
  return `${fmtDayMonth(from)} a ${fmtDayMonth(to)}`;
}

const CMP_LABEL: Record<Period, (from: string) => string> = {
  week: () => 'vs semana anterior',
  month: (from) => `vs ${monthShort(Number(addMonths(from, -1).slice(5, 7)))}`,
  year: (from) => `vs ${Number(from.slice(0, 4)) - 1}`,
  custom: () => 'vs período anterior',
};

export default function Finance() {
  const { today } = useAdmin();
  const [period, setPeriod] = useState<Period>('month');
  const [anchor, setAnchor] = useState(today);
  const [custom, setCustom] = useState({ from: startOfMonth(today), to: today });
  const [data, setData] = useState<Report | null>(null);
  const [sheet, setSheet] = useState<'history' | 'services' | 'expenses' | Expense | 'new-expense' | null>(null);
  const version = useDataVersion();
  const r = rangeFor(period, anchor, custom);

  useEffect(() => {
    api<Report>(`/api/admin/finance?from=${r.from}&to=${r.to}&cmp_from=${r.cmpFrom}&cmp_to=${r.cmpTo}`)
      .then(setData).catch((e) => toast(errorMessage(e), 'error'));
  }, [r.from, r.to, r.cmpFrom, r.cmpTo, version]);

  const shift = (dir: 1 | -1) => setAnchor(period === 'week' ? addDays(anchor, 7 * dir) : period === 'month' ? addMonths(anchor, dir) : `${Number(anchor.slice(0, 4)) + dir}${anchor.slice(4)}`);
  const atPresent = r.to >= today;

  return (
    <div className="page">
      <PageHead title="Financeiro" />
      <div className="seg">
        {([['week', 'Semana'], ['month', 'Mês'], ['year', 'Ano'], ['custom', 'Período']] as [Period, string][]).map(([k, l]) => (
          <button key={k} type="button" className={period === k ? 'is-active' : ''} onClick={() => { setPeriod(k); setAnchor(today); }}>{l}</button>
        ))}
      </div>
      {period === 'custom' ? (
        <div className="two-cols">
          <label className="field"><span>De</span><input type="date" value={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} /></label>
          <label className="field"><span>Até</span><input type="date" value={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} /></label>
        </div>
      ) : (
        <div className="period-nav">
          <button type="button" className="icon-btn" onClick={() => shift(-1)} aria-label="Anterior"><Icon name="left" /></button>
          <span>{label(period, r.from, r.to)}</span>
          <button type="button" className="icon-btn" onClick={() => shift(1)} disabled={atPresent} aria-label="Próximo"><Icon name="right" /></button>
        </div>
      )}

      {!data ? <Loading /> : (
        <>
          <div className="hero">
            <div className="eyebrow">Faturamento</div>
            <Money cents={data.summary.revenue} showCents />
            <Delta now={data.summary.revenue} before={data.previous?.revenue ?? null} label={CMP_LABEL[period](r.from)} />
          </div>

          <div className="split surface">
            <div><span className="lbl-cost">Despesas</span><Money cents={data.summary.expenses} className="cost" /></div>
            <div className={data.summary.profit < 0 ? 'is-neg' : data.summary.profit > 0 ? 'is-pos' : ''}>
              <span className={data.summary.profit < 0 ? 'lbl-neg' : 'lbl-pos'}>{data.summary.profit < 0 ? 'Prejuízo' : 'Lucro'}</span>
              <Money cents={data.summary.profit} className={data.summary.profit > 0 ? 'pos' : ''} />
            </div>
          </div>

          <div className="chart surface"><Chart data={data} period={period} today={today} /></div>

          <div className="trio">
            <div><span>Atendimentos</span><b>{data.summary.count}</b></div>
            <div><span>Ticket médio</span><Money cents={data.summary.ticket} /></div>
            <div><span>A receber</span><Money cents={data.summary.expected} /></div>
          </div>

          <SecHead title="Mais vendidos" action={data.by_service.length > 4 ? <button type="button" className="link" onClick={() => setSheet('services')}>Ver todos</button> : undefined} />
          {data.by_service.length === 0 ? <p className="hint">Nenhum atendimento concluído no período.</p> : <ServiceRows rows={data.by_service.slice(0, 4)} />}

          {data.by_client.length > 0 && (
            <>
              <SecHead title="Clientes que mais vieram" />
              <div className="rows">
                {data.by_client.slice(0, 3).map((c) => (
                  <div key={c.id} className="row-item">
                    <Avatar name={c.name} />
                    <span className="grow"><span className="row-title name">{c.name}</span><small>{c.count} {c.count === 1 ? 'visita' : 'visitas'}</small></span>
                    <Money cents={c.total} />
                  </div>
                ))}
              </div>
            </>
          )}

          {data.by_method.length > 0 && (
            <>
              <SecHead title="Como recebeu" />
              <PayBar rows={data.by_method} />
            </>
          )}

          <SecHead title="Despesas" action={<button type="button" className="link" onClick={() => setSheet('new-expense')}>+ Lançar</button>} />
          {data.expenses.length === 0 ? <p className="hint">Nenhuma despesa lançada no período.</p> : (
            <>
              <ExpenseRows rows={data.expenses.slice(0, 4)} onOpen={(e) => setSheet(e)} />
              {data.expenses.length > 4 && <button type="button" className="link" style={{ marginTop: 10 }} onClick={() => setSheet('expenses')}>Ver todas as {data.expenses.length} despesas</button>}
            </>
          )}

          {data.history.length > 0 && (
            <button type="button" className="btn btn-outline btn-block" style={{ marginTop: 26 }} onClick={() => setSheet('history')}>
              Ver os {data.history.length} atendimentos do período
            </button>
          )}
        </>
      )}

      {data && sheet === 'history' && <HistorySheet rows={data.history} onClose={() => setSheet(null)} />}
      {data && sheet === 'services' && <Sheet title="Serviços vendidos" onClose={() => setSheet(null)}><ServiceRows rows={data.by_service} /></Sheet>}
      {data && sheet === 'expenses' && (
        <Sheet title="Despesas" onClose={() => setSheet(null)}>
          <ExpenseRows rows={data.expenses} onOpen={(e) => setSheet(e)} />
        </Sheet>
      )}
      {(sheet === 'new-expense' || (sheet && typeof sheet === 'object')) && (
        <ExpenseForm expense={typeof sheet === 'object' ? sheet : null} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}

function Delta({ now, before, label: text }: { now: number; before: number | null; label: string }) {
  if (before === null || (before === 0 && now === 0)) return null;
  if (before === 0) return <span className="delta up">novo {text}</span>;
  const pct = Math.round(((now - before) / before) * 100);
  const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  return <span className={`delta ${cls}`}>{pct > 0 ? '+' : ''}{pct}% {text}</span>;
}

function Chart({ data, period, today }: { data: Report; period: Period; today: string }) {
  if (period === 'year') {
    const max = Math.max(1, ...data.by_month.flatMap((m) => [m.revenue, m.expenses]));
    return (
      <>
        <div className="bars" role="img" aria-label="Faturamento e despesas por mês">
          {data.by_month.map((m) => (
            <div key={m.month} className="bar-col" title={m.month}>
              <div className="bar-pair">
                <div className={`bar${m.revenue ? ' v' : ''}`} style={{ height: `${Math.max(3, (m.revenue / max) * 100)}%` }} />
                <div className={`bar${m.expenses ? ' exp' : ''}`} style={{ height: `${Math.max(3, (m.expenses / max) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="axis">{data.by_month.map((m) => <span key={m.month}>{monthShort(Number(m.month.slice(5)))[0].toUpperCase()}</span>)}</div>
        <div className="legend-bars"><span><i style={{ background: '#b0675b' }} />Faturamento</span><span><i style={{ background: '#c9773b' }} />Despesas</span></div>
      </>
    );
  }
  const n = daysBetween(data.from, data.to) + 1;
  if (n > 62) return <p className="hint" style={{ margin: 0 }}>Escolha até 2 meses para ver o gráfico por dia.</p>;
  const days = Array.from({ length: n }, (_, i) => addDays(data.from, i));
  const max = Math.max(1, ...data.by_day.map((d) => d.total));
  const mid = days[Math.floor((n - 1) / 2)];
  return (
    <>
      <div className="bars" role="img" aria-label="Faturamento por dia">
        {days.map((d) => {
          const v = data.by_day.find((x) => x.date === d)?.total ?? 0;
          return (
            <div key={d} className="bar-col" title={fmtDayMonth(d)}>
              <div className={`bar${v ? ' v' : ''}${d === today ? ' today' : ''}`} style={{ height: `${Math.max(3, (v / max) * 100)}%` }} />
            </div>
          );
        })}
      </div>
      <div className="axis"><span>{fmtDayMonth(days[0])}</span><span>{fmtDayMonth(mid)}</span><span>{fmtDayMonth(days[n - 1])}</span></div>
    </>
  );
}

function ServiceRows({ rows }: { rows: Report['by_service'] }) {
  return (
    <div className="rows">
      {rows.map((s) => (
        <div key={s.name} className="row-item">
          {s.photo_url ? <img className="thumb" src={s.photo_url} alt="" /> : <span className="thumb" />}
          <span className="grow"><span className="row-title">{s.name}</span><small>{s.count} {s.count === 1 ? 'atendimento' : 'atendimentos'}</small></span>
          <Money cents={s.total} />
        </div>
      ))}
    </div>
  );
}

function PayBar({ rows }: { rows: Report['by_method'] }) {
  const total = rows.reduce((t, r) => t + r.total, 0) || 1;
  return (
    <>
      <div className="paybar">
        {rows.map((r) => <i key={String(r.method)} style={{ flex: r.total, background: PAY_COLORS[String(r.method)] }} />)}
      </div>
      <div className="legend">
        {rows.map((r) => (
          <span key={String(r.method)}>
            <i style={{ background: PAY_COLORS[String(r.method)] }} />
            {r.method ? PAYMENT_LABEL[r.method] : 'Não informado'} <b>{Math.round((r.total / total) * 100)}%</b>
          </span>
        ))}
      </div>
    </>
  );
}

function ExpenseRows({ rows, onOpen }: { rows: Expense[]; onOpen: (e: Expense) => void }) {
  return (
    <div className="rows">
      {rows.map((e) => (
        <button key={e.id} type="button" className="row-item" onClick={() => onOpen(e)}>
          <span className="menu-icon"><Icon name="wallet" size={18} /></span>
          <span className="grow"><span className="row-title">{e.description}</span><small>{e.category} · <span className="num">{fmtDayMonth(e.date)}</span></small></span>
          <Money cents={-e.amount_cents} />
        </button>
      ))}
    </div>
  );
}

function HistorySheet({ rows, onClose }: { rows: Appointment[]; onClose: () => void }) {
  const act = useApptActions();
  return (
    <Sheet title="Atendimentos" onClose={onClose}>
      {rows.length === 0 ? <Empty icon="wallet" title="Nenhum atendimento" /> : (
        <div className="rows">
          {rows.map((a) => (
            <button key={a.id} type="button" className="row-item" onClick={() => act.open(a)}>
              <span className="grow">
                <span className="row-title name">{a.client_name}</span>
                <small>{a.service_name} · <span className="num">{fmtDayMonth(a.date)}</span>{a.payment_method ? ` · ${PAYMENT_LABEL[a.payment_method]}` : ''}</small>
              </span>
              <Money cents={a.price_cents} />
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

function ExpenseForm({ expense, onClose }: { expense: Expense | null; onClose: () => void }) {
  const { today, settings } = useAdmin();
  const [date, setDate] = useState(expense?.date ?? today);
  const [description, setDescription] = useState(expense?.description ?? '');
  const [category, setCategory] = useState(expense?.category ?? settings.expense_categories[0] ?? 'Outros');
  const [amount, setAmount] = useState(expense ? centsToInput(expense.amount_cents) : '');

  async function save() {
    const cents = parseMoney(amount);
    if (!description.trim()) return toast('Informe a descrição.', 'error');
    if (!cents) return toast('Informe o valor.', 'error');
    try {
      const body = { date, description, category, amount_cents: cents };
      if (expense) await api(`/api/admin/finance/expenses/${expense.id}`, { method: 'PUT', body });
      else await api('/api/admin/finance/expenses', { body });
      toast(expense ? 'Despesa atualizada' : 'Despesa lançada');
      bumpData();
      onClose();
    } catch (e) { toast(errorMessage(e), 'error'); }
  }

  async function remove() {
    if (!expense || !(await confirmDialog('Excluir esta despesa?', { ok: 'Excluir', danger: true }))) return;
    await api(`/api/admin/finance/expenses/${expense.id}`, { method: 'DELETE' });
    toast('Despesa excluída');
    bumpData();
    onClose();
  }

  return (
    <Sheet title={expense ? 'Despesa' : 'Lançar despesa'} onClose={onClose}
      footer={<button type="button" className="btn btn-primary btn-block btn-lg" onClick={save}>Salvar</button>}>
      <label className="field"><span>Valor</span><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="R$ 0,00" autoFocus={!expense} style={{ fontSize: 22, fontWeight: 600 }} /></label>
      <label className="field"><span>Descrição</span><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: esmaltes e lixas" maxLength={120} /></label>
      <div className="field">
        <span>Categoria</span>
        <div className="chips">
          {settings.expense_categories.map((c) => (
            <button key={c} type="button" className={`chip${category === c ? ' is-selected' : ''}`} onClick={() => setCategory(c)}>{c}</button>
          ))}
        </div>
      </div>
      <label className="field"><span>Data</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      {expense && <button type="button" className="text-btn danger" onClick={remove}><Icon name="trash" size={16} /> Excluir despesa</button>}
    </Sheet>
  );
}
