import { fmtDateShort, fmtMoney } from '../../shared/format';
import { PAYMENT_LABEL, type Appointment } from '../../shared/types';
import { useApptActions, useReminderDate } from './actions';
import { useAdmin } from './context';
import { Icon, StatusBadge } from './ui';

/** Cartão de agendamento com a próxima ação em destaque. */
export default function ApptCard({ a, showDate = false }: { a: Appointment; showDate?: boolean }) {
  const { today } = useAdmin();
  const act = useApptActions();
  const reminderDate = useReminderDate();
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const started = a.date < today || (a.date === today && Number(a.start_time.slice(0, 2)) * 60 + Number(a.start_time.slice(3)) <= nowMin);
  const inactive = a.status === 'cancelled' || a.status === 'expired';

  let primary: React.ReactNode = null;
  if (a.status === 'pending' && !a.confirmation_sent_at) {
    primary = (
      <button type="button" className="btn btn-wa btn-sm" onClick={(e) => { e.stopPropagation(); act.sendConfirmation(a); }}>
        <Icon name="whatsapp" size={18} /> Enviar confirmação
      </button>
    );
  } else if (a.status === 'pending') {
    primary = (
      <div className="card-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); act.confirm(a); }}>
          <Icon name="check" size={18} /> Cliente confirmou
        </button>
        <button type="button" className="icon-btn wa" aria-label="Reenviar confirmação" onClick={(e) => { e.stopPropagation(); act.sendConfirmation(a); }}>
          <Icon name="whatsapp" size={20} />
        </button>
      </div>
    );
  } else if (a.status === 'confirmed' && started) {
    primary = (
      <button type="button" className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); act.open(a, 'complete'); }}>
        <Icon name="money" size={18} /> Concluir
      </button>
    );
  } else if (a.status === 'confirmed' && a.date === reminderDate && !a.reminder_sent_at) {
    primary = (
      <button type="button" className="btn btn-wa btn-sm" onClick={(e) => { e.stopPropagation(); act.sendReminder(a); }}>
        <Icon name="whatsapp" size={18} /> Enviar lembrete
      </button>
    );
  }

  const flags: string[] = [];
  if (a.status === 'pending' && a.confirmation_sent_at) flags.push('Confirmação enviada');
  if (a.status === 'confirmed' && a.reminder_sent_at) flags.push('Lembrete enviado');
  if (a.status === 'done' && a.payment_method) flags.push(PAYMENT_LABEL[a.payment_method]);
  if (a.source === 'site' && a.status === 'pending' && !a.confirmation_sent_at) flags.push('Novo pelo site');

  return (
    <article className={`appt-card status-${a.status}${inactive ? ' is-inactive' : ''}`} onClick={() => act.open(a)}>
      <div className="appt-time">
        {showDate && <span className="appt-date">{fmtDateShort(a.date)}</span>}
        <strong>{a.start_time}</strong>
        <span>{a.end_time}</span>
      </div>
      <div className="appt-main">
        <div className="appt-top">
          <h3>{a.client_name}</h3>
          <StatusBadge status={a.status} />
        </div>
        <p className="appt-service">{a.service_name} · {fmtMoney(a.price_cents)}</p>
        {flags.length > 0 && <p className="appt-flags">{flags.join(' · ')}</p>}
        {a.notes && <p className="appt-notes">“{a.notes}”</p>}
        {primary && <div className="appt-primary">{primary}</div>}
      </div>
    </article>
  );
}
