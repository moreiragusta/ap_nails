import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { fmtDateBR, TEMPLATE_VARS } from '../../../shared/format';
import type { DateException, ExceptionKind, Settings, WeeklyHour } from '../../../shared/types';
import { api, errorMessage } from '../../lib/api';
import { maskPhone } from '../../lib/phone';
import { enablePush, pushState, type PushState } from '../../lib/push';
import { useAdmin, whatsappFor } from '../context';
import { bumpData, confirmDialog, Icon, Sheet, toast } from '../ui';

const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export default function SettingsPage() {
  const { settings, setSettings } = useAdmin();
  const location = useLocation();

  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
  }, [location.hash]);

  async function save(patch: Partial<Settings>, msg = 'Salvo') {
    try {
      const s = await api<Settings>('/api/admin/settings', { method: 'PUT', body: patch });
      setSettings(s);
      bumpData();
      toast(msg);
      return true;
    } catch (e) {
      toast(errorMessage(e), 'error');
      return false;
    }
  }

  return (
    <div className="settings">
      <Business settings={settings} save={save} />
      <Hours />
      <Exceptions />
      <Rules settings={settings} save={save} />
      <Messages settings={settings} save={save} />
      <Notifications settings={settings} save={save} />
      <Others settings={settings} save={save} />
      <Security />
    </div>
  );
}

type SaveFn = (patch: Partial<Settings>, msg?: string) => Promise<boolean>;

function Section({ id, icon, title, children, defaultOpen = false }: { id?: string; icon: Parameters<typeof Icon>[0]['name']; title: string; children: ReactNode; defaultOpen?: boolean }) {
  const location = useLocation();
  return (
    <details className="set-section" id={id} open={defaultOpen || (!!id && location.hash === `#${id}`)}>
      <summary><Icon name={icon} size={20} /> {title}</summary>
      <div className="set-body">{children}</div>
    </details>
  );
}

// ------------------------------------------------------------ negócio

function Business({ settings, save }: { settings: Settings; save: SaveFn }) {
  const [f, setF] = useState({
    business_name: settings.business_name, address: settings.address, maps_url: settings.maps_url,
    whatsapp: maskPhone(settings.whatsapp), instagram: settings.instagram,
  });
  const site = location.origin;
  return (
    <Section icon="sparkle" title="Seu negócio" defaultOpen>
      <div className="share-box">
        <p>Link da sua página de agendamento:</p>
        <strong>{site.replace(/^https?:\/\//, '')}</strong>
        <div className="row-buttons">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => navigator.clipboard?.writeText(site).then(() => toast('Link copiado'))}>
            <Icon name="link" size={18} /> Copiar
          </button>
          <a className="btn btn-outline btn-sm" href="/" target="_blank" rel="noreferrer">Abrir</a>
        </div>
      </div>
      <label className="field"><span>Nome do negócio</span><input value={f.business_name} onChange={(e) => setF({ ...f, business_name: e.target.value })} /></label>
      <label className="field"><span>Endereço do atendimento</span><input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Rua, número, bairro, cidade" /></label>
      <label className="field"><span>Link do Google Maps (opcional)</span><input value={f.maps_url} onChange={(e) => setF({ ...f, maps_url: e.target.value })} placeholder="https://maps.app.goo.gl/…" /></label>
      <div className="two-cols">
        <label className="field"><span>Seu WhatsApp</span><input value={f.whatsapp} inputMode="tel" onChange={(e) => setF({ ...f, whatsapp: maskPhone(e.target.value) })} /></label>
        <label className="field"><span>Instagram</span><input value={f.instagram} onChange={(e) => setF({ ...f, instagram: e.target.value })} placeholder="apnails.pp" /></label>
      </div>
      <p className="hint">O endereço aparece no site (com mapa) e no lembrete enviado às clientes.</p>
      <button type="button" className="btn btn-primary btn-block" onClick={() => save(f)}>Salvar</button>
    </Section>
  );
}

// ------------------------------------------------------------ horários

function Hours() {
  const [rows, setRows] = useState<WeeklyHour[] | null>(null);
  useEffect(() => { api<WeeklyHour[]>('/api/admin/settings/hours').then(setRows).catch(() => {}); }, []);
  const set = (weekday: number, patch: Partial<WeeklyHour>) => setRows((r) => r!.map((x) => (x.weekday === weekday ? { ...x, ...patch } : x)));

  async function save() {
    try {
      setRows(await api<WeeklyHour[]>('/api/admin/settings/hours', { method: 'PUT', body: rows! }));
      bumpData();
      toast('Horários salvos');
    } catch (e) { toast(errorMessage(e), 'error'); }
  }

  return (
    <Section icon="clock" title="Horários de atendimento">
      <p className="hint">Sua semana padrão. Para um dia específico (folga, horário diferente), use “Folgas e exceções”.</p>
      {rows && (
        <div className="hours">
          {DAY_ORDER.map((d) => {
            const r = rows.find((x) => x.weekday === d)!;
            return (
              <div key={d} className={`hour-row${r.open ? '' : ' is-closed'}`}>
                <label className="switch" aria-label={`${DAY_NAMES[d]} aberto`}>
                  <input type="checkbox" checked={r.open} onChange={(e) => set(d, { open: e.target.checked })} />
                  <span />
                </label>
                <strong>{DAY_NAMES[d]}</strong>
                {r.open ? (
                  <span className="hour-times">
                    <input type="time" step={900} value={r.start_time} onChange={(e) => set(d, { start_time: e.target.value })} />
                    <span>às</span>
                    <input type="time" step={900} value={r.end_time} onChange={(e) => set(d, { end_time: e.target.value })} />
                  </span>
                ) : <span className="hour-closed">Fechado</span>}
              </div>
            );
          })}
        </div>
      )}
      <button type="button" className="btn btn-primary btn-block" onClick={save}>Salvar horários</button>
    </Section>
  );
}

// ------------------------------------------------------------ exceções

const KIND_LABEL: Record<ExceptionKind, string> = { closed: 'Fechado', block: 'Horário bloqueado', special: 'Horário especial' };

function Exceptions() {
  const [list, setList] = useState<DateException[] | null>(null);
  const [adding, setAdding] = useState(false);
  const load = () => api<DateException[]>('/api/admin/settings/exceptions').then(setList).catch(() => {});
  useEffect(() => { load(); }, []);

  async function remove(x: DateException) {
    if (!(await confirmDialog('Remover esta exceção?', { ok: 'Remover', danger: true }))) return;
    await api(`/api/admin/settings/exceptions/${x.id}`, { method: 'DELETE' });
    bumpData();
    load();
  }

  return (
    <Section id="excecoes" icon="calendar" title="Folgas e exceções">
      <p className="hint">Feche dias (folga, feriado, viagem), bloqueie um horário ou abra um horário diferente numa data específica.</p>
      {list && list.length === 0 && <p className="hint"><em>Nenhuma exceção futura.</em></p>}
      <ul className="exc-list">
        {list?.map((x) => (
          <li key={x.id}>
            <div>
              <strong>{x.date_from === x.date_to ? fmtDateBR(x.date_from) : `${fmtDateBR(x.date_from)} a ${fmtDateBR(x.date_to)}`}</strong>
              <span>{KIND_LABEL[x.kind]}{x.start_time ? ` · ${x.start_time}–${x.end_time}` : ''}{x.reason ? ` · ${x.reason}` : ''}</span>
            </div>
            <button type="button" className="icon-btn sm" onClick={() => remove(x)} aria-label="Remover"><Icon name="trash" size={18} /></button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-outline btn-block" onClick={() => setAdding(true)}><Icon name="plus" size={18} /> Adicionar</button>
      {adding && <ExceptionForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </Section>
  );
}

function ExceptionForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { today } = useAdmin();
  const [kind, setKind] = useState<ExceptionKind>('closed');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [start, setStart] = useState('18:00');
  const [end, setEnd] = useState('20:00');
  const [reason, setReason] = useState('');

  async function save() {
    try {
      const r = await api<{ affected: number }>('/api/admin/settings/exceptions', {
        body: { kind, date_from: from, date_to: kind === 'closed' ? to : from, start_time: start, end_time: end, reason },
      });
      bumpData();
      if (r.affected > 0 && kind !== 'special') {
        toast(`Atenção: já existem ${r.affected} agendamento(s) nesse período. Avise as clientes.`, 'error');
      } else toast('Exceção salva');
      onSaved();
    } catch (e) { toast(errorMessage(e), 'error'); }
  }

  return (
    <Sheet title="Nova exceção" onClose={onClose} footer={<button type="button" className="btn btn-primary btn-block" onClick={save}>Salvar</button>}>
      <div className="seg vertical">
        <button type="button" className={kind === 'closed' ? 'is-active' : ''} onClick={() => setKind('closed')}>Fechar dia(s) inteiro(s)</button>
        <button type="button" className={kind === 'block' ? 'is-active' : ''} onClick={() => setKind('block')}>Bloquear um horário</button>
        <button type="button" className={kind === 'special' ? 'is-active' : ''} onClick={() => setKind('special')}>Horário especial no dia</button>
      </div>
      <div className="two-cols">
        <label className="field"><span>{kind === 'closed' ? 'De' : 'Data'}</span><input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} /></label>
        {kind === 'closed' && <label className="field"><span>Até</span><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>}
      </div>
      {kind !== 'closed' && (
        <div className="two-cols">
          <label className="field"><span>{kind === 'special' ? 'Abre às' : 'Das'}</span><input type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="field"><span>{kind === 'special' ? 'Fecha às' : 'Até'}</span><input type="time" step={900} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
      )}
      {kind === 'special' && <p className="hint">Nesse dia vale este horário no lugar do horário padrão (serve também para abrir um dia que normalmente é fechado).</p>}
      <label className="field"><span>Motivo (opcional, só você vê)</span><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: feriado, curso, médico" /></label>
    </Sheet>
  );
}

// ------------------------------------------------------------ regras

const ADVANCE = [0, 30, 60, 120, 180, 360, 720, 1440];
const advLabel = (m: number) => (m === 0 ? 'Sem antecedência' : m < 60 ? `${m} minutos` : m === 1440 ? '1 dia' : `${m / 60} ${m === 60 ? 'hora' : 'horas'}`);

function Rules({ settings, save }: { settings: Settings; save: SaveFn }) {
  const [f, setF] = useState({
    booking_mode: settings.booking_mode, slot_step_min: settings.slot_step_min, buffer_min: settings.buffer_min,
    min_advance_min: settings.min_advance_min, window_days: settings.window_days,
  });
  return (
    <Section icon="settings" title="Regras de agendamento">
      <div className="field">
        <span>Como oferecer os horários no site</span>
        <label className="radio-card">
          <input type="radio" checked={f.booking_mode === 'blocks'} onChange={() => setF({ ...f, booking_mode: 'blocks' })} />
          <span><strong>Em blocos (recomendado)</strong><small>Um atendimento logo após o outro, sem sobrar buracos na agenda.</small></span>
        </label>
        <label className="radio-card">
          <input type="radio" checked={f.booking_mode === 'free'} onChange={() => setF({ ...f, booking_mode: 'free' })} />
          <span><strong>Livre</strong><small>Horários a cada {f.slot_step_min} minutos; a cliente escolhe qualquer um que caiba.</small></span>
        </label>
      </div>
      {f.booking_mode === 'free' && (
        <label className="field"><span>Intervalo entre horários</span>
          <select value={f.slot_step_min} onChange={(e) => setF({ ...f, slot_step_min: Number(e.target.value) })}>
            {[15, 30, 60].map((m) => <option key={m} value={m}>{m} minutos</option>)}
          </select>
        </label>
      )}
      <label className="field"><span>Pausa entre atendimentos</span>
        <select value={f.buffer_min} onChange={(e) => setF({ ...f, buffer_min: Number(e.target.value) })}>
          {[0, 10, 15, 20, 30].map((m) => <option key={m} value={m}>{m === 0 ? 'Sem pausa' : `${m} minutos`}</option>)}
        </select>
      </label>
      <label className="field"><span>Antecedência mínima para agendar</span>
        <select value={f.min_advance_min} onChange={(e) => setF({ ...f, min_advance_min: Number(e.target.value) })}>
          {ADVANCE.map((m) => <option key={m} value={m}>{advLabel(m)}</option>)}
        </select>
      </label>
      <label className="field"><span>Até quantos dias à frente as clientes podem agendar</span>
        <select value={f.window_days} onChange={(e) => setF({ ...f, window_days: Number(e.target.value) })}>
          {[15, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{d} dias</option>)}
        </select>
      </label>
      <button type="button" className="btn btn-primary btn-block" onClick={() => save(f, 'Regras salvas')}>Salvar regras</button>
    </Section>
  );
}

// ------------------------------------------------------------ mensagens

function Messages({ settings, save }: { settings: Settings; save: SaveFn }) {
  const { today } = useAdmin();
  const [f, setF] = useState({ tpl_confirm: settings.tpl_confirm, tpl_reminder: settings.tpl_reminder, tpl_reschedule: settings.tpl_reschedule });
  const [preview, setPreview] = useState<string | null>(null);
  const refs = { tpl_confirm: useRef<HTMLTextAreaElement>(null), tpl_reminder: useRef<HTMLTextAreaElement>(null), tpl_reschedule: useRef<HTMLTextAreaElement>(null) };

  const insert = (k: keyof typeof f, v: string) => {
    const el = refs[k].current;
    const pos = el?.selectionStart ?? f[k].length;
    setF({ ...f, [k]: `${f[k].slice(0, pos)}{${v}}${f[k].slice(pos)}` });
  };

  const sample = {
    id: 0, client_id: 0, client_name: 'Juliana Souza', client_phone: '5518999999999', service_id: 0, service_name: 'Esmaltação em gel',
    price_cents: 6000, duration_min: 120, date: today, start_time: '18:00', end_time: '20:00', status: 'pending' as const, source: 'site' as const,
    notes: '', confirmation_sent_at: null, confirmed_at: null, alert_sent_at: null, reminder_sent_at: null, completed_at: null,
    cancelled_at: null, expired_at: null, payment_method: null, created_at: '',
  };
  const showPreview = (k: keyof typeof f) => {
    const url = whatsappFor(k === 'tpl_confirm' ? 'confirm' : k === 'tpl_reminder' ? 'reminder' : 'reschedule', sample, { ...settings, ...f }, today);
    setPreview(decodeURIComponent(url.split('?text=')[1] ?? ''));
  };

  const block = (k: keyof typeof f, label: string) => (
    <div className="field">
      <span>{label}</span>
      <textarea ref={refs[k]} rows={8} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      <div className="chip-row vars">
        {TEMPLATE_VARS.map((v) => <button key={v.key} type="button" className="chip chip-sm" title={v.hint} onClick={() => insert(k, v.key)}>{`{${v.key}}`}</button>)}
      </div>
      <button type="button" className="link-btn" onClick={() => showPreview(k)}>Ver como fica</button>
    </div>
  );

  return (
    <Section icon="whatsapp" title="Mensagens do WhatsApp">
      <p className="hint">Toque numa variável para inseri-la. Ela é trocada pelos dados da cliente na hora de enviar.</p>
      {block('tpl_confirm', 'Confirmação de agendamento')}
      {block('tpl_reminder', 'Lembrete')}
      {block('tpl_reschedule', 'Aviso de remarcação')}
      <button type="button" className="btn btn-primary btn-block" onClick={() => save(f, 'Mensagens salvas')}>Salvar mensagens</button>
      {preview !== null && (
        <Sheet title="Prévia da mensagem" onClose={() => setPreview(null)}>
          <div className="wa-preview"><p>{preview}</p></div>
        </Sheet>
      )}
    </Section>
  );
}

// ------------------------------------------------------------ notificações e lembretes

function Notifications({ settings, save }: { settings: Settings; save: SaveFn }) {
  const [state, setState] = useState<PushState | null>(null);
  const [f, setF] = useState({ reminder_when: settings.reminder_when, reminder_notice_time: settings.reminder_notice_time });
  useEffect(() => { pushState().then(setState); }, []);

  async function enable() {
    try {
      const s = await enablePush();
      setState(s);
      if (s === 'on') toast('Notificações ativadas');
      if (s === 'denied') toast('Permissão negada. Libere nas configurações do navegador.', 'error');
      if (s === 'no-key') toast('Notificações ainda não configuradas no servidor (NUKKI).', 'error');
    } catch (e) { toast(errorMessage(e), 'error'); }
  }

  return (
    <Section id="notificacoes" icon="bell" title="Notificações e lembretes">
      <div className="push-status">
        {state === 'on' && <p><Icon name="check" size={18} /> Notificações ativas neste celular.</p>}
        {state === 'off' && <p>Ative para ser avisada a cada novo agendamento, confirmação pendente e horário liberado.</p>}
        {state === 'denied' && <p>As notificações estão bloqueadas. Libere em Configurações do Chrome → Notificações.</p>}
        {state === 'unsupported' && <p>Este navegador não suporta notificações. No Android, use o Chrome e instale o app na tela inicial.</p>}
        {state === 'no-key' && <p>Notificações ainda não configuradas no servidor.</p>}
        {state !== 'on' && state !== 'unsupported' && <button type="button" className="btn btn-primary btn-block" onClick={enable}>Ativar notificações</button>}
        {state === 'on' && (
          <button type="button" className="btn btn-outline btn-block" onClick={() => api<{ sent: number }>('/api/admin/settings/push/test', { body: {} }).then((r) => toast(r.sent ? 'Notificação de teste enviada' : 'Nenhum aparelho recebeu', r.sent ? 'ok' : 'error'))}>
            Enviar notificação de teste
          </button>
        )}
      </div>
      <div className="field">
        <span>Quando lembrar as clientes</span>
        <div className="seg">
          <button type="button" className={f.reminder_when === 'same_day' ? 'is-active' : ''} onClick={() => setF({ ...f, reminder_when: 'same_day' })}>No dia</button>
          <button type="button" className={f.reminder_when === 'day_before' ? 'is-active' : ''} onClick={() => setF({ ...f, reminder_when: 'day_before' })}>Na véspera</button>
        </div>
      </div>
      <label className="field"><span>Horário do aviso “lembretes para enviar”</span>
        <input type="time" step={900} value={f.reminder_notice_time} onChange={(e) => setF({ ...f, reminder_notice_time: e.target.value })} />
      </label>
      <button type="button" className="btn btn-primary btn-block" onClick={() => save(f, 'Lembretes salvos')}>Salvar</button>
    </Section>
  );
}

// ------------------------------------------------------------ outros

function Others({ settings, save }: { settings: Settings; save: SaveFn }) {
  const [days, setDays] = useState(settings.missing_after_days);
  const [cats, setCats] = useState(settings.expense_categories);
  const [newCat, setNewCat] = useState('');
  return (
    <Section icon="users" title="Clientes e despesas">
      <label className="field"><span>Considerar “sumida” depois de</span>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[30, 45, 60, 90].map((d) => <option key={d} value={d}>{d} dias sem vir</option>)}
        </select>
      </label>
      <div className="field">
        <span>Categorias de despesas</span>
        <div className="chip-row">
          {cats.map((c) => (
            <span key={c} className="chip chip-removable">{c}
              <button type="button" aria-label={`Remover ${c}`} onClick={() => setCats(cats.filter((x) => x !== c))}>×</button>
            </span>
          ))}
        </div>
        <div className="inline-add">
          <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Nova categoria" />
          <button type="button" className="btn btn-outline btn-sm" onClick={() => { if (newCat.trim()) { setCats([...cats, newCat.trim()]); setNewCat(''); } }}>Adicionar</button>
        </div>
      </div>
      <button type="button" className="btn btn-primary btn-block" onClick={() => save({ missing_after_days: days, expense_categories: cats })}>Salvar</button>
    </Section>
  );
}

// ------------------------------------------------------------ segurança

function Security() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');

  async function change() {
    try {
      await api('/api/admin/settings/password', { body: { current, next } });
      toast('Senha alterada');
      setCurrent(''); setNext('');
    } catch (e) { toast(errorMessage(e), 'error'); }
  }

  async function logout() {
    await api('/api/admin/logout', { body: {} }).catch(() => {});
    location.href = '/admin';
  }

  return (
    <Section icon="logout" title="Segurança">
      <label className="field"><span>Senha atual</span><input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></label>
      <label className="field"><span>Nova senha (mín. 6 caracteres)</span><input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></label>
      <button type="button" className="btn btn-primary btn-block" disabled={!current || next.length < 6} onClick={change}>Trocar senha</button>
      <button type="button" className="btn btn-ghost btn-block" onClick={logout}><Icon name="logout" size={18} /> Sair deste celular</button>
    </Section>
  );
}
