import { useEffect, useState } from 'react';
import { fmtDateBR, fmtDayMonth, fmtMoney, monthShort } from '../../../shared/format';
import { addDays, addMonths, daysBetween, endOfMonth, startOfMonth } from '../../../shared/time';
import { PAYMENT_LABEL, type Appointment, type Expense, type PaymentMethod } from '../../../shared/types';
import { api, errorMessage } from '../../lib/api';
import { useApptActions } from '../actions';
import { useAdmin } from '../context';
import { bumpData, centsToInput, confirmDialog, Empty, Icon, Loading, parseMoney, Sheet, toast, useDataVersion } from '../ui';

interface Report {
  from: string; to: string;
  summary: { revenue: number; expenses: number; profit: number; count: number; ticket: number; expected: number; expected_count: number };
  by_day: { date: string; total: number; count: number }[];
  by_service: { name: string; count: number; total: number }[];
  by_client: { id: number; name: string; count: number; total: number }[];
  by_method: { method: PaymentMethod; count: number; total: number }[];
  by_category: { category: string; total: number }[];
  monthly: { month: string; revenue: number; expenses: number; profit: number }[];
  history: Appointment[];
  expenses: Expense[];
}

type Period = 'month' | 'last' | '7d' | 'custom';

export default function Finance() {
  const { today } = useAdmin();
  const [period, setPeriod] = useState<Period>('month');
  const [custom, setCustom] = useState({ from: startOfMonth(today), to: today });
  const [tab, setTab] = useState<'summary' | 'history' | 'expenses'>('summary');
  const [data, setData] = useState<Report | null>(null);
  const [expense, setExpense] = useState<Expense | 'new' | null>(null);
  const version = useDataVersion();

  const range = period === 'month' ? { from: startOfMonth(today), to: endOfMonth(today) }
    : period === 'last' ? { from: addMonths(today, -1), to: endOfMonth(addMonths(today, -1)) }
      : period === '7d' ? { from: addDays(today, -6), to: today }
        : custom;

  useEffect(() => {
    setData(null);
    api<Report>(`/api/admin/finance?from=${range.from}&to=${range.to}`).then(setData).catch((e) => toast(errorMessage(e), 'error'));
  }, [range.from, range.to, version]);

  return (
    <div className="finance">
      <div className="chip-row period">
        {([['month', 'Este mês'], ['last', 'Mês passado'], ['7d', '7 dias'], ['custom', 'Escolher']] as [Period, string][]).map(([k, l]) => (
          <button key={k} type="button" className={`chip${period === k ? ' is-selected' : ''}`} onClick={() => setPeriod(k)}>{l}</button>
        ))}
      </div>
      {period === 'custom' && (
        <div className="two-cols">
          <label className="field"><span>De</span><input type="date" value={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} /></label>
          <label className="field"><span>Até</span><input type="date" value={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} /></label>
        </div>
      )}
      <p className="hint period-label">{fmtDateBR(range.from)} a {fmtDateBR(range.to)}</p>

      <div className="seg">
        <button type="button" className={tab === 'summary' ? 'is-active' : ''} onClick={() => setTab('summary')}>Resumo</button>
        <button type="button" className={tab === 'history' ? 'is-active' : ''} onClick={() => setTab('history')}>Atendimentos</button>
        <button type="button" className={tab === 'expenses' ? 'is-active' : ''} onClick={() => setTab('expenses')}>Despesas</button>
      </div>

      {!data ? <Loading /> : tab === 'summary' ? <Summary r={data} /> : tab === 'history' ? <History r={data} /> : (
        <ExpensesList r={data} onEdit={setExpense} />
      )}

      {tab === 'expenses' && (
        <button type="button" className="fab" onClick={() => setExpense('new')} aria-label="Nova despesa"><Icon name="plus" size={28} /></button>
      )}
      {expense && <ExpenseForm expense={expense === 'new' ? null : expense} onClose={() => setExpense(null)} />}
    </div>
  );
}

function Summary({ r }: { r: Report }) {
  const s = r.summary;
  return (
    <>
      <div className="kpis">
        <div className="kpi kpi-main"><span>Faturamento</span><strong>{fmtMoney(s.revenue)}</strong></div>
        <div className="kpi"><span>Despesas</span><strong>{fmtMoney(s.expenses)}</strong></div>
        <div className={`kpi ${s.profit >= 0 ? 'kpi-good' : 'kpi-bad'}`}><span>Lucro</span><strong>{fmtMoney(s.profit)}</strong></div>
        <div className="kpi"><span>Atendimentos</span><strong>{s.count}</strong></div>
        <div className="kpi"><span>Ticket médio</span><strong>{fmtMoney(s.ticket)}</strong></div>
        <div className="kpi"><span>Previsto</span><strong>{fmtMoney(s.expected)}</strong><small>{s.expected_count} agendados</small></div>
      </div>

      <section className="card">
        <h3>Faturamento por dia</h3>
        <DayBars r={r} />
      </section>

      <section className="card">
        <h3>Últimos 6 meses</h3>
        <MonthBars months={r.monthly} />
      </section>

      <RankCard title="Serviços mais vendidos" rows={r.by_service.map((x) => ({ label: x.name, value: x.total, note: `${x.count}×` }))} />
      <RankCard title="Clientes que mais vieram" rows={r.by_client.map((x) => ({ label: x.name, value: x.total, note: `${x.count} ${x.count === 1 ? 'visita' : 'visitas'}` }))} />
      <RankCard title="Formas de pagamento" rows={r.by_method.map((x) => ({ label: x.method ? PAYMENT_LABEL[x.method] : 'Não informado', value: x.total, note: `${x.count}×` }))} />
      <RankCard title="Despesas por categoria" rows={r.by_category.map((x) => ({ label: x.category, value: x.total }))} tone="expense" />
    </>
  );
}

function DayBars({ r }: { r: Report }) {
  const n = daysBetween(r.from, r.to) + 1;
  if (n > 62) return <p className="hint">Escolha um período de até 2 meses para ver por dia.</p>;
  const days = Array.from({ length: n }, (_, i) => addDays(r.from, i));
  const max = Math.max(1, ...r.by_day.map((d) => d.total));
  const every = n > 20 ? 5 : n > 10 ? 2 : 1;
  if (!r.by_day.length) return <p className="hint">Nenhum atendimento concluído no período.</p>;
  return (
    <div className="bars" role="img" aria-label="Faturamento por dia">
      {days.map((d, i) => {
        const v = r.by_day.find((x) => x.date === d)?.total ?? 0;
        return (
          <div key={d} className="bar-col" title={`${fmtDayMonth(d)}: ${fmtMoney(v)}`}>
            <div className="bar" style={{ height: `${(v / max) * 100}%` }} />
            <span className="bar-label">{i % every === 0 ? Number(d.slice(8)) : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

function MonthBars({ months }: { months: Report['monthly'] }) {
  const max = Math.max(1, ...months.flatMap((m) => [m.revenue, m.expenses]));
  return (
    <>
      <div className="bars months" role="img" aria-label="Faturamento e despesas por mês">
        {months.map((m) => (
          <div key={m.month} className="bar-col">
            <div className="bar-pair">
              <div className="bar" style={{ height: `${(m.revenue / max) * 100}%` }} title={`Faturamento ${fmtMoney(m.revenue)}`} />
              <div className="bar bar-exp" style={{ height: `${(m.expenses / max) * 100}%` }} title={`Despesas ${fmtMoney(m.expenses)}`} />
            </div>
            <span className="bar-label">{monthShort(Number(m.month.slice(5)))}</span>
          </div>
        ))}
      </div>
      <div className="legend"><span><i className="sw-rev" />Faturamento</span><span><i className="sw-exp" />Despesas</span></div>
      <table className="mini-table">
        <thead><tr><th>Mês</th><th>Lucro</th></tr></thead>
        <tbody>
          {[...months].reverse().map((m) => (
            <tr key={m.month}><td>{monthShort(Number(m.month.slice(5)))}/{m.month.slice(2, 4)}</td><td className={m.profit < 0 ? 'neg' : ''}>{fmtMoney(m.profit)}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function RankCard({ title, rows, tone }: { title: string; rows: { label: string; value: number; note?: string }[]; tone?: 'expense' }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <section className="card">
      <h3>{title}</h3>
      {rows.length === 0 ? <p className="hint">Sem dados no período.</p> : (
        <ul className="rank">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="rank-top"><span>{r.label}</span><strong>{fmtMoney(r.value)}</strong></div>
              <div className="rank-bar"><i className={tone === 'expense' ? 'exp' : ''} style={{ width: `${(r.value / max) * 100}%` }} /></div>
              {r.note && <small>{r.note}</small>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function History({ r }: { r: Report }) {
  const act = useApptActions();
  if (!r.history.length) return <Empty icon="wallet" title="Nenhum atendimento concluído" text="Os atendimentos aparecem aqui quando você toca em Concluir." />;
  return (
    <ul className="history">
      {r.history.map((a) => (
        <li key={a.id}>
          <button type="button" onClick={() => act.open(a)}>
            <span className="h-date">{fmtDayMonth(a.date)}<small>{a.start_time}</small></span>
            <span className="h-main">{a.client_name}<small>{a.service_name}{a.payment_method ? ` · ${PAYMENT_LABEL[a.payment_method]}` : ''}</small></span>
            <span className="h-value">{fmtMoney(a.price_cents)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ExpensesList({ r, onEdit }: { r: Report; onEdit: (e: Expense) => void }) {
  if (!r.expenses.length) return <Empty icon="wallet" title="Nenhuma despesa no período" text="Toque no + para lançar materiais, aluguel, cursos…" />;
  return (
    <>
      <p className="hint">Total: <strong>{fmtMoney(r.summary.expenses)}</strong></p>
      <ul className="history">
        {r.expenses.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => onEdit(e)}>
              <span className="h-date">{fmtDayMonth(e.date)}</span>
              <span className="h-main">{e.description}<small>{e.category}</small></span>
              <span className="h-value neg">− {fmtMoney(e.amount_cents)}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
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
    <Sheet title={expense ? 'Editar despesa' : 'Nova despesa'} onClose={onClose}
      footer={<button type="button" className="btn btn-primary btn-block" onClick={save}>Salvar</button>}>
      <label className="field"><span>Descrição</span><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Esmaltes e lixas" maxLength={120} /></label>
      <div className="two-cols">
        <label className="field"><span>Valor (R$)</span><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" /></label>
        <label className="field"><span>Data</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <div className="field">
        <span>Categoria</span>
        <div className="chip-row">
          {settings.expense_categories.map((c) => (
            <button key={c} type="button" className={`chip${category === c ? ' is-selected' : ''}`} onClick={() => setCategory(c)}>{c}</button>
          ))}
        </div>
      </div>
      {expense && <button type="button" className="link-btn danger" onClick={remove}><Icon name="trash" size={16} /> Excluir despesa</button>}
    </Sheet>
  );
}
