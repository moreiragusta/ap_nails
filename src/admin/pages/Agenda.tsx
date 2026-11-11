import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { fmtDateLong, fmtDayMonth, fmtMoney, weekdayShort } from '../../../shared/format';
import { dayBlocks, dayWindow } from '../../../shared/schedule';
import { addDays, toHHMM, toMin, weekdayOf } from '../../../shared/time';
import type { Appointment, DateException, WeeklyHour } from '../../../shared/types';
import { api } from '../../lib/api';
import { pushState } from '../../lib/push';
import ApptCard from '../ApptCard';
import AppointmentForm from '../AppointmentForm';
import { useAdmin } from '../context';
import { Empty, Icon, Loading, Sheet, useDataVersion } from '../ui';

interface Attention { today: string; reminder_date: string; pending: Appointment[]; reminders: Appointment[]; expired: Appointment[] }
type View = 'pending' | 'reminders' | 'expired';

const VIEW_TITLE: Record<View, string> = {
  pending: 'Aguardando confirmação',
  reminders: 'Lembretes para enviar',
  expired: 'Expirados (horários liberados)',
};

export default function Agenda() {
  const { today } = useAdmin();
  const [params, setParams] = useSearchParams();
  const [date, setDate] = useState(today);
  const [week, setWeek] = useState<Appointment[] | null>(null);
  const [att, setAtt] = useState<Attention | null>(null);
  const [hours, setHours] = useState<WeeklyHour[]>([]);
  const [exceptions, setExceptions] = useState<DateException[]>([]);
  const [creating, setCreating] = useState(false);
  const version = useDataVersion();
  const view = params.get('view') as View | null;

  const weekStart = addDays(date, -weekdayOf(date));
  const weekEnd = addDays(weekStart, 6);

  useEffect(() => {
    api<Attention>('/api/admin/appointments/attention').then(setAtt).catch(() => {});
  }, [version]);

  useEffect(() => {
    setWeek(null);
    Promise.all([
      api<Appointment[]>(`/api/admin/appointments?from=${weekStart}&to=${weekEnd}`),
      api<DateException[]>(`/api/admin/settings/exceptions?from=${weekStart}&to=${weekEnd}`),
    ]).then(([w, ex]) => { setWeek(w); setExceptions(ex); }).catch(() => setWeek([]));
  }, [weekStart, weekEnd, version]);

  useEffect(() => { api<WeeklyHour[]>('/api/admin/settings/hours').then(setHours).catch(() => {}); }, [version]);

  const dayAppts = useMemo(() => (week ?? []).filter((a) => a.date === date), [week, date]);
  const active = dayAppts.filter((a) => a.status !== 'cancelled' && a.status !== 'expired');
  const inactive = dayAppts.filter((a) => a.status === 'cancelled' || a.status === 'expired');
  const dayTotal = active.reduce((s, a) => s + a.price_cents, 0);

  const win = hours.length ? dayWindow(date, hours, exceptions) : null;
  const closedReason = exceptions.find((x) => x.kind === 'closed' && x.date_from <= date && x.date_to >= date)?.reason;
  const special = exceptions.find((x) => x.kind === 'special' && x.date_from === date);
  const blocks = dayBlocks(date, exceptions);
  const gaps = useMemo(() => freeGaps(win, active, blocks), [win, active, blocks]);

  const openView = (v: View | null) => {
    if (v) params.set('view', v); else params.delete('view');
    setParams(params);
  };

  return (
    <div className="agenda">
      <SetupCards />

      <div className="attention">
        <AttentionChip label="Aguardando" count={att?.pending.length} tone="warn" icon="clock" onClick={() => openView('pending')} />
        <AttentionChip label="Lembretes" count={att?.reminders.length} tone="wa" icon="bell" onClick={() => openView('reminders')} />
        <AttentionChip label="Expirados" count={att?.expired.length} tone="muted" icon="alert" onClick={() => openView('expired')} />
      </div>

      <div className="week-nav">
        <button type="button" className="icon-btn" onClick={() => setDate(addDays(date, -7))} aria-label="Semana anterior"><Icon name="left" /></button>
        <div className="week-label">
          <span>{fmtDayMonth(weekStart)} – {fmtDayMonth(weekEnd)}</span>
          {date !== today && <button type="button" className="chip chip-sm" onClick={() => setDate(today)}>Hoje</button>}
          <label className="date-jump" aria-label="Escolher data">
            <Icon name="calendar" size={18} />
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
        </div>
        <button type="button" className="icon-btn" onClick={() => setDate(addDays(date, 7))} aria-label="Próxima semana"><Icon name="right" /></button>
      </div>

      <div className="week-strip">
        {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d) => {
          const n = (week ?? []).filter((a) => a.date === d && a.status !== 'cancelled' && a.status !== 'expired').length;
          const hasPending = (week ?? []).some((a) => a.date === d && a.status === 'pending');
          return (
            <button key={d} type="button" className={`wk-day${d === date ? ' is-selected' : ''}${d === today ? ' is-today' : ''}`} onClick={() => setDate(d)}>
              <span className="wk-name">{weekdayShort(d)}</span>
              <span className="wk-num">{Number(d.slice(8))}</span>
              <span className={`wk-dots${hasPending ? ' has-pending' : ''}`}>{n > 0 ? '•'.repeat(Math.min(n, 3)) : ' '}</span>
            </button>
          );
        })}
      </div>

      <div className="day-head">
        <h2>{date === today ? 'Hoje, ' : ''}{fmtDateLong(date)}</h2>
        <p>
          {win ? `${special ? 'Horário especial' : 'Atendimento'} ${toHHMM(win.s)}–${toHHMM(win.e)}` : `Fechado${closedReason ? ` · ${closedReason}` : ''}`}
          {active.length > 0 && ` · ${active.length} ${active.length === 1 ? 'cliente' : 'clientes'} · ${fmtMoney(dayTotal)}`}
        </p>
      </div>

      {week === null ? <Loading /> : (
        <div className="day-list">
          {mergeTimeline(active, gaps).map((item) => (
            'gap' in item ? (
              <button key={`gap-${item.s}`} type="button" className="free-slot" onClick={() => setCreating(true)}>
                <span>{toHHMM(item.s)}–{toHHMM(item.e)}</span> Livre · toque para agendar
              </button>
            ) : <ApptCard key={item.id} a={item} />
          ))}
          {active.length === 0 && !win && <Empty icon="calendar" title="Dia fechado" text="Nenhum atendimento nesse dia." />}
          {active.length === 0 && win && gaps.length === 0 && <Empty icon="calendar" title="Nenhum atendimento" />}
          {blocks.length > 0 && (
            <p className="hint">Bloqueado: {blocks.map((b) => `${toHHMM(b.s)}–${toHHMM(b.e)}`).join(', ')}</p>
          )}
          {inactive.length > 0 && (
            <>
              <p className="section-label">Cancelados e expirados</p>
              {inactive.map((a) => <ApptCard key={a.id} a={a} />)}
            </>
          )}
        </div>
      )}

      <button type="button" className="fab" onClick={() => setCreating(true)} aria-label="Novo agendamento">
        <Icon name="plus" size={28} />
      </button>

      {creating && <AppointmentForm defaultDate={date} onClose={() => setCreating(false)} />}

      {view && att && (
        <Sheet title={VIEW_TITLE[view]} onClose={() => openView(null)}>
          {view === 'reminders' && (
            <p className="hint">Clientes confirmadas {att.reminder_date === att.today ? 'de hoje' : 'de amanhã'} que ainda não receberam o lembrete.</p>
          )}
          {view === 'expired' && <p className="hint">Não confirmaram em 48h. O horário voltou a ficar livre no site.</p>}
          {att[view].length === 0
            ? <Empty icon="check" title="Tudo em dia!" />
            : <div className="day-list">{att[view].map((a) => <ApptCard key={a.id} a={a} showDate />)}</div>}
        </Sheet>
      )}
    </div>
  );
}

function AttentionChip({ label, count, tone, icon, onClick }: {
  label: string; count?: number; tone: string; icon: 'clock' | 'bell' | 'alert'; onClick: () => void;
}) {
  return (
    <button type="button" className={`att-chip tone-${tone}${count ? ' has-items' : ''}`} onClick={onClick}>
      <Icon name={icon} size={20} />
      <strong>{count ?? '–'}</strong>
      <span>{label}</span>
    </button>
  );
}

interface Gap { gap: true; s: number; e: number }

/** Intervalos livres do expediente (para a Amanda ver onde cabe mais alguém). */
function freeGaps(win: { s: number; e: number } | null, appts: Appointment[], blocks: { s: number; e: number }[]): Gap[] {
  if (!win) return [];
  const busy = [...appts.map((a) => ({ s: toMin(a.start_time), e: toMin(a.end_time) })), ...blocks].sort((a, b) => a.s - b.s);
  const gaps: Gap[] = [];
  let cursor = win.s;
  for (const b of busy) {
    if (b.s > cursor) gaps.push({ gap: true, s: cursor, e: Math.min(b.s, win.e) });
    cursor = Math.max(cursor, b.e);
  }
  if (cursor < win.e) gaps.push({ gap: true, s: cursor, e: win.e });
  return gaps.filter((g) => g.e - g.s >= 15);
}

function mergeTimeline(appts: Appointment[], gaps: Gap[]): (Appointment | Gap)[] {
  const key = (x: Appointment | Gap) => ('gap' in x ? x.s : toMin(x.start_time));
  return [...appts, ...gaps].sort((a, b) => key(a) - key(b));
}

/** Convites para instalar o app e ativar notificações (somem quando resolvidos). */
function SetupCards() {
  const [push, setPush] = useState<string | null>(null);
  const [installEvt, setInstallEvt] = useState<(Event & { prompt: () => Promise<void> }) | null>(null);
  const standalone = window.matchMedia('(display-mode: standalone)').matches;

  useEffect(() => {
    pushState().then(setPush);
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvt(e as Event & { prompt: () => Promise<void> }); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const cards = [];
  if (!standalone && installEvt) {
    cards.push(
      <div key="install" className="setup-card">
        <Icon name="sparkle" />
        <p>Instale o painel na tela inicial para abrir como um app.</p>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => installEvt.prompt().then(() => setInstallEvt(null))}>Instalar</button>
      </div>,
    );
  }
  if (push === 'off') {
    cards.push(
      <div key="push" className="setup-card">
        <Icon name="bell" />
        <p>Ative as notificações para saber na hora quando uma cliente agendar.</p>
        <Link className="btn btn-primary btn-sm" to="/admin/ajustes#notificacoes">Ativar</Link>
      </div>,
    );
  }
  return cards.length ? <div className="setup-cards">{cards}</div> : null;
}
