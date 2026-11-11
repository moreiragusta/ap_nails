import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { firstName, fmtDateBR, fmtMoney, fmtPhone } from '../../../shared/format';
import { daysBetween } from '../../../shared/time';
import { STATUS_LABEL, type Appointment, type Client } from '../../../shared/types';
import { api, errorMessage } from '../../lib/api';
import { maskPhone, waLink } from '../../lib/phone';
import { useApptActions } from '../actions';
import { useAdmin } from '../context';
import { bumpData, Empty, Icon, Loading, Sheet, toast, useDataVersion } from '../ui';

export default function Clients() {
  const { settings } = useAdmin();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'missing'>('all');
  const [list, setList] = useState<Client[] | null>(null);
  const version = useDataVersion();
  const openId = Number(params.get('client')) || null;

  useEffect(() => {
    const t = setTimeout(() => {
      const qs = new URLSearchParams();
      if (q.trim()) qs.set('q', q.trim());
      if (filter === 'missing') qs.set('filter', 'missing');
      api<Client[]>(`/api/admin/clients?${qs}`).then(setList).catch(() => setList([]));
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, filter, version]);

  const open = (id: number | null) => {
    if (id) params.set('client', String(id)); else params.delete('client');
    setParams(params);
  };

  return (
    <div>
      <label className="search">
        <Icon name="search" size={20} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou telefone" type="search" />
      </label>
      <div className="seg">
        <button type="button" className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>Todas</button>
        <button type="button" className={filter === 'missing' ? 'is-active' : ''} onClick={() => setFilter('missing')}>
          Sumidas ({settings.missing_after_days}+ dias)
        </button>
      </div>
      {filter === 'missing' && <p className="hint">Clientes que não vêm há mais de {settings.missing_after_days} dias e não têm horário marcado.</p>}

      {list === null ? <Loading /> : list.length === 0 ? (
        <Empty icon="users" title={q ? 'Nenhuma cliente encontrada' : filter === 'missing' ? 'Nenhuma cliente sumida' : 'Nenhuma cliente ainda'}
          text={!q && filter === 'all' ? 'As clientes são cadastradas automaticamente no primeiro agendamento.' : undefined} />
      ) : (
        <ul className="list">
          {list.map((c) => (
            <li key={c.id}>
              <button type="button" className="list-row" onClick={() => open(c.id)}>
                <span className="avatar">{initials(c.name)}</span>
                <span className="list-main">
                  <strong>{c.name}</strong>
                  <small>{fmtPhone(c.phone)}</small>
                </span>
                <span className="list-side">
                  <small>{c.visits} {c.visits === 1 ? 'visita' : 'visitas'}</small>
                  <small>{c.last_visit ? `última ${fmtDateBR(c.last_visit)}` : c.next_visit ? 'agendada' : 'sem visitas'}</small>
                </span>
              </button>
              {filter === 'missing' && (
                <a className="btn btn-wa btn-sm row-action" target="_blank" rel="noreferrer"
                  href={waLink(c.phone, `Oi, ${firstName(c.name)}! Tudo bem? Faz um tempinho que você não vem fazer as unhas 💅 Que tal agendar um horário? ${location.origin}`)}>
                  <Icon name="whatsapp" size={18} /> Chamar
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {openId && <ClientSheet id={openId} onClose={() => open(null)} />}
    </div>
  );
}

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');

function ClientSheet({ id, onClose }: { id: number; onClose: () => void }) {
  const { today } = useAdmin();
  const act = useApptActions();
  const [c, setC] = useState<(Client & { history: Appointment[] }) | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', notes: '' });
  const [editing, setEditing] = useState(false);
  const version = useDataVersion();

  useEffect(() => {
    api<Client & { history: Appointment[] }>(`/api/admin/clients/${id}`).then((r) => {
      setC(r);
      setForm({ name: r.name, phone: maskPhone(r.phone), notes: r.notes });
    }).catch((e) => { toast(errorMessage(e), 'error'); onClose(); });
  }, [id, version]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    try {
      await api(`/api/admin/clients/${id}`, { method: 'PUT', body: form });
      toast('Cliente atualizada');
      setEditing(false);
      bumpData();
    } catch (e) { toast(errorMessage(e), 'error'); }
  }

  async function saveNotes() {
    if (!c || form.notes === c.notes) return;
    await save();
  }

  if (!c) return <Sheet title="Cliente" onClose={onClose}><Loading /></Sheet>;
  const since = c.last_visit ? daysBetween(c.last_visit, today) : null;

  return (
    <Sheet title={c.name} onClose={onClose}>
      <div className="action-grid">
        <a className="btn btn-wa" href={waLink(c.phone)} target="_blank" rel="noreferrer"><Icon name="whatsapp" size={20} /> Conversar</a>
        <a className="btn btn-outline" href={`tel:+${c.phone}`}><Icon name="phone" size={20} /> Ligar</a>
      </div>

      <div className="stats">
        <div><strong>{c.visits}</strong><span>atendimentos</span></div>
        <div><strong>{fmtMoney(c.total_cents)}</strong><span>total gasto</span></div>
        <div><strong>{since === null ? '–' : since === 0 ? 'hoje' : `${since}d`}</strong><span>desde a última</span></div>
      </div>
      {c.next_visit && <p className="note-box"><Icon name="calendar" size={18} /> Próximo horário: {fmtDateBR(c.next_visit)}</p>}

      {editing ? (
        <div className="card-form">
          <label className="field"><span>Nome</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field"><span>WhatsApp</span><input value={form.phone} inputMode="tel" onChange={(e) => setForm({ ...form, phone: maskPhone(e.target.value) })} /></label>
          <div className="row-buttons">
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={save}>Salvar</button>
          </div>
        </div>
      ) : (
        <dl className="info-list">
          <div><dt>WhatsApp</dt><dd>{fmtPhone(c.phone)}</dd></div>
          <div><dt>Cliente desde</dt><dd>{new Date(c.created_at).toLocaleDateString('pt-BR')}</dd></div>
          <div><dt /><dd><button type="button" className="link-btn" onClick={() => setEditing(true)}>Editar nome ou telefone</button></dd></div>
        </dl>
      )}

      <label className="field">
        <span>Observações (preferências, alergias…)</span>
        <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} onBlur={saveNotes} />
      </label>

      <p className="section-label">Histórico</p>
      {c.history.length === 0 ? <p className="hint">Nenhum agendamento.</p> : (
        <ul className="history">
          {c.history.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => act.open(a)}>
                <span className="h-date">{fmtDateBR(a.date)}<small>{a.start_time}</small></span>
                <span className="h-main">{a.service_name}<small>{STATUS_LABEL[a.status]}</small></span>
                <span className="h-value">{fmtMoney(a.price_cents)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
