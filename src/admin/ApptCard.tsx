import { fmtDateShort } from '../../shared/format';
import { toMin } from '../../shared/time';
import { PAYMENT_LABEL, serviceColor, type Appointment } from '../../shared/types';
import { useApptActions, useReminderDate } from './actions';
import { useAdmin } from './context';
import { Icon, Money, StatusBadge } from './ui';

export function hasStarted(a: Appointment, today: string) {
  const now = new Date();
  return a.date < today || (a.date === today && toMin(a.start_time) <= now.getHours() * 60 + now.getMinutes());
}

/** Bloco de atendimento: nome, serviço, valor e a próxima ação em uma pílula. */
export default function ApptCard({ a, showDate = false, minHeight }: { a: Appointment; showDate?: boolean; minHeight?: number }) {
  const { today } = useAdmin();
  const act = useApptActions();
  const reminderDate = useReminderDate();
  const started = hasStarted(a, today);
  const inactive = a.status === 'cancelled' || a.status === 'expired';
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };

  let action: React.ReactNode = null;
  if (a.status === 'pending' && !a.confirmation_sent_at) {
    action = <button type="button" className="pill-btn solid" onClick={stop(() => act.sendConfirmation(a))}><Icon name="whatsapp" size={15} className="wa-glyph" /> Confirmar</button>;
  } else if (a.status === 'pending') {
    action = <button type="button" className="pill-btn" onClick={stop(() => act.confirm(a))}><Icon name="check" size={15} /> Confirmou</button>;
  } else if (a.status === 'confirmed' && started) {
    action = <button type="button" className="pill-btn solid" onClick={stop(() => act.open(a, 'complete'))}>Concluir</button>;
  } else if (a.status === 'confirmed' && a.date === reminderDate && !a.reminder_sent_at) {
    action = <button type="button" className="pill-btn" onClick={stop(() => act.sendReminder(a))}><Icon name="whatsapp" size={15} className="wa-glyph" /> Lembrar</button>;
  } else if (a.status === 'done') {
    action = <span className="blk-sub">{a.payment_method ? `Pago · ${PAYMENT_LABEL[a.payment_method]}` : 'Concluído'}</span>;
  } else if (a.status === 'confirmed' && a.reminder_sent_at) {
    action = <span className="blk-sub">Lembrete enviado</span>;
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={`blk status-${a.status}${inactive ? ' is-inactive' : ''}`}
      style={{ minHeight, '--svc': serviceColor(a.service_id ?? 0, a.service_color) } as React.CSSProperties}
      onClick={() => act.open(a)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act.open(a); } }}
    >
      <div className="blk-top">
        <h4 className="blk-name">{a.client_name}</h4>
        <StatusBadge status={a.status} />
      </div>
      <p className="blk-sub">
        {showDate && <span className="blk-date">{fmtDateShort(a.date)} · </span>}
        <span className="svc-dot" />{a.service_name} · <span className="num">{a.start_time}–{a.end_time}</span>
      </p>
      {a.notes && <p className="blk-note">“{a.notes}”</p>}
      <div className="blk-foot">
        <Money cents={a.price_cents} />
        {action}
      </div>
    </div>
  );
}
