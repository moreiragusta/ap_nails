import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { firstName, fmtDateBR, fmtDayMonth, fmtPhone } from '../../../shared/format';
import { daysBetween } from '../../../shared/time';
import { type Appointment, type Client } from '../../../shared/types';
import { api, errorMessage } from '../../lib/api';
import { maskPhone, waLink } from '../../lib/phone';
import { useApptActions } from '../actions';
import { useAdmin } from '../context';
import { Avatar, bumpData, Empty, Icon, Loading, Money, PageHead, SecHead, Sheet, StatusBadge, toast, useDataVersion } from '../ui';

export default function Clients() {
  const { settings, today } = useAdmin();
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

  const sub = (c: Client) => {
    if (c.next_visit) return `Volta ${c.next_visit === today ? 'hoje' : `em ${fmtDayMonth(c.next_visit)}`}`;
    if (c.last_visit) {
      const d = daysBetween(c.last_visit, today);
      return `${c.visits} ${c.visits === 1 ? 'visita' : 'visitas'} · última há ${d === 0 ? 'hoje' : `${d} ${d === 1 ? 'dia' : 'dias'}`}`.replace('há hoje', 'hoje');
    }
    return 'Ainda sem atendimento';
  };

  return (
    <div className="page">
      <PageHead title="Clientes" eyebrow={list ? `${list.length} ${filter === 'missing' ? 'para chamar de volta' : list.length === 1 ? 'cliente' : 'clientes'}` : ' '} />
      <label className="search">
        <Icon name="search" size={20} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou telefone" type="search" />
      </label>
      <div className="seg">
        <button type="button" className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>Todas</button>
        <button type="button" className={filter === 'missing' ? 'is-active' : ''} onClick={() => setFilter('missing')}>Sumidas</button>
      </div>
      {filter === 'missing' && <p className="hint">Não vêm há mais de {settings.missing_after_days} dias e não têm horário marcado. Um “oi” pelo WhatsApp costuma trazer de volta.</p>}

      {list === null ? <Loading /> : list.length === 0 ? (
        <Empty icon="users"
          title={q ? 'Ninguém encontrado' : filter === 'missing' ? 'Ninguém sumido' : 'Nenhuma cliente ainda'}
          text={!q && filter === 'all' ? 'Cada cliente entra aqui sozinha no primeiro agendamento.' : undefined} />
      ) : (
        <div className="rows">
          {list.map((c) => (
            <div key={c.id} className="row-item" role="button" tabIndex={0} onClick={() => open(c.id)} onKeyDown={(e) => e.key === 'Enter' && open(c.id)}>
              <Avatar name={c.name} />
              <span className="grow"><span className="row-title name">{c.name}</span><small>{sub(c)}</small></span>
              {filter === 'missing' ? (
                <a className="pill-btn" target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                  href={waLink(c.phone, `Oi, ${firstName(c.name)}! Tudo bem? Faz um tempinho que você não vem 💅 Quer que eu reserve um horário pra você? ${location.origin}`)}>
                  <Icon name="whatsapp" size={15} className="wa-glyph" /> Chamar
                </a>
              ) : <Icon name="right" size={18} className="chev" />}
            </div>
          ))}
        </div>
      )}

      {openId && <ClientSheet id={openId} onClose={() => open(null)} />}
    </div>
  );
}

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

  async function save(msg = 'Ficha atualizada') {
    try {
      await api(`/api/admin/clients/${id}`, { method: 'PUT', body: form });
      toast(msg);
      setEditing(false);
      bumpData();
    } catch (e) { toast(errorMessage(e), 'error'); }
  }

  if (!c) return <Sheet onClose={onClose}><Loading /></Sheet>;
  const since = c.last_visit ? daysBetween(c.last_visit, today) : null;

  if (editing) {
    return (
      <Sheet title="Editar ficha" onClose={() => setEditing(false)}
        footer={<button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => save()}>Salvar</button>}>
        <label className="field"><span>Nome</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="field"><span>WhatsApp</span><input value={form.phone} inputMode="tel" onChange={(e) => setForm({ ...form, phone: maskPhone(e.target.value) })} /></label>
        <label className="field"><span>Observações</span><textarea rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Preferências, alergias, cuidados" /></label>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose}>
      <div className="who">
        <Avatar name={c.name} size="lg" />
        <div className="who-text">
          <h2>{c.name}</h2>
          <small className="num">{fmtPhone(c.phone)}</small>
        </div>
        <a className="round-btn wa" href={waLink(c.phone)} target="_blank" rel="noreferrer" aria-label="Conversar no WhatsApp"><Icon name="whatsapp" size={21} /></a>
        <a className="round-btn" href={`tel:+${c.phone}`} aria-label="Ligar"><Icon name="phone" size={19} /></a>
      </div>

      <div className="stats surface">
        <div><span>Visitas</span><b>{c.visits}</b></div>
        <div><span>Total</span><Money cents={c.total_cents} /></div>
        <div><span>Última</span><b>{since === null ? '–' : since === 0 ? 'hoje' : `${since}d`}</b></div>
      </div>

      {c.next_visit && <p className="callout soft"><Icon name="calendar" size={18} /> Próximo horário em {fmtDateBR(c.next_visit)}</p>}

      <button type="button" className="note-card surface" onClick={() => setEditing(true)}>
        <Icon name="pencil" size={16} />
        {c.notes ? <span><b>{c.notes}</b></span> : <span>Adicionar observação (preferências, alergias…)</span>}
      </button>

      <SecHead title="Histórico" action={<button type="button" className="link" onClick={() => setEditing(true)}>Editar ficha</button>} />
      {c.history.length === 0 ? <p className="hint">Nenhum agendamento ainda.</p> : (
        <div className="rows">
          {c.history.map((a) => (
            <button key={a.id} type="button" className="row-item" onClick={() => act.open(a)}>
              <span className="grow">
                <span className="row-title">{a.service_name}</span>
                <small className="num">{fmtDateBR(a.date)} · {a.start_time}</small>
              </span>
              <span className="row-end"><Money cents={a.price_cents} /><small><StatusBadge status={a.status} /></small></span>
            </button>
          ))}
        </div>
      )}
      <p className="facts">Cliente desde {new Date(c.created_at).toLocaleDateString('pt-BR')}</p>
    </Sheet>
  );
}
