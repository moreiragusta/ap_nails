import { useEffect, useState } from 'react';
import { fmtDateLong, fmtDuration, fmtPhone } from '../../shared/format';
import type { Appointment, Client } from '../../shared/types';
import { api, ApiError, errorMessage } from '../lib/api';
import { isValidPhone, maskPhone } from '../lib/phone';
import { useAdmin } from './context';
import { Avatar, bumpData, confirmDialog, Icon, Money, Sheet, toast } from './ui';

/** Novo agendamento (lançado pela Amanda) ou remarcação de um existente. */
export default function AppointmentForm({ appt, defaultDate, defaultTime, onClose, onSaved }: {
  appt?: Appointment;
  defaultDate?: string;
  defaultTime?: string;
  onClose: () => void;
  onSaved?: (a: Appointment, moved: boolean) => void;
}) {
  const { services, today } = useAdmin();
  const editing = !!appt;
  const [client, setClient] = useState<Pick<Client, 'id' | 'name' | 'phone'> | null>(null);
  const [name, setName] = useState('');
  const [suggestions, setSuggestions] = useState<Client[]>([]);
  const [phone, setPhone] = useState('');
  const [serviceId, setServiceId] = useState<number>(appt?.service_id ?? services.find((s) => s.active)?.id ?? 0);
  const [date, setDate] = useState(appt?.date ?? defaultDate ?? today);
  const [time, setTime] = useState(appt?.start_time ?? defaultTime ?? '');
  const [slots, setSlots] = useState<{ slots: string[]; suggested: string[] } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (editing || client || name.trim().length < 2) { setSuggestions([]); return; }
    const t = setTimeout(() => {
      api<Client[]>(`/api/admin/clients?q=${encodeURIComponent(name.trim())}`).then((r) => setSuggestions(r.slice(0, 5))).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [name, client, editing]);

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
      if (name.trim().length < 2) return toast('Informe o nome da cliente.', 'error');
      if (!isValidPhone(phone)) return toast('Informe o WhatsApp com DDD.', 'error');
    }
    if (!serviceId) return toast('Escolha o serviço.', 'error');
    if (!time) return toast('Escolha o horário.', 'error');
    setBusy(true);
    try {
      let saved: Appointment;
      if (editing) {
        saved = await api<Appointment>(`/api/admin/appointments/${appt!.id}`, { method: 'PATCH', body: { service_id: serviceId, date, start_time: time, force } });
      } else {
        saved = await api<Appointment>('/api/admin/appointments', {
          body: { client_id: client?.id, client_name: name.trim(), client_phone: phone, service_id: serviceId, date, start_time: time, notes, force },
        });
        toast('Agendado e confirmado');
      }
      bumpData();
      const moved = editing && (saved.date !== appt!.date || saved.start_time !== appt!.start_time);
      if (onSaved) onSaved(saved, moved); else onClose();
    } catch (e) {
      if (e instanceof ApiError && e.data.can_force) {
        setBusy(false);
        if (await confirmDialog('Horário fora do combinado', { text: `${e.message} Quer salvar mesmo assim?`, ok: 'Salvar mesmo assim' })) return save(true);
        return;
      }
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={editing ? 'Remarcar' : 'Novo agendamento'}
      onClose={onClose}
      footer={(
        <button type="button" className="btn btn-primary btn-block btn-lg" disabled={busy} onClick={() => save()}>
          {busy ? 'Salvando…' : editing ? 'Salvar novo horário' : 'Agendar'}
        </button>
      )}
    >
      {editing ? (
        <div className="picked surface">
          <Avatar name={appt!.client_name} />
          <div className="grow"><div className="name" style={{ fontSize: 19 }}>{appt!.client_name}</div><small className="muted num">{fmtPhone(appt!.client_phone)}</small></div>
        </div>
      ) : client ? (
        <div className="picked surface">
          <Avatar name={client.name} />
          <div className="grow"><div className="name" style={{ fontSize: 19 }}>{client.name}</div><small className="muted num">{fmtPhone(client.phone)}</small></div>
          <button type="button" className="link" onClick={() => { setClient(null); setName(''); }}>Trocar</button>
        </div>
      ) : (
        <>
          <label className="field">
            <span>Cliente</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome ou telefone" autoComplete="off" />
          </label>
          {suggestions.length > 0 && (
            <div className="rows suggestions">
              {suggestions.map((c) => (
                <button key={c.id} type="button" className="row-item" onClick={() => setClient(c)}>
                  <Avatar name={c.name} />
                  <span className="grow"><span className="row-title">{c.name}</span><small className="num">{fmtPhone(c.phone)}</small></span>
                  <Icon name="right" size={18} className="chev" />
                </button>
              ))}
            </div>
          )}
          <label className="field">
            <span>WhatsApp <small>(cliente nova)</small></span>
            <input value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} inputMode="tel" placeholder="(18) 99999-9999" />
          </label>
        </>
      )}

      <label className="field">
        <span>Serviço</span>
        <select value={serviceId} onChange={(e) => setServiceId(Number(e.target.value))}>
          {options.map((s) => <option key={s.id} value={s.id}>{s.name} · {fmtDuration(s.duration_min)}</option>)}
        </select>
        {svc && <small>Valor <Money cents={svc.price_cents} /></small>}
      </label>

      <label className="field">
        <span>Dia</span>
        <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setTime(''); }} />
        {date && <small>{fmtDateLong(date)}</small>}
      </label>

      <div className="field">
        <span>Horário</span>
        {!slots && <p className="hint">Buscando horários…</p>}
        {slots && slots.slots.length === 0 && <p className="hint">Sem horário livre nesse dia. Você pode digitar um horário abaixo.</p>}
        {slots && slots.suggested.length > 0 && (
          <div className="slot-group">
            <div className="slot-label">Encaixe ideal</div>
            <div className="chips">
              {slots.suggested.map((s) => <button key={s} type="button" className={`chip${time === s ? ' is-selected' : ''}`} onClick={() => setTime(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {others.length > 0 && (showAll ? (
          <div className="slot-group">
            <div className="slot-label">Outros horários livres</div>
            <div className="chips">
              {others.map((s) => <button key={s} type="button" className={`chip soft${time === s ? ' is-selected' : ''}`} onClick={() => setTime(s)}>{s}</button>)}
            </div>
          </div>
        ) : (
          <button type="button" className="link" style={{ alignSelf: 'flex-start', marginTop: 6 }} onClick={() => setShowAll(true)}>Ver outros horários livres</button>
        ))}
        <label className="inline-time">
          <span>Outro horário:</span>
          <input className="input" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>

      {!editing && (
        <label className="field">
          <span>Observação deste atendimento <small>(opcional)</small></span>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      )}
    </Sheet>
  );
}
