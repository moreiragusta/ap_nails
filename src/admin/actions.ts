import { useSearchParams } from 'react-router';
import type { Appointment, PaymentMethod } from '../../shared/types';
import { api, ApiError, errorMessage } from '../lib/api';
import { useAdmin, whatsappFor, type MessageKind } from './context';
import { bumpData, confirmDialog, toast } from './ui';

type Action = 'confirmation_sent' | 'undo_confirmation_sent' | 'confirm' | 'reminder_sent' | 'undo_reminder_sent' | 'complete' | 'cancel' | 'reopen';

export async function runAction(id: number, action: Action, extra: Record<string, unknown> = {}): Promise<Appointment | null> {
  try {
    const a = await api<Appointment>(`/api/admin/appointments/${id}/action`, { body: { action, ...extra } });
    bumpData();
    return a;
  } catch (e) {
    if (e instanceof ApiError && e.data.can_force) {
      if (await confirmDialog('Horário em conflito', { text: `${e.message} Quer continuar mesmo assim?`, ok: 'Continuar' })) {
        return runAction(id, action, { ...extra, force: true });
      }
      return null;
    }
    toast(errorMessage(e), 'error');
    return null;
  }
}

/** Ações usadas nos cartões e nos detalhes do agendamento. */
export function useApptActions() {
  const { settings, today } = useAdmin();
  const [params, setParams] = useSearchParams();

  const openWhatsApp = (kind: MessageKind, a: Appointment) => {
    // Abre primeiro (precisa acontecer no toque, senão o navegador bloqueia).
    window.open(whatsappFor(kind, a, settings, today), '_blank', 'noopener');
  };

  return {
    open(a: Appointment, mode?: 'complete') {
      params.set('appt', String(a.id));
      if (mode) params.set('do', mode); else params.delete('do');
      setParams(params);
    },
    sendConfirmation(a: Appointment) {
      openWhatsApp('confirm', a);
      if (!a.confirmation_sent_at) runAction(a.id, 'confirmation_sent');
    },
    sendReminder(a: Appointment) {
      openWhatsApp('reminder', a);
      if (!a.reminder_sent_at) runAction(a.id, 'reminder_sent');
    },
    sendReschedule(a: Appointment) { openWhatsApp('reschedule', a); },
    chat(a: Appointment) { openWhatsApp('chat', a); },
    async confirm(a: Appointment) {
      if (await runAction(a.id, 'confirm')) toast(`${a.client_name.split(' ')[0]} confirmada ✓`);
    },
    async complete(a: Appointment, method: PaymentMethod) {
      const r = await runAction(a.id, 'complete', { payment_method: method });
      if (r) toast('Atendimento concluído');
      return r;
    },
    async cancel(a: Appointment) {
      if (!(await confirmDialog('Cancelar agendamento?', { text: `${a.client_name} — o horário volta a ficar livre no site.`, ok: 'Cancelar agendamento', danger: true }))) return null;
      const r = await runAction(a.id, 'cancel');
      if (r) toast('Agendamento cancelado');
      return r;
    },
    async reopen(a: Appointment) {
      const r = await runAction(a.id, 'reopen');
      if (r) toast('Agendamento reaberto');
      return r;
    },
    undo: (a: Appointment, what: 'undo_confirmation_sent' | 'undo_reminder_sent') => runAction(a.id, what),
  };
}

/** Data em que os lembretes devem ser enviados hoje (o próprio dia ou o seguinte). */
export function useReminderDate() {
  const { settings, today } = useAdmin();
  if (settings.reminder_when === 'same_day') return today;
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
