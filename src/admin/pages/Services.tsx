import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { fmtDuration } from '../../../shared/format';
import { SERVICE_COLORS, type Service } from '../../../shared/types';
import { api, errorMessage } from '../../lib/api';
import { preparePhoto } from '../../lib/image';
import { useAdmin } from '../context';
import { centsToInput, confirmDialog, Empty, Icon, Money, PageHead, parseMoney, Sheet, toast } from '../ui';

export default function Services() {
  const { services, reloadServices } = useAdmin();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Service | 'new' | 'new-combo' | null>(null);

  async function toggle(s: Service) {
    const fd = new FormData();
    fd.set('data', JSON.stringify({ ...s, items: s.items.map((i) => i.id), active: !s.active }));
    try {
      await api(`/api/admin/services/${s.id}`, { method: 'PUT', body: fd });
      await reloadServices();
      toast(s.active ? 'Oculto do site' : 'Visível no site');
    } catch (e) { toast(errorMessage(e), 'error'); }
  }

  async function move(index: number, dir: -1 | 1) {
    const ids = services.map((s) => s.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    await api('/api/admin/services/reorder', { body: { ids } });
    await reloadServices();
  }

  return (
    <div className="page">
      <PageHead title="Serviços" eyebrow={`${services.filter((s) => s.active).length} visíveis no site`} onBack={() => navigate('/admin/mais')} backLabel="Mais" />
      <div className="two-cols" style={{ marginTop: 14 }}>
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}><Icon name="plus" size={20} /> Serviço</button>
        <button type="button" className="btn btn-soft" onClick={() => setEditing('new-combo')}><Icon name="plus" size={20} /> Combo</button>
      </div>
      <p className="hint" style={{ marginTop: 14 }}>Aparecem no site nesta ordem. Use as setas para reorganizar.</p>

      {services.length === 0 ? (
        <Empty icon="scissors" title="Nenhum serviço ainda" text="Cadastre com foto, preço e duração. Eles aparecem na sua página de agendamento." />
      ) : (
        <div className="rows">
          {services.map((s, i) => (
            <div key={s.id} className={`svc-row${s.active ? '' : ' is-off'}`}>
              <button type="button" className="row-item" style={{ padding: 0 }} onClick={() => setEditing(s)}>
                {s.photo_url ? <img className="thumb" src={s.photo_url} alt="" /> : <span className="thumb" />}
                <span className="grow">
                  <span className="row-title"><span className="svc-dot" style={{ '--svc': s.color } as React.CSSProperties} />{s.name}{s.is_combo && <span className="combo-tag">Combo</span>}</span>
                  <small><Money cents={s.price_cents} /> · {fmtDuration(s.duration_min)}</small>
                  {s.is_combo && <small>{s.items.map((x) => x.name).join(' + ')}</small>}
                  {!s.active && <small>Oculto no site</small>}
                </span>
              </button>
              <div className="svc-tools">
                <label className="switch" aria-label={s.active ? 'Ocultar do site' : 'Mostrar no site'}>
                  <input type="checkbox" checked={s.active} onChange={() => toggle(s)} />
                  <span />
                </label>
                <div className="order-btns">
                  <button type="button" className="icon-btn" style={{ width: 34, height: 34 }} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir"><Icon name="up" size={18} /></button>
                  <button type="button" className="icon-btn" style={{ width: 34, height: 34 }} disabled={i === services.length - 1} onClick={() => move(i, 1)} aria-label="Descer"><Icon name="down" size={18} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ServiceForm
          service={typeof editing === 'object' ? editing : null}
          combo={editing === 'new-combo' || (typeof editing === 'object' && editing.is_combo)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

const DURATIONS = Array.from({ length: 32 }, (_, i) => (i + 1) * 15);

function ServiceForm({ service, combo, onClose }: { service: Service | null; combo: boolean; onClose: () => void }) {
  const { services, reloadServices } = useAdmin();
  const [name, setName] = useState(service?.name ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [price, setPrice] = useState(service ? centsToInput(service.price_cents) : '');
  const [duration, setDuration] = useState(service?.duration_min ?? 60);
  const [active, setActive] = useState(service?.active ?? true);
  const [color, setColor] = useState(service?.color ?? SERVICE_COLORS[services.length % SERVICE_COLORS.length]);
  const [items, setItems] = useState<number[]>(service?.items.map((i) => i.id) ?? []);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(service?.photo_url ?? null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (photo && preview) URL.revokeObjectURL(preview); }, [photo, preview]);

  const singles = services.filter((s) => !s.is_combo && s.id !== service?.id);
  const picked = singles.filter((s) => items.includes(s.id));
  const sumPrice = picked.reduce((t, s) => t + s.price_cents, 0);
  const sumDuration = picked.reduce((t, s) => t + s.duration_min, 0);

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    try {
      const blob = await preparePhoto(file);
      setPhoto(blob);
      setPreview(URL.createObjectURL(blob));
    } catch {
      toast('Não foi possível usar essa foto. Tente outra.', 'error');
    }
  }

  async function save() {
    const cents = parseMoney(price);
    if (name.trim().length < 2) return toast('Informe o nome.', 'error');
    if (cents === null) return toast('Informe o preço.', 'error');
    if (!preview) return toast('A foto é obrigatória.', 'error');
    if (combo && items.length < 2) return toast('Escolha pelo menos 2 serviços para o combo.', 'error');
    const fd = new FormData();
    fd.set('data', JSON.stringify({ name, description, price_cents: cents, duration_min: duration, active, is_combo: combo, items, color }));
    if (photo) fd.set('photo', photo, photo.type === 'image/webp' ? 'foto.webp' : 'foto.jpg');
    setBusy(true);
    try {
      await api(service ? `/api/admin/services/${service.id}` : '/api/admin/services', { method: service ? 'PUT' : 'POST', body: fd });
      await reloadServices();
      toast(service ? 'Serviço atualizado' : 'Serviço criado');
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!service) return;
    if (!(await confirmDialog(`Excluir “${service.name}”?`, { text: 'Se já foi usado em agendamentos, ele só fica oculto do site, para manter o histórico.', ok: 'Excluir', danger: true }))) return;
    try {
      const r = await api<{ deleted: boolean }>(`/api/admin/services/${service.id}`, { method: 'DELETE' });
      await reloadServices();
      toast(r.deleted ? 'Serviço excluído' : 'Serviço ocultado (tem histórico)');
      onClose();
    } catch (e) { toast(errorMessage(e), 'error'); }
  }

  return (
    <Sheet
      title={service ? service.name : combo ? 'Novo combo' : 'Novo serviço'}
      onClose={onClose}
      footer={<button type="button" className="btn btn-primary btn-block btn-lg" disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar'}</button>}
    >
      <button type="button" className={`photo-pick${preview ? ' has-photo' : ''}`} onClick={() => fileRef.current?.click()}>
        {preview ? <img src={preview} alt="" /> : <><Icon name="camera" size={32} /><span>Adicionar foto</span><small className="muted">obrigatória · aparece no site</small></>}
        {preview && <span className="photo-change"><Icon name="camera" size={16} /> Trocar</span>}
      </button>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />

      <label className="field"><span>Nome</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={combo ? 'Ex.: Pé e mão' : 'Ex.: Esmaltação em gel'} /></label>
      <label className="field"><span>Descrição curta <small>(aparece no site)</small></span><textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} /></label>

      {combo && (
        <div className="field">
          <span>Serviços incluídos</span>
          <div className="rows">
            {singles.map((s) => (
              <label key={s.id} className="check-row">
                <input type="checkbox" checked={items.includes(s.id)} onChange={(e) => setItems(e.target.checked ? [...items, s.id] : items.filter((x) => x !== s.id))} />
                <span>{s.name}</span>
                <small><Money cents={s.price_cents} /> · {fmtDuration(s.duration_min)}</small>
              </label>
            ))}
          </div>
          {picked.length >= 2 && (
            <button type="button" className="link" style={{ alignSelf: 'flex-start', marginTop: 8 }}
              onClick={() => { setPrice(centsToInput(sumPrice)); setDuration(Math.ceil(sumDuration / 15) * 15); }}>
              Usar a soma: <Money cents={sumPrice} /> · {fmtDuration(sumDuration)}
            </button>
          )}
        </div>
      )}

      <div className="two-cols">
        <label className="field"><span>Preço</span><input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="R$ 0,00" /></label>
        <label className="field">
          <span>Duração</span>
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {DURATIONS.map((d) => <option key={d} value={d}>{fmtDuration(d)}</option>)}
          </select>
        </label>
      </div>

      <div className="field">
        <span>Cor na agenda</span>
        <div className="swatches" role="radiogroup" aria-label="Cor do serviço">
          {SERVICE_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Cor ${c}`}
              className={`swatch${color === c ? ' is-selected' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
        </div>
      </div>

      <label className="check-row surface" style={{ marginBottom: 12 }}>
        <span className="grow" style={{ flex: 1 }}>Mostrar no site</span>
        <span className="switch"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><span /></span>
      </label>

      {service && <button type="button" className="text-btn danger" onClick={remove}><Icon name="trash" size={16} /> Excluir</button>}
    </Sheet>
  );
}
