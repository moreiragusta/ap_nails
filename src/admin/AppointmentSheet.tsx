import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { fmtDateBR, fmtDayMonth, fmtDuration, fmtPhone, weekdayName } from '../../shared/format';
import { addDays, localToUtcMs } from '../../shared/time';
import { PAYMENT_LABEL, type AppointmentDetail, type PaymentMethod } from '../../shared/types';
import { api, errorMessage } from '../lib/api';
import { waLink } from '../lib/phone';
import { useApptActions, useReminderDate } from './actions';
import { hasStarted } from './ApptCard';
import AppointmentForm from './AppointmentForm';
import { useAdmin } from './context';
import { Avatar, bumpData, confirmDialog, Icon, Loading, Money, Sheet, StatusBadge, toast, useDataVersion } from './ui';

const H = 3600_000;
const hhmm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
const shortWhen = (iso: string | null, today: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return local === today ? hhmm(iso) : `${fmtDayMonth(local)} ${hhmm(iso)}`;
};

const PAY_ICON: Record<PaymentMethod, Parameters<typeof Icon>[0]['name']> = { pix: 'pix', cash: 'money', debit: 'card', credit: 'contactless' };

/** Detalhe do atendimento: quem, quando, em que ponto está e a próxima ação. */
export default function AppointmentSheet({ id, initialMode, onClose }: { id: number; initialMode: 'view' | 'complete'; onClose: () => void }) {
  const { today } = useAdmin();
  const [a, setA] = useState<AppointmentDetail | null>(null);
  const [mode, setMode] = useState<'view' | 'complete' | 'edit' | 'note'>(initialMode);
  const [note, setNote] = useState('');
  const version = useDataVersion();
  const act = useApptActions();
  const reminderDate = useReminderDate();
  const navigate = useNavigate();

  useEffect(() => {
    api<AppointmentDetail>(`/api/admin/appointments/${id}`)
      .then((r) => { setA(r); setNote(r.client.notes); })
      .catch((e) => { toast(errorMessage(e), 'error'); onClose(); });
  }, [id, version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!a) return <Sheet onClose={onClose}><Loading /></Sheet>;

  if (mode === 'edit') {
    return (
      <AppointmentForm
        appt={a}
        onClose={() => setMode('view')}
        onSaved={(updated, moved) => {
          setMode('view');
          if (moved) {
            toast('Horário remarcado');
            confirmDialog('Avisar a cliente?', { text: 'Abrir o WhatsApp com o novo dia e horário?', ok: 'Abrir WhatsApp' })
              .then((ok) => { if (ok) act.sendReschedule(updated); });
          }
        }}
      />
    );
  }

  if (mode === 'complete') {
    const pay = async (m: PaymentMethod) => { if (await act.complete(a, m)) onClose(); };
    return (
      <Sheet title="Registrar pagamento" onClose={onClose}>
        <div className="pay-head">
          <p className="eyebrow">{a.client_name} · {a.service_name}</p>
          <Money cents={a.price_cents} showCents />
        </div>
        <div className="pay-grid">
          {(Object.keys(PAYMENT_LABEL) as PaymentMethod[]).map((m) => (
            <button key={m} type="button" className={`pay-btn${a.payment_method === m ? ' is-selected' : ''}`} onClick={() => pay(m)}>
              <Icon name={PAY_ICON[m]} size={24} />
              {PAYMENT_LABEL[m]}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-ghost btn-block" onClick={() => setMode('view')}>Voltar</button>
      </Sheet>
    );
  }

  async function saveNote() {
    if (!a) return;
    try {
      await api(`/api/admin/clients/${a.client_id}`, { method: 'PUT', body: { name: a.client_name, phone: a.client_phone, notes: note } });
      bumpData();
      setMode('view');
      toast('Observação salva na ficha da cliente');
    } catch (e) { toast(errorMessage(e), 'error'); }
  }

  if (mode === 'note') {
    return (
      <Sheet title="Observações da cliente" onClose={() => setMode('view')}
        footer={<button type="button" className="btn btn-primary btn-block" onClick={saveNote}>Salvar</button>}>
        <p className="hint">Ficam na ficha de {a.client_name.split(' ')[0]} e aparecem em todos os atendimentos dela.</p>
        <label className="field">
          <span>Preferências, alergias, cuidados</span>
          <textarea rows={5} value={note} onChange={(e) => setNote(e.target.value)} autoFocus placeholder="Ex.: prefere tons nude; unhas sensíveis" />
        </label>
      </Sheet>
    );
  }

  // ---------------------------------------------------------------- visualização
  const started = hasStarted(a, today);
  const isOpen = a.status === 'pending' || a.status === 'confirmed';
  const visitN = a.client.visits + (a.status === 'done' ? 0 : 1);
  const dayLabel = a.date === today ? 'Hoje' : a.date === addDays(today, 1) ? 'Amanhã' : a.date === addDays(today, -1) ? 'Ontem' : fmtDateBR(a.date);

  // Linha de progresso
  const viaSite = a.source === 'site';
  const steps = [
    { label: 'Agendou', sub: viaSite ? 'pelo site' : 'no painel', state: 'done' },
    {
      label: 'Confirmação',
      sub: !viaSite ? 'não precisa' : a.confirmation_sent_at ? `enviada ${shortWhen(a.confirmation_sent_at, today)}` : 'enviar',
      state: !viaSite || a.confirmation_sent_at ? 'done' : 'cur',
    },
    {
      label: 'Confirmou',
      sub: a.confirmed_at ? shortWhen(a.confirmed_at, today) : 'aguardando',
      state: a.confirmed_at ? 'done' : a.status === 'pending' && a.confirmation_sent_at ? 'cur' : '',
    },
    {
      label: a.status === 'cancelled' ? 'Cancelado' : a.status === 'expired' ? 'Expirou' : 'Atendimento',
      sub: a.status === 'done' ? (a.payment_method ? PAYMENT_LABEL[a.payment_method] : 'concluído') : a.status === 'cancelled' || a.status === 'expired' ? '' : a.start_time,
      state: a.status === 'done' ? 'done' : a.status === 'confirmed' ? 'cur' : a.status === 'cancelled' || a.status === 'expired' ? 'stop' : '',
    },
  ];

  // Prazo de expiração
  let callout: string | null = null;
  if (a.status === 'pending' && a.confirmation_sent_at) {
    const deadline = Date.parse(a.confirmation_sent_at) + 48 * H;
    const startsAt = localToUtcMs(a.date, a.start_time, 'America/Sao_Paulo');
    callout = startsAt <= deadline
      ? 'O atendimento é antes do prazo de 48h, então não expira sozinho. Decida se mantém ou cancela.'
      : `Se ela não responder, o horário é liberado em ${Math.max(0, Math.round((deadline - Date.now()) / H))}h.`;
  }

  // Ação principal
  const reminderDue = a.status === 'confirmed' && a.date === reminderDate && !a.reminder_sent_at && !started;
  let primary: React.ReactNode = null;
  if (a.status === 'pending' && !a.confirmation_sent_at) {
    primary = <button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => act.sendConfirmation(a)}><Icon name="whatsapp" size={20} className="wa-glyph" /> Enviar confirmação</button>;
  } else if (a.status === 'pending') {
    primary = <button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => act.confirm(a)}><Icon name="check" size={20} /> Ela confirmou</button>;
  } else if (reminderDue) {
    primary = <button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => act.sendReminder(a)}><Icon name="whatsapp" size={20} className="wa-glyph" /> Enviar lembrete</button>;
  } else if (a.status === 'confirmed') {
    primary = <button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => setMode('complete')}>Concluir e registrar pagamento</button>;
  } else if (a.status === 'done') {
    primary = <div className="paid"><Icon name="check" size={18} /> Pago{a.payment_method ? ` no ${PAYMENT_LABEL[a.payment_method]}` : ''}</div>;
  } else {
    primary = <button type="button" className="btn btn-soft btn-block btn-lg" onClick={() => act.reopen(a)}><Icon name="undo" size={20} /> Reabrir horário</button>;
  }

  // Ações secundárias
  const secondary: React.ReactNode[] = [];
  if (a.status === 'pending' && a.confirmation_sent_at) secondary.push(<button key="re" type="button" className="text-btn" onClick={() => act.sendConfirmation(a)}><Icon name="whatsapp" size={16} className="wa-glyph" /> Reenviar</button>);
  if (a.status === 'pending' && !a.confirmation_sent_at) secondary.push(<button key="ok" type="button" className="text-btn" onClick={() => act.confirm(a)}><Icon name="check" size={16} /> Já confirmou</button>);
  if (a.status === 'confirmed' && !reminderDue) secondary.push(<button key="lem" type="button" className="text-btn" onClick={() => act.sendReminder(a)}><Icon name="whatsapp" size={16} className="wa-glyph" /> {a.reminder_sent_at ? 'Lembrar de novo' : 'Lembrar'}</button>);
  if (reminderDue) secondary.push(<button key="done" type="button" className="text-btn" onClick={() => setMode('complete')}>Concluir</button>);
  if (isOpen) secondary.push(<button key="rem" type="button" className="text-btn" onClick={() => setMode('edit')}>Remarcar</button>);
  if (isOpen) secondary.push(<button key="can" type="button" className="text-btn danger" onClick={async () => { if (await act.cancel(a)) onClose(); }}>Cancelar</button>);
  if (a.status === 'done') {
    secondary.push(<button key="pay" type="button" className="text-btn" onClick={() => setMode('complete')}>Trocar pagamento</button>);
    secondary.push(<button key="undo" type="button" className="text-btn" onClick={() => act.reopen(a)}>Desfazer conclusão</button>);
  }

  return (
    <Sheet onClose={onClose}>
      <div className="who">
        <Avatar name={a.client_name} size="lg" />
        <div className="who-text">
          <h2>{a.client_name}</h2>
          <small><span className="num">{fmtPhone(a.client_phone)}</span> · {visitN <= 1 ? 'primeira visita' : `${visitN}ª visita`}</small>
        </div>
        <a className="round-btn wa" href={waLink(a.client_phone)} target="_blank" rel="noreferrer" aria-label="Conversar no WhatsApp"><Icon name="whatsapp" size={21} /></a>
        <a className="round-btn" href={`tel:+${a.client_phone}`} aria-label="Ligar"><Icon name="phone" size={19} /></a>
      </div>

      <div className="when surface">
        <div className="eyebrow">{dayLabel}, {weekdayName(a.date)} <StatusBadge status={a.status} /></div>
        <div className="when-time">{a.start_time} – {a.end_time}</div>
        <div className="when-row">
          <span>{a.service_name} <span className="muted">· {fmtDuration(a.duration_min)}</span></span>
          <Money cents={a.price_cents} />
        </div>
      </div>

      <div className="steps" aria-label="Andamento">
        {steps.map((s) => (
          <div key={s.label} className={`step ${s.state}`}>
            <i>{s.state === 'done' && <Icon name="check" size={12} />}{s.state === 'stop' && <Icon name="x" size={11} />}</i>
            {s.label}
            {s.sub && <small>{s.sub}</small>}
          </div>
        ))}
      </div>

      {callout && <p className="callout"><Icon name="clock" size={18} /> {callout}</p>}

      <div className="cta-area">{primary}</div>
      {secondary.length > 0 && <div className="sub-actions">{secondary}</div>}

      {a.notes && <p className="callout soft"><Icon name="message" size={18} /> {a.notes}</p>}
      <button type="button" className="note-card surface" onClick={() => setMode('note')}>
        <Icon name="pencil" size={16} />
        {a.client.notes ? <span><b>{a.client.notes}</b></span> : <span>Adicionar observação sobre a cliente (preferências, alergias…)</span>}
      </button>

      <p className="facts">
        {a.client.last_visit ? <>Última visita {fmtDateBR(a.client.last_visit)} · </> : null}
        {a.client.visits > 0 && <><Money cents={a.client.total_cents} /> no total · </>}
        <button type="button" className="link" onClick={() => { onClose(); navigate(`/admin/clientes?client=${a.client_id}`); }}>Ver ficha</button>
      </p>
    </Sheet>
  );
}
