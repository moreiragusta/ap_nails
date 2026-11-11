import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { fmtDateBR, TEMPLATE_VARS } from '../../../shared/format';
import type { DateException, ExceptionKind, Settings, WeeklyHour } from '../../../shared/types';
import { api, errorMessage } from '../../lib/api';
import { maskPhone } from '../../lib/phone';
import { enablePush, pushState, type PushState } from '../../lib/push';
import { useAdmin, whatsappFor } from '../context';
import { NewPasswordFields, passwordReady, RecoveryCodeReveal } from '../AuthScreens';
import { bumpData, confirmDialog, Empty, Icon, PageHead, Sheet, toast } from '../ui';

type SaveFn = (patch: Partial<Settings>, msg?: string) => Promise<boolean>;

const TITLES: Record<string, string> = {
  negocio: 'Seu negócio',
  horarios: 'Horários',
  folgas: 'Folgas e exceções',
  regras: 'Regras de agendamento',
  mensagens: 'Mensagens',
  notificacoes: 'Notificações',
  'clientes-despesas': 'Clientes e despesas',
  conta: 'Senha e segurança',
};

/** Uma seção de ajustes por página (aberta a partir da aba Mais). */
export default function SettingsSection() {
  const { section = '' } = useParams();
  const navigate = useNavigate();
  const { settings, setSettings } = useAdmin();

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

  const body = {
    negocio: <Business settings={settings} save={save} />,
    horarios: <Hours />,
    folgas: <Exceptions />,
    regras: <Rules settings={settings} save={save} />,
    mensagens: <Messages settings={settings} save={save} />,
    notificacoes: <Notifications settings={settings} save={save} />,
    'clientes-despesas': <Others settings={settings} save={save} />,
    conta: <Security />,
  }[section];

  return (
    <div className="page">
      <PageHead title={TITLES[section] ?? 'Ajustes'} onBack={() => navigate('/admin/mais')} backLabel="Mais" />
      {body ?? <Empty title="Página não encontrada" />}
    </div>
  );
}

// ------------------------------------------------------------ negócio

function Business({ settings, save }: { settings: Settings; save: SaveFn }) {
  const [f, setF] = useState({
    business_name: settings.business_name, owner_name: settings.owner_name, address: settings.address, maps_url: settings.maps_url,
    whatsapp: maskPhone(settings.whatsapp), instagram: settings.instagram,
  });
  return (
    <>
      <p className="hint">Essas informações aparecem na sua página e nas mensagens para as clientes.</p>
      <div className="two-cols">
        <label className="field"><span>Nome do negócio</span><input value={f.business_name} onChange={(e) => setF({ ...f, business_name: e.target.value })} /></label>
        <label className="field"><span>Seu nome</span><input value={f.owner_name} onChange={(e) => setF({ ...f, owner_name: e.target.value })} /></label>
      </div>
      <label className="field"><span>Endereço do atendimento</span><input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Rua, número, bairro, cidade" /></label>
      <label className="field"><span>Link do Google Maps <small>(opcional)</small></span><input value={f.maps_url} onChange={(e) => setF({ ...f, maps_url: e.target.value })} placeholder="https://maps.app.goo.gl/…" /></label>
      <div className="two-cols">
        <label className="field"><span>Seu WhatsApp</span><input value={f.whatsapp} inputMode="tel" onChange={(e) => setF({ ...f, whatsapp: maskPhone(e.target.value) })} /></label>
        <label className="field"><span>Instagram</span><input value={f.instagram} onChange={(e) => setF({ ...f, instagram: e.target.value })} placeholder="apnails.pp" /></label>
      </div>
      <button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => save(f)}>Salvar</button>
    </>
  );
}

// ------------------------------------------------------------ horários

const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

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
    <>
      <p className="hint">Sua semana padrão. Para mudar só um dia (folga, feriado, horário diferente), use Folgas e exceções.</p>
      {rows && (
        <div className="surface" style={{ padding: '4px 16px', marginBottom: 18 }}>
          {DAY_ORDER.map((d) => {
            const r = rows.find((x) => x.weekday === d)!;
            return (
              <div key={d} className={`hours-row${r.open ? '' : ' is-closed'}`}>
                <label className="switch" aria-label={`${DAY_NAMES[d]} aberto`}>
                  <input type="checkbox" checked={r.open} onChange={(e) => set(d, { open: e.target.checked })} />
                  <span />
                </label>
                <strong>{DAY_NAMES[d]}</strong>
                {r.open ? (
                  <span className="hours-times">
                    <input type="time" step={900} value={r.start_time} onChange={(e) => set(d, { start_time: e.target.value })} />
                    <span>às</span>
                    <input type="time" step={900} value={r.end_time} onChange={(e) => set(d, { end_time: e.target.value })} />
                  </span>
                ) : <span className="hours-closed">Fechado</span>}
              </div>
            );
          })}
        </div>
      )}
      <button type="button" className="btn btn-primary btn-block btn-lg" onClick={save}>Salvar horários</button>
    </>
  );
}

// ------------------------------------------------------------ exceções

const KIND_LABEL: Record<ExceptionKind, string> = { closed: 'Fechado', block: 'Horário bloqueado', special: 'Horário especial' };
const KIND_ICON: Record<ExceptionKind, Parameters<typeof Icon>[0]['name']> = { closed: 'x', block: 'clock', special: 'sparkle' };

function Exceptions() {
  const [list, setList] = useState<DateException[] | null>(null);
  const [adding, setAdding] = useState(false);
  const load = () => api<DateException[]>('/api/admin/settings/exceptions').then(setList).catch(() => {});
  useEffect(() => { load(); }, []);

  async function remove(x: DateException) {
    if (!(await confirmDialog('Remover esta exceção?', { text: 'O dia volta a seguir o horário padrão.', ok: 'Remover', danger: true }))) return;
    await api(`/api/admin/settings/exceptions/${x.id}`, { method: 'DELETE' });
    bumpData();
    load();
  }

  return (
    <>
      <p className="hint">Feche dias (folga, feriado, viagem), bloqueie um trecho do dia ou abra um horário diferente numa data.</p>
      {list && list.length === 0 && <Empty icon="calendar" title="Nenhuma exceção" text="Sua agenda segue o horário padrão." />}
      {list && list.length > 0 && (
        <div className="rows" style={{ marginBottom: 18 }}>
          {list.map((x) => (
            <div key={x.id} className="row-item">
              <span className="menu-icon"><Icon name={KIND_ICON[x.kind]} size={18} /></span>
              <span className="grow">
                <span className="row-title num">{x.date_from === x.date_to ? fmtDateBR(x.date_from) : `${fmtDateBR(x.date_from)} a ${fmtDateBR(x.date_to)}`}</span>
                <small>{KIND_LABEL[x.kind]}{x.start_time ? ` · ${x.start_time}–${x.end_time}` : ''}{x.reason ? ` · ${x.reason}` : ''}</small>
              </span>
              <button type="button" className="icon-btn" onClick={() => remove(x)} aria-label="Remover"><Icon name="trash" size={18} /></button>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => setAdding(true)}><Icon name="plus" size={20} /> Adicionar exceção</button>
      {adding && <ExceptionForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </>
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
      if (r.affected > 0 && kind !== 'special') toast(`Atenção: há ${r.affected} agendamento(s) nesse período. Avise as clientes.`, 'error');
      else toast('Exceção salva');
      onSaved();
    } catch (e) { toast(errorMessage(e), 'error'); }
  }

  return (
    <Sheet title="Nova exceção" onClose={onClose} footer={<button type="button" className="btn btn-primary btn-block btn-lg" onClick={save}>Salvar</button>}>
      <label className="radio-card"><input type="radio" checked={kind === 'closed'} onChange={() => setKind('closed')} /><span><strong>Fechar dia(s)</strong><small>Folga, feriado, viagem</small></span></label>
      <label className="radio-card"><input type="radio" checked={kind === 'block'} onChange={() => setKind('block')} /><span><strong>Bloquear um horário</strong><small>Um compromisso em parte do dia</small></span></label>
      <label className="radio-card"><input type="radio" checked={kind === 'special'} onChange={() => setKind('special')} /><span><strong>Horário especial</strong><small>Abrir um dia fechado ou mudar o horário só nessa data</small></span></label>
      <div className="two-cols" style={{ marginTop: 10 }}>
        <label className="field"><span>{kind === 'closed' ? 'De' : 'Dia'}</span><input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} /></label>
        {kind === 'closed' && <label className="field"><span>Até</span><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>}
      </div>
      {kind !== 'closed' && (
        <div className="two-cols">
          <label className="field"><span>{kind === 'special' ? 'Abre às' : 'Das'}</span><input type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="field"><span>{kind === 'special' ? 'Fecha às' : 'Até'}</span><input type="time" step={900} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
      )}
      <label className="field"><span>Motivo <small>(só você vê)</small></span><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: feriado, curso, médico" /></label>
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
    <>
      <div className="field">
        <span>Como oferecer os horários no site</span>
        <label className="radio-card">
          <input type="radio" checked={f.booking_mode === 'blocks'} onChange={() => setF({ ...f, booking_mode: 'blocks' })} />
          <span><strong>Em blocos <small>· recomendado</small></strong><small>Um atendimento logo após o outro, sem buracos na agenda.</small></span>
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
      <label className="field"><span>Até quantos dias à frente</span>
        <select value={f.window_days} onChange={(e) => setF({ ...f, window_days: Number(e.target.value) })}>
          {[15, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{d} dias</option>)}
        </select>
      </label>
      <button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => save(f, 'Regras salvas')}>Salvar</button>
    </>
  );
}

// ------------------------------------------------------------ mensagens

function Messages({ settings, save }: { settings: Settings; save: SaveFn }) {
  const { today } = useAdmin();
  const [f, setF] = useState({ tpl_confirm: settings.tpl_confirm, tpl_reminder: settings.tpl_reminder, tpl_reschedule: settings.tpl_reschedule });
  const [tab, setTab] = useState<keyof typeof f>('tpl_confirm');
  const [preview, setPreview] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  const insert = (v: string) => {
    const pos = ref.current?.selectionStart ?? f[tab].length;
    setF({ ...f, [tab]: `${f[tab].slice(0, pos)}{${v}}${f[tab].slice(pos)}` });
  };

  const sample = {
    id: 0, client_id: 0, client_name: 'Juliana Souza', client_phone: '5518999999999', service_id: 0, service_name: 'Esmaltação em gel',
    price_cents: 6000, duration_min: 120, date: today, start_time: '18:00', end_time: '20:00', status: 'pending' as const, source: 'site' as const,
    notes: '', confirmation_sent_at: null, confirmed_at: null, alert_sent_at: null, reminder_sent_at: null, completed_at: null,
    cancelled_at: null, expired_at: null, payment_method: null, created_at: '',
  };
  const showPreview = () => {
    const url = whatsappFor(tab === 'tpl_confirm' ? 'confirm' : tab === 'tpl_reminder' ? 'reminder' : 'reschedule', sample, { ...settings, ...f }, today);
    setPreview(decodeURIComponent(url.split('?text=')[1] ?? ''));
  };

  return (
    <>
      <div className="seg">
        <button type="button" className={tab === 'tpl_confirm' ? 'is-active' : ''} onClick={() => setTab('tpl_confirm')}>Confirmação</button>
        <button type="button" className={tab === 'tpl_reminder' ? 'is-active' : ''} onClick={() => setTab('tpl_reminder')}>Lembrete</button>
        <button type="button" className={tab === 'tpl_reschedule' ? 'is-active' : ''} onClick={() => setTab('tpl_reschedule')}>Remarcação</button>
      </div>
      <label className="field">
        <span>Texto da mensagem</span>
        <textarea ref={ref} rows={10} value={f[tab]} onChange={(e) => setF({ ...f, [tab]: e.target.value })} />
      </label>
      <p className="hint" style={{ marginTop: -6 }}>Toque para inserir os dados da cliente:</p>
      <div className="chips vars">
        {TEMPLATE_VARS.map((v) => <button key={v.key} type="button" className="chip chip-sm" title={v.hint} onClick={() => insert(v.key)}>{`{${v.key}}`}</button>)}
      </div>
      <div className="two-cols" style={{ marginTop: 22 }}>
        <button type="button" className="btn btn-outline" onClick={showPreview}>Ver como fica</button>
        <button type="button" className="btn btn-primary" onClick={() => save(f, 'Mensagens salvas')}>Salvar</button>
      </div>
      {preview !== null && (
        <Sheet title="Prévia" onClose={() => setPreview(null)}>
          <div className="wa-preview"><p>{preview}</p></div>
        </Sheet>
      )}
    </>
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
      if (s === 'denied') toast('Permissão negada. Libere nas configurações do Chrome.', 'error');
      if (s === 'no-key') toast('Notificações ainda não configuradas no servidor (NUKKI).', 'error');
    } catch (e) { toast(errorMessage(e), 'error'); }
  }

  const status: Record<PushState, string> = {
    on: 'Ativas neste celular. Você é avisada a cada novo agendamento, confirmação pendente e horário liberado.',
    off: 'Ative para saber na hora quando uma cliente agendar.',
    denied: 'Bloqueadas. Libere em Configurações do Chrome → Notificações.',
    unsupported: 'Este navegador não suporta notificações. No Android, use o Chrome e instale o app na tela inicial.',
    'no-key': 'Ainda não configuradas no servidor.',
  };

  return (
    <>
      <div className="surface" style={{ padding: 16 }}>
        <div className="row-item" style={{ padding: 0 }}>
          <span className="menu-icon"><Icon name="bell" size={19} /></span>
          <span className="grow"><span className="row-title">Notificações</span><small>{state ? status[state] : '…'}</small></span>
        </div>
        {state && state !== 'on' && state !== 'unsupported' && <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 14 }} onClick={enable}>Ativar notificações</button>}
        {state === 'on' && (
          <button type="button" className="btn btn-soft btn-block" style={{ marginTop: 14 }}
            onClick={() => api<{ sent: number }>('/api/admin/settings/push/test', { body: {} }).then((r) => toast(r.sent ? 'Notificação de teste enviada' : 'Nenhum aparelho recebeu', r.sent ? 'ok' : 'error'))}>
            Enviar um teste
          </button>
        )}
      </div>

      <div className="field" style={{ marginTop: 24 }}>
        <span>Quando lembrar as clientes</span>
        <div className="seg" style={{ margin: 0 }}>
          <button type="button" className={f.reminder_when === 'same_day' ? 'is-active' : ''} onClick={() => setF({ ...f, reminder_when: 'same_day' })}>No dia</button>
          <button type="button" className={f.reminder_when === 'day_before' ? 'is-active' : ''} onClick={() => setF({ ...f, reminder_when: 'day_before' })}>Na véspera</button>
        </div>
      </div>
      <label className="field"><span>Avisar você dos lembretes às</span>
        <input type="time" step={900} value={f.reminder_notice_time} onChange={(e) => setF({ ...f, reminder_notice_time: e.target.value })} />
      </label>
      <button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => save(f, 'Lembretes salvos')}>Salvar</button>
    </>
  );
}

// ------------------------------------------------------------ clientes e despesas

function Others({ settings, save }: { settings: Settings; save: SaveFn }) {
  const [days, setDays] = useState(settings.missing_after_days);
  const [cats, setCats] = useState(settings.expense_categories);
  const [newCat, setNewCat] = useState('');
  return (
    <>
      <label className="field"><span>Considerar cliente “sumida” depois de</span>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[30, 45, 60, 90].map((d) => <option key={d} value={d}>{d} dias sem vir</option>)}
        </select>
      </label>
      <div className="field">
        <span>Categorias de despesas</span>
        <div className="chips">
          {cats.map((c) => (
            <span key={c} className="chip">{c}<button type="button" className="chip-x" aria-label={`Remover ${c}`} onClick={() => setCats(cats.filter((x) => x !== c))}>×</button></span>
          ))}
        </div>
        <div className="inline-add">
          <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Nova categoria" />
          <button type="button" className="btn btn-soft btn-sm" onClick={() => { if (newCat.trim()) { setCats([...cats, newCat.trim()]); setNewCat(''); } }}>Adicionar</button>
        </div>
      </div>
      <button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => save({ missing_after_days: days, expense_categories: cats })}>Salvar</button>
    </>
  );
}

// ------------------------------------------------------------ senha e segurança

interface SecurityInfo {
  sessions: { id: number; created_at: number; last_seen: number; device: string; current: boolean }[];
  events: { type: string; at: number; device: string }[];
  recovery: { created_at: number } | null;
}

type IconName = Parameters<typeof Icon>[0]['name'];
const EVENT_LABEL: Record<string, [string, IconName, string]> = {
  login_ok: ['Entrou no painel', 'check', 'ok'],
  login_fail: ['Senha errada', 'alert', 'bad'],
  account_locked: ['Acesso bloqueado (3 senhas erradas)', 'alert', 'bad'],
  login_locked: ['Tentativa com o acesso bloqueado', 'alert', 'bad'],
  logout: ['Saiu do painel', 'logout', ''],
  password_created: ['Senha criada', 'shield', 'ok'],
  password_changed: ['Senha trocada', 'shield', 'ok'],
  recovery_used: ['Senha redefinida com o código', 'shield', 'warn'],
  recovery_fail: ['Código de recuperação errado', 'alert', 'bad'],
  recovery_regenerated: ['Novo código de recuperação', 'shield', ''],
  setup_link_used: ['Link de primeiro acesso usado', 'link', 'warn'],
  setup_link_fail: ['Link de primeiro acesso inválido', 'alert', 'bad'],
  sessions_revoked: ['Aparelhos desconectados', 'logout', ''],
};

function ago(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 2) return 'agora';
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h}h`;
  return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function Security() {
  const [info, setInfo] = useState<SecurityInfo | null>(null);
  const [mode, setMode] = useState<'password' | 'recovery' | null>(null);
  const load = () => api<SecurityInfo>('/api/admin/settings/security').then(setInfo).catch(() => {});
  useEffect(() => { load(); }, []);

  async function revokeOthers() {
    if (!(await confirmDialog('Desconectar os outros aparelhos?', { text: 'Quem estiver usando o painel em outro aparelho vai precisar da senha para entrar de novo.', ok: 'Desconectar' }))) return;
    await api('/api/admin/settings/sessions/revoke-others', { body: {} });
    toast('Outros aparelhos desconectados');
    load();
  }
  async function revokeOne(id: number) {
    await api(`/api/admin/settings/sessions/${id}`, { method: 'DELETE' });
    toast('Aparelho desconectado');
    load();
  }
  async function logout() {
    if (!(await confirmDialog('Sair deste celular?', { text: 'Você vai precisar da senha para entrar de novo.', ok: 'Sair' }))) return;
    await api('/api/admin/logout', { body: {} }).catch(() => {});
    location.href = '/admin';
  }

  const others = info?.sessions.filter((x) => !x.current) ?? [];
  const dayAgo = Date.now() - 86400_000;
  const failures = info?.events.filter((e) => e.at > dayAgo && ['login_fail', 'recovery_fail', 'setup_link_fail'].includes(e.type)).length ?? 0;

  return (
    <>
      {failures >= 3 && (
        <p className="callout danger"><Icon name="alert" size={18} /> {failures} tentativas erradas nas últimas 24h. Se não foi você, troque a senha e desconecte os outros aparelhos.</p>
      )}
      {info && !info.recovery && (
        <p className="callout"><Icon name="alert" size={18} /> Você ainda não tem um código de recuperação. Sem ele, se esquecer a senha, vai precisar de ajuda para entrar.</p>
      )}

      <div className="sec-head"><h3>Acesso</h3></div>
      <div className="rows">
        <button type="button" className="row-item" onClick={() => setMode('password')}>
          <span className="menu-icon"><Icon name="shield" size={19} /></span>
          <span className="grow"><span className="row-title">Trocar senha</span><small>Os outros aparelhos são desconectados</small></span>
          <Icon name="right" size={18} className="chev" />
        </button>
        <button type="button" className="row-item" onClick={() => setMode('recovery')}>
          <span className={`menu-icon${info && !info.recovery ? ' warn' : ''}`}><Icon name="link" size={19} /></span>
          <span className="grow">
            <span className="row-title">Código de recuperação</span>
            <small>{info?.recovery ? `Criado em ${new Date(info.recovery.created_at).toLocaleDateString('pt-BR')} · gerar um novo` : 'Crie agora para nunca ficar sem acesso'}</small>
          </span>
          <Icon name="right" size={18} className="chev" />
        </button>
      </div>

      <div className="sec-head"><h3>Aparelhos conectados</h3>{others.length > 0 && <button type="button" className="link" onClick={revokeOthers}>Desconectar outros</button>}</div>
      <div className="rows">
        {info?.sessions.map((x) => (
          <div key={x.id} className="row-item">
            <span className="menu-icon"><Icon name="phone" size={18} /></span>
            <span className="grow">
              <span className="row-title">{x.device}{x.current && <span className="tag-here">este</span>}</span>
              <small>Usado {ago(x.last_seen)} · desde {new Date(x.created_at).toLocaleDateString('pt-BR')}</small>
            </span>
            {!x.current && <button type="button" className="text-btn danger" onClick={() => revokeOne(x.id)}>Sair</button>}
          </div>
        ))}
      </div>

      <div className="sec-head"><h3>Atividade recente</h3></div>
      {info && info.events.length === 0 ? <p className="hint">Nenhuma atividade ainda.</p> : (
        <div className="rows">
          {info?.events.map((e, i) => {
            const [label, icon, tone] = EVENT_LABEL[e.type] ?? [e.type, 'shield' as IconName, ''];
            return (
              <div key={i} className="row-item">
                <span className={`menu-icon ${tone}`}><Icon name={icon} size={17} /></span>
                <span className="grow"><span className="row-title">{label}</span><small>{e.device}</small></span>
                <small className="muted">{ago(e.at)}</small>
              </div>
            );
          })}
        </div>
      )}

      <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 24 }} onClick={logout}><Icon name="logout" size={18} /> Sair deste celular</button>

      {mode === 'password' && <ChangePassword onClose={() => { setMode(null); load(); }} />}
      {mode === 'recovery' && <NewRecoveryCode onClose={() => { setMode(null); load(); }} />}
    </>
  );
}

function ChangePassword({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api('/api/admin/settings/password', { body: { current, next: pw } });
      toast('Senha trocada');
      onClose();
    } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  }
  return (
    <Sheet title="Trocar senha" onClose={onClose}
      footer={<button type="button" className="btn btn-primary btn-block btn-lg" disabled={busy || !current || !passwordReady(pw, pw2)} onClick={save}>{busy ? 'Salvando…' : 'Trocar senha'}</button>}>
      <label className="field"><span>Senha atual</span><input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></label>
      <NewPasswordFields value={pw} confirm={pw2} onChange={setPw} onConfirm={setPw2} />
    </Sheet>
  );
}

function NewRecoveryCode({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function generate() {
    setBusy(true);
    try {
      const r = await api<{ recovery_code: string }>('/api/admin/settings/recovery-code', { body: { current } });
      setCode(r.recovery_code);
    } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  }
  return (
    <Sheet title="Código de recuperação" onClose={onClose}>
      {code ? <RecoveryCodeReveal code={code} onDone={onClose} doneLabel="Concluir" /> : (
        <>
          <p className="hint">Um código novo substitui o anterior, que deixa de valer. Confirme sua senha para continuar.</p>
          <label className="field"><span>Senha atual</span><input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></label>
          <button type="button" className="btn btn-primary btn-block btn-lg" disabled={busy || !current} onClick={generate}>{busy ? 'Gerando…' : 'Gerar código'}</button>
        </>
      )}
    </Sheet>
  );
}
