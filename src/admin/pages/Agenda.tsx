import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { fmtDateLong, fmtDayMonth, firstName, monthName, weekdayShort } from '../../../shared/format';
import { dayBlocks, dayWindow, type Interval } from '../../../shared/schedule';
import { addDays, toHHMM, toMin } from '../../../shared/time';
import type { Appointment, DateException, WeeklyHour } from '../../../shared/types';
import { api } from '../../lib/api';
import { pushState } from '../../lib/push';
import ApptCard from '../ApptCard';
import { useAdmin } from '../context';
import { Empty, Icon, Loading, Money, SecHead, Sheet, useDataVersion } from '../ui';

interface Attention { today: string; reminder_date: string; pending: Appointment[]; reminders: Appointment[]; expired: Appointment[] }
type View = 'send' | 'waiting' | 'reminders' | 'expired';

const PAST_DAYS = 7;
const PX_PER_MIN = 1.1;

export default function Agenda() {
  const { today, settings } = useAdmin();
  const [params, setParams] = useSearchParams();
  const [date, setDate] = useState(today);
  const [appts, setAppts] = useState<Appointment[] | null>(null);
  const [att, setAtt] = useState<Attention | null>(null);
  const [hours, setHours] = useState<WeeklyHour[]>([]);
  const [exceptions, setExceptions] = useState<DateException[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const version = useDataVersion();
  const view = params.get('view') as View | null;

  const from = addDays(today, -PAST_DAYS);
  const to = addDays(today, settings.window_days);
  const rangeFrom = date < from ? date : from;
  const rangeTo = date > to ? date : to;

  useEffect(() => { api<Attention>('/api/admin/appointments/attention').then(setAtt).catch(() => {}); }, [version]);
  useEffect(() => { api<WeeklyHour[]>('/api/admin/settings/hours').then(setHours).catch(() => {}); }, [version]);
  useEffect(() => {
    Promise.all([
      api<Appointment[]>(`/api/admin/appointments?from=${rangeFrom}&to=${rangeTo}`),
      api<DateException[]>(`/api/admin/settings/exceptions?from=${rangeFrom}&to=${rangeTo}`),
    ]).then(([a, ex]) => { setAppts(a); setExceptions(ex); }).catch(() => setAppts([]));
  }, [rangeFrom, rangeTo, version]);
  useEffect(() => { setShowInactive(false); }, [date]);

  const days = useMemo(() => {
    const n = Math.round((Date.parse(rangeTo) - Date.parse(rangeFrom)) / 86400000) + 1;
    return Array.from({ length: n }, (_, i) => addDays(rangeFrom, i));
  }, [rangeFrom, rangeTo]);

  const isActive = (a: Appointment) => a.status !== 'cancelled' && a.status !== 'expired';
  const dayAppts = (appts ?? []).filter((a) => a.date === date);
  const active = dayAppts.filter(isActive);
  const inactive = dayAppts.filter((a) => !isActive(a));
  const todays = (appts ?? []).filter((a) => a.date === today && isActive(a));
  const win = hours.length ? dayWindow(date, hours, exceptions) : null;
  const todayWin = hours.length ? dayWindow(today, hours, exceptions) : null;
  const closedReason = exceptions.find((x) => x.kind === 'closed' && x.date_from <= date && x.date_to >= date)?.reason;
  const blocks = dayBlocks(date, exceptions);
  const timeline = useMemo(() => buildTimeline(win, active, blocks), [win, active, blocks]);

  const openView = (v: View | null) => {
    if (v) params.set('view', v); else params.delete('view');
    setParams(params);
  };
  const openNew = (d: string, t?: string) => {
    params.set('novo', '1');
    params.set('data', d);
    if (t) params.set('hora', t); else params.delete('hora');
    setParams(params);
  };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const dayLabel = date === today ? 'Hoje' : date === addDays(today, 1) ? 'Amanhã' : date === addDays(today, -1) ? 'Ontem' : fmtDateLong(date);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">{fmtDateLong(today)}</div>
          <h1 className="display">{greeting}, {settings.owner_name || 'Amanda'}</h1>
        </div>
        <span className="mono" aria-hidden="true" />
      </header>
      <div className="subline">
        {todayWin ? (
          <>
            <span>{todays.length === 0 ? 'Nenhuma cliente hoje' : `${todays.length} ${todays.length === 1 ? 'cliente' : 'clientes'} hoje`}</span>
            <i /><span className="num">{toHHMM(todayWin.s)} às {toHHMM(todayWin.e)}</span>
            {todays.length > 0 && <><i /><span><Money cents={todays.reduce((s, a) => s + a.price_cents, 0)} /> previstos</span></>}
          </>
        ) : <span>Hoje você não atende</span>}
      </div>

      <DayStrip days={days} selected={date} today={today} appts={appts ?? []} hours={hours} exceptions={exceptions} onSelect={setDate} />

      <Inbox att={att} onOpen={openView} />

      <SecHead
        title={dayLabel}
        action={date !== today ? <button type="button" className="link" onClick={() => setDate(today)}>Voltar para hoje</button> : undefined}
      />

      {appts === null ? <Loading /> : (
        <>
          {!win && active.length === 0 ? (
            <div className="day-closed">
              <strong>Dia fechado</strong>
              <p>{closedReason || 'Você não atende neste dia.'}</p>
              <button type="button" className="link" onClick={() => openNew(date)}>Agendar mesmo assim</button>
            </div>
          ) : (
            <div className="tl">
              {timeline.map((item) => (
                item.kind === 'appt' ? (
                  <div key={`a${item.a.id}`} className="tl-row">
                    <span className="tl-time">{item.a.start_time}</span>
                    <ApptCard a={item.a} minHeight={Math.max(104, (item.e - item.s) * PX_PER_MIN)} />
                  </div>
                ) : item.kind === 'free' ? (
                  <div key={`f${item.s}`} className="tl-row is-free">
                    <span className="tl-time">{toHHMM(item.s)}</span>
                    <button type="button" className="free" style={{ minHeight: Math.max(52, (item.e - item.s) * PX_PER_MIN * 0.7) }} onClick={() => openNew(date, toHHMM(item.s))}>
                      <span>Livre <span className="num">{toHHMM(item.s)}–{toHHMM(item.e)}</span></span><b>+ Encaixar</b>
                    </button>
                  </div>
                ) : (
                  <div key={`b${item.s}`} className="tl-row is-free">
                    <span className="tl-time">{toHHMM(item.s)}</span>
                    <div className="free" style={{ minHeight: 44, cursor: 'default' }}>Bloqueado <span className="num">{toHHMM(item.s)}–{toHHMM(item.e)}</span></div>
                  </div>
                )
              ))}
              {timeline.length === 0 && <Empty icon="calendar" title="Agenda livre" text="Nenhum atendimento neste dia." />}
            </div>
          )}

          {inactive.length > 0 && (
            <div className="toggle-more">
              <button type="button" className="link" onClick={() => setShowInactive(!showInactive)}>
                {showInactive ? 'Ocultar' : 'Ver'} {inactive.length} {inactive.length === 1 ? 'cancelado ou expirado' : 'cancelados ou expirados'}
              </button>
              {showInactive && <div className="tl" style={{ marginTop: 10 }}>{inactive.map((a) => <ApptCard key={a.id} a={a} />)}</div>}
            </div>
          )}
        </>
      )}

      {view && att && <AttentionSheet view={view} att={att} onClose={() => openView(null)} />}
    </div>
  );
}

// ------------------------------------------------------------ faixa de dias

function DayStrip({ days, selected, today, appts, hours, exceptions, onSelect }: {
  days: string[]; selected: string; today: string; appts: Appointment[]; hours: WeeklyHour[]; exceptions: DateException[]; onSelect: (d: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  // Centraliza o dia escolhido na faixa (sem rolar a página).
  useEffect(() => {
    const box = ref.current;
    const el = box?.querySelector<HTMLElement>('.day.is-selected');
    if (!box || !el) return;
    const left = el.offsetLeft - box.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2;
    box.scrollTo({ left, behavior: first.current ? 'auto' : 'smooth' });
    first.current = false;
  }, [selected, days.length]);
  const month = monthName(Number(selected.slice(5, 7)));

  return (
    <>
      <div className="month-row">
        <label className="month-btn">
          {month[0].toUpperCase() + month.slice(1)} {selected.slice(0, 4) !== today.slice(0, 4) && selected.slice(0, 4)} <Icon name="down" size={16} />
          <input type="date" value={selected} onChange={(e) => e.target.value && onSelect(e.target.value)} aria-label="Escolher data" />
        </label>
      </div>
      <div className="days" ref={ref}>
        {days.map((d) => {
          const list = appts.filter((a) => a.date === d && a.status !== 'cancelled' && a.status !== 'expired');
          const closed = hours.length > 0 && !dayWindow(d, hours, exceptions) && list.length === 0;
          const pending = list.some((a) => a.status === 'pending');
          return (
            <button key={d} type="button" onClick={() => onSelect(d)}
              className={`day${d === selected ? ' is-selected' : ''}${closed ? ' is-closed' : ''}`}
              aria-label={`${fmtDateLong(d)}${list.length ? `, ${list.length} atendimentos` : ''}`}>
              <span>{d === today ? 'hoje' : weekdayShort(d)}</span>
              <b>{Number(d.slice(8))}</b>
              <i className={pending ? 'warn' : list.length ? 'on' : ''} />
            </button>
          );
        })}
      </div>
    </>
  );
}

// ------------------------------------------------------------ precisa de você

const who = (list: Appointment[], today: string) => list.slice(0, 3).map((a) => {
  const when = a.date === today ? a.start_time : a.date === addDays(today, 1) ? 'amanhã' : fmtDayMonth(a.date);
  return `${firstName(a.client_name)} (${when})`;
}).join(', ') + (list.length > 3 ? ` e mais ${list.length - 3}` : '');

function Inbox({ att, onOpen }: { att: Attention | null; onOpen: (v: View) => void }) {
  const [push, setPush] = useState<string | null>(null);
  const [installEvt, setInstallEvt] = useState<(Event & { prompt: () => Promise<void> }) | null>(null);
  useEffect(() => {
    pushState().then(setPush);
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvt(e as Event & { prompt: () => Promise<void> }); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);
  if (!att) return null;

  const send = att.pending.filter((a) => !a.confirmation_sent_at);
  const waiting = att.pending.filter((a) => a.confirmation_sent_at);
  const rows: React.ReactNode[] = [];
  const row = (key: string, icon: React.ReactNode, tone: string, text: string, sub: string, onClick: () => void) => rows.push(
    <button key={key} type="button" className="task" onClick={onClick}>
      <span className={`task-icon ${tone}`}>{icon}</span>
      <span className="task-text">{text}<small>{sub}</small></span>
      <Icon name="right" size={18} className="chev" />
    </button>,
  );

  if (send.length) row('send', <Icon name="clock" size={18} />, 'amber', `${send.length} ${send.length === 1 ? 'confirmação para enviar' : 'confirmações para enviar'}`, who(send, att.today), () => onOpen('send'));
  if (att.reminders.length) {
    const day = att.reminder_date === att.today ? 'de hoje' : 'de amanhã';
    row('rem', <Icon name="whatsapp" size={18} />, 'wa', `${att.reminders.length} ${att.reminders.length === 1 ? 'lembrete' : 'lembretes'} ${day}`, who(att.reminders, att.today), () => onOpen('reminders'));
  }
  if (waiting.length) row('wait', <Icon name="message" size={18} />, 'grey', `${waiting.length} ${waiting.length === 1 ? 'aguardando resposta' : 'aguardando resposta'}`, who(waiting, att.today), () => onOpen('waiting'));
  if (att.expired.length) row('exp', <Icon name="alert" size={18} />, 'rose', `${att.expired.length} ${att.expired.length === 1 ? 'horário liberado' : 'horários liberados'}`, `Não confirmaram: ${who(att.expired, att.today)}`, () => onOpen('expired'));
  if (push === 'off') {
    rows.push(
      <Link key="push" to="/admin/ajustes/notificacoes" className="task">
        <span className="task-icon rose"><Icon name="bell" size={18} /></span>
        <span className="task-text">Ativar notificações<small>Saiba na hora quando uma cliente agendar</small></span>
        <Icon name="right" size={18} className="chev" />
      </Link>,
    );
  }
  if (installEvt && !window.matchMedia('(display-mode: standalone)').matches) {
    rows.push(
      <button key="install" type="button" className="task" onClick={() => installEvt.prompt().then(() => setInstallEvt(null))}>
        <span className="task-icon rose"><Icon name="sparkle" size={18} /></span>
        <span className="task-text">Instalar o app<small>Abra o painel direto da tela inicial</small></span>
        <Icon name="right" size={18} className="chev" />
      </button>,
    );
  }
  if (!rows.length) return null;
  return (
    <>
      <SecHead title="Precisa de você" />
      <div className="rows">{rows}</div>
    </>
  );
}

const VIEW_TITLE: Record<View, string> = {
  send: 'Confirmações para enviar',
  waiting: 'Aguardando resposta',
  reminders: 'Lembretes para enviar',
  expired: 'Horários liberados',
};
const VIEW_HINT: Record<View, string> = {
  send: 'Agendaram pelo site. Envie a confirmação pelo WhatsApp: o prazo de 48h começa a contar a partir do envio.',
  waiting: 'A confirmação já foi enviada. Quando a cliente responder, toque em “Confirmou”.',
  reminders: 'Clientes confirmadas que ainda não receberam o lembrete.',
  expired: 'Não confirmaram em 48h e o horário voltou a ficar livre no site. Você pode chamar a cliente ou reabrir o horário.',
};

function AttentionSheet({ view, att, onClose }: { view: View; att: Attention; onClose: () => void }) {
  const list = view === 'send' ? att.pending.filter((a) => !a.confirmation_sent_at)
    : view === 'waiting' ? att.pending.filter((a) => a.confirmation_sent_at)
      : view === 'reminders' ? att.reminders : att.expired;
  return (
    <Sheet title={VIEW_TITLE[view]} onClose={onClose}>
      <p className="hint">{VIEW_HINT[view]}</p>
      {list.length === 0 ? <Empty icon="check" title="Tudo em dia" /> : (
        <div className="tl">{list.map((a) => <ApptCard key={a.id} a={a} showDate />)}</div>
      )}
    </Sheet>
  );
}

// ------------------------------------------------------------ linha do tempo

type TLItem =
  | { kind: 'appt'; s: number; e: number; a: Appointment }
  | { kind: 'free'; s: number; e: number }
  | { kind: 'block'; s: number; e: number };

/** Atendimentos, bloqueios e espaços livres do expediente, em ordem. */
function buildTimeline(win: Interval | null, appts: Appointment[], blocks: Interval[]): TLItem[] {
  const items: TLItem[] = [
    ...appts.map((a) => ({ kind: 'appt' as const, s: toMin(a.start_time), e: toMin(a.end_time), a })),
    ...blocks.map((b) => ({ kind: 'block' as const, s: b.s, e: b.e })),
  ].sort((x, y) => x.s - y.s);
  if (!win) return items;
  const out: TLItem[] = [];
  let cursor = win.s;
  for (const it of items) {
    if (it.s > cursor && it.s > win.s && cursor < win.e) out.push({ kind: 'free', s: cursor, e: Math.min(it.s, win.e) });
    out.push(it);
    cursor = Math.max(cursor, it.e);
  }
  if (cursor < win.e) out.push({ kind: 'free', s: cursor, e: win.e });
  return out.filter((x) => x.kind !== 'free' || x.e - x.s >= 15);
}
