import { useEffect, useState } from 'react';
import { fmtDuration, fmtMoney, fmtPhone } from '../../shared/format';
import type { Appointment, Client } from '../../shared/types';
import { api, ApiError, errorMessage } from '../lib/api';
import { isValidPhone, maskPhone } from '../lib/phone';
import { useAdmin } from './context';
import { bumpData, confirmDialog, Sheet, toast } from './ui';

/** Novo agendamento (lançado pela Amanda) ou remarcação/edição de um existente. */
export default function AppointmentForm({ appt, defaultDate, onClose, onSaved }: {
  appt?: Appointment;
  defaultDate?: string;
  onClose: () => void;
  onSaved?: (a: Appointment, moved: boolean) => void;
}) {
  const { services, today } = useAdmin();
  const editing = !!appt;
  const [client, setClient] = useState<Pick<Client, 'id' | 'name' | 'phone'> | null>(null);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Client[]>([]);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [serviceId, setServiceId] = useState<number>(appt?.service_id ?? services.find((s) => s.active)?.id ?? 0);
  const [date, setDate] = useState(appt?.date ?? defaultDate ?? today);
  const [time, setTime] = useState(appt?.start_time ?? '');
  const [slots, setSlots] = useState<{ slots: string[]; suggested: string[] } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  // Busca de clientes já cadastradas
  useEffect(() => {
    if (editing || client || query.trim().length < 2) { setSuggestions([]); return; }
    const t = setTimeout(() => {
      api<Client[]>(`/api/admin/clients?q=${encodeURIComponent(query.trim())}`).then((r) => setSuggestions(r.slice(0, 6))).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [query, client, editing]);

  // Horários livres do dia para o serviço
  useEffect(() => {
    if (!serviceId || !date) return;
    setSlots(null);
    const ex = appt ? `&exclude_id=${appt.id}` : '';
    api<{ slots: string[]; suggested: string[] }>(`/api/admin/appointments/slots?date=${date}&service_id=${serviceId}${ex}`)
      .then(setSlots).catch(() => setSlots({ slots: [], suggested: [] }));
  }, [serviceId, date, appt]);

  const svc = services.find((s) => s.id === serviceId);
  const options = services.filter((s) => s.active || s.id === appt?.service_id);
  const others = slots ? slots.slots.filter((s) => !slots.suggested.includes(s)) : [];

  async function save(force = false) {
    if (!editing && !client) {
      if (newName.trim().length < 2) return toast('Informe o nome da cliente.', 'error');
      if (!isValidPhone(newPhone)) return toast('Informe o WhatsApp com DDD.', 'error');
    }
    if (!serviceId) return toast('Escolha o serviço.', 'error');
    if (!time) return toast('Escolha o horário.', 'error');
    setBusy(true);
    try {
      let saved: Appointment;
      if (editing) {
        saved = await api<Appointment>(`/api/admin/appointments/${appt!.id}`, {
          method: 'PATCH', body: { service_id: serviceId, date, start_time: time, force },
        });
      } else {
        saved = await api<Appointment>('/api/admin/appointments', {
          body: {
            client_id: client?.id, client_name: newName.trim(), client_phone: newPhone,
            service_id: serviceId, date, start_time: time, notes, force,
          },
        });
        toast('Agendamento criado');
      }
      bumpData();
      const moved = editing && (saved.date !== appt!.date || saved.start_time !== appt!.start_time);
      onSaved?.(saved, moved);
      if (!onSaved) onClose();
    } catch (e) {
      if (e instanceof ApiError && e.data.can_force) {
        setBusy(false);
        if (await confirmDialog('Atenção', { text: `${e.message} Salvar mesmo assim?`, ok: 'Salvar mesmo assim' })) return save(true);
        return;
      }
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={editing ? 'Remarcar / editar' : 'Novo agendamento'}
      onClose={onClose}
      footer={(
        <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => save()}>
          {busy ? 'Salvando…' : editing ? 'Salvar alterações' : 'Agendar (já confirmado)'}
        </button>
      )}
    >
      {editing ? (
        <p className="form-client"><strong>{appt!.client_name}</strong> · {fmtPhone(appt!.client_phone)}</p>
      ) : client ? (
        <div className="picked-client">
          <div><strong>{client.name}</strong><span>{fmtPhone(client.phone)}</span></div>
          <button type="button" className="link-btn" onClick={() => { setClient(null); setQuery(''); }}>Trocar</button>
        </div>
      ) : (
        <>
          <label className="field">
            <span>Cliente</span>
            <input value={query} onChange={(e) => { setQuery(e.target.value); setNewName(e.target.value); }} placeholder="Buscar por nome ou telefone" autoComplete="off" />
          </label>
          {suggestions.length > 0 && (
            <ul className="suggestions">
              {suggestions.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setClient(c)}><strong>{c.name}</strong><span>{fmtPhone(c.phone)}</span></button>
                </li>
              ))}
            </ul>
          )}
          <p className="hint">Cliente nova? Confira o nome acima e informe o WhatsApp:</p>
          <label className="field">
            <span>WhatsApp da cliente nova</span>
            <input value={newPhone} onChange={(e) => setNewPhone(maskPhone(e.target.value))} inputMode="tel" placeholder="(18) 99999-9999" />
          </label>
        </>
      )}

      <label className="field">
        <span>Serviço</span>
        <select value={serviceId} onChange={(e) => { setServiceId(Number(e.target.value)); setTime(editing ? time : ''); }}>
          {options.map((s) => (
            <option key={s.id} value={s.id}>{s.name} — {fmtMoney(s.price_cents)} · {fmtDuration(s.duration_min)}</option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Data</span>
        <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setTime(''); }} />
      </label>

      <div className="field">
        <span>Horário {svc && <small>({fmtDuration(svc.duration_min)})</small>}</span>
        {!slots && <p className="hint">Buscando horários…</p>}
        {slots && slots.slots.length === 0 && <p className="hint">Nenhum horário livre nesse dia. Você pode digitar um horário abaixo.</p>}
        {slots && slots.suggested.length > 0 && (
          <div className="chip-row">
            {slots.suggested.map((s) => (
              <button key={s} type="button" className={`chip${time === s ? ' is-selected' : ''}`} onClick={() => setTime(s)}>{s}</button>
            ))}
          </div>
        )}
        {others.length > 0 && (
          showAll ? (
            <div className="chip-row muted-chips">
              {others.map((s) => (
                <button key={s} type="button" className={`chip${time === s ? ' is-selected' : ''}`} onClick={() => setTime(s)}>{s}</button>
              ))}
            </div>
          ) : (
            <button type="button" className="link-btn" onClick={() => setShowAll(true)}>Ver outros horários livres ({others.length})</button>
          )
        )}
        <label className="inline-field">
          <span>Ou digite:</span>
          <input type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>

      {!editing && (
        <label className="field">
          <span>Observações</span>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
        </label>
      )}
    </Sheet>
  );
}
