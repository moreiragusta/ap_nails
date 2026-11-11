import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { fmtMoney, fmtPhone } from '../../shared/format';
import { localToUtcMs } from '../../shared/time';
import { PAYMENT_LABEL, type Appointment, type PaymentMethod } from '../../shared/types';
import { api, errorMessage } from '../lib/api';
import { useApptActions } from './actions';
import AppointmentForm from './AppointmentForm';
import { fullDate } from './context';
import { bumpData, confirmDialog, Icon, Loading, Sheet, StatusBadge, toast, useDataVersion } from './ui';

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;

const H = 3600_000;

/** Detalhes de um agendamento com todas as ações. */
export default function AppointmentSheet({ id, initialMode, onClose }: { id: number; initialMode: 'view' | 'complete'; onClose: () => void }) {
  const [a, setA] = useState<Appointment | null>(null);
  const [mode, setMode] = useState<'view' | 'complete' | 'edit'>(initialMode);
  const [notes, setNotes] = useState('');
  const version = useDataVersion();
  const act = useApptActions();
  const navigate = useNavigate();

  useEffect(() => {
    api<Appointment>(`/api/admin/appointments/${id}`)
      .then((r) => { setA(r); setNotes(r.notes); })
      .catch((e) => { toast(errorMessage(e), 'error'); onClose(); });
  }, [id, version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!a) return <Sheet title="Agendamento" onClose={onClose}><Loading /></Sheet>;

  if (mode === 'edit') {
    return (
      <AppointmentForm
        appt={a}
        onClose={() => setMode('view')}
        onSaved={(updated, moved) => {
          setMode('view');
          if (moved) {
            toast('Agendamento remarcado');
            confirmDialog('Avisar a cliente?', { text: 'Abrir o WhatsApp com a nova data e horário?', ok: 'Abrir WhatsApp' })
              .then((ok) => { if (ok) act.sendReschedule(updated); });
          }
        }}
      />
    );
  }

  async function saveNotes() {
    if (!a || notes === a.notes) return;
    try {
      await api(`/api/admin/appointments/${a.id}`, { method: 'PATCH', body: { notes } });
      bumpData();
      toast('Observação salva');
    } catch (e) { toast(errorMessage(e), 'error'); }
  }

  if (mode === 'complete') {
    const pay = async (m: PaymentMethod) => { if (await act.complete(a, m)) onClose(); };
    return (
      <Sheet title="Concluir atendimento" onClose={onClose}>
        <div className="complete-head">
          <p className="complete-name">{a.client_name}</p>
          <p>{a.service_name}</p>
          <p className="complete-value">{fmtMoney(a.price_cents)}</p>
        </div>
        <p className="section-label">Como a cliente pagou?</p>
        <div className="pay-grid">
          {(Object.keys(PAYMENT_LABEL) as PaymentMethod[]).map((m) => (
            <button key={m} type="button" className={`pay-btn${a.payment_method === m ? ' is-selected' : ''}`} onClick={() => pay(m)}>
              {PAYMENT_LABEL[m]}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-ghost btn-block" onClick={() => setMode('view')}>Voltar</button>
      </Sheet>
    );
  }

  // Prazo de expiração (48h após o envio), exceto quando o atendimento é antes disso.
  let expiryNote: string | null = null;
  if (a.status === 'pending' && a.confirmation_sent_at) {
    const deadline = Date.parse(a.confirmation_sent_at) + 48 * H;
    const startsAt = localToUtcMs(a.date, a.start_time, 'America/Sao_Paulo');
    if (startsAt <= deadline) expiryNote = 'O atendimento é antes do prazo de 48h: não expira sozinho. Decida se mantém ou cancela.';
    else {
      const left = Math.max(0, Math.round((deadline - Date.now()) / H));
      expiryNote = `Se a cliente não confirmar, o horário é liberado em ${left}h.`;
    }
  } else if (a.status === 'pending') {
    expiryNote = 'Envie a confirmação pelo WhatsApp. O prazo de 48h começa a contar a partir do envio.';
  }

  const rows: [string, string | null][] = [
    ['Serviço', a.service_name],
    ['Data', fullDate(a.date)],
    ['Horário', `${a.start_time} às ${a.end_time}`],
    ['Valor', fmtMoney(a.price_cents)],
    ['WhatsApp', fmtPhone(a.client_phone)],
    ['Origem', a.source === 'site' ? 'Agendado pelo site' : 'Lançado no painel'],
    ['Agendado em', when(a.created_at)],
    ['Confirmação enviada', when(a.confirmation_sent_at)],
    ['Confirmado em', when(a.confirmed_at)],
    ['Lembrete enviado', when(a.reminder_sent_at)],
    ['Concluído em', when(a.completed_at)],
    ['Pagamento', a.payment_method ? PAYMENT_LABEL[a.payment_method] : null],
    ['Cancelado em', when(a.cancelled_at)],
    ['Expirou em', when(a.expired_at)],
  ];

  const isOpen = a.status === 'pending' || a.status === 'confirmed';

  return (
    <Sheet title={<>{a.client_name} <StatusBadge status={a.status} /></>} onClose={onClose}>
      {expiryNote && <p className="note-box"><Icon name="clock" size={18} /> {expiryNote}</p>}

      <div className="action-grid">
        {a.status === 'pending' && (
          <>
            <button type="button" className="btn btn-wa" onClick={() => act.sendConfirmation(a)}>
              <Icon name="whatsapp" size={20} /> {a.confirmation_sent_at ? 'Reenviar confirmação' : 'Enviar confirmação'}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => act.confirm(a)}>
              <Icon name="check" size={20} /> Cliente confirmou
            </button>
          </>
        )}
        {a.status === 'confirmed' && (
          <>
            <button type="button" className="btn btn-wa" onClick={() => act.sendReminder(a)}>
              <Icon name="whatsapp" size={20} /> {a.reminder_sent_at ? 'Reenviar lembrete' : 'Enviar lembrete'}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setMode('complete')}>
              <Icon name="money" size={20} /> Concluir
            </button>
          </>
        )}
        {(a.status === 'cancelled' || a.status === 'expired') && (
          <button type="button" className="btn btn-primary" onClick={() => act.reopen(a)}>
            <Icon name="undo" size={20} /> Reabrir
          </button>
        )}
        {a.status === 'done' && (
          <button type="button" className="btn btn-outline" onClick={() => setMode('complete')}>
            <Icon name="edit" size={20} /> Trocar pagamento
          </button>
        )}
        <button type="button" className="btn btn-outline" onClick={() => act.chat(a)}>
          <Icon name="whatsapp" size={20} /> Conversar
        </button>
        {isOpen && (
          <button type="button" className="btn btn-outline" onClick={() => setMode('edit')}>
            <Icon name="calendar" size={20} /> Remarcar / editar
          </button>
        )}
      </div>

      {a.status === 'pending' && a.confirmation_sent_at && (
        <button type="button" className="link-btn" onClick={() => act.undo(a, 'undo_confirmation_sent')}>
          Não cheguei a enviar a confirmação
        </button>
      )}
      {a.status === 'confirmed' && a.reminder_sent_at && (
        <button type="button" className="link-btn" onClick={() => act.undo(a, 'undo_reminder_sent')}>
          Não cheguei a enviar o lembrete
        </button>
      )}

      <dl className="info-list">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>

      <label className="field">
        <span>Observações</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} placeholder="Ex.: prefere tons nude" />
      </label>

      <div className="sheet-links">
        <button type="button" className="link-btn" onClick={() => { onClose(); navigate(`/admin/clientes?client=${a.client_id}`); }}>
          Ver ficha da cliente
        </button>
        {a.status === 'done' && (
          <button type="button" className="link-btn" onClick={() => act.reopen(a)}>Desfazer conclusão</button>
        )}
        {isOpen && (
          <button type="button" className="link-btn danger" onClick={async () => { if (await act.cancel(a)) onClose(); }}>
            Cancelar agendamento
          </button>
        )}
      </div>
    </Sheet>
  );
}
