import { Hono } from 'hono';
import { getService, listServices } from '../db';
import { bad, type AppEnv, type Ctx } from '../env';
import { fmtMoney } from '../../shared/format';
import { audit, detectImage } from '../security';
import { idParam, int, longText, text } from '../util';

export const serviceRoutes = new Hono<AppEnv>();

const MAX_PHOTO = 3 * 1024 * 1024;
const PHOTO_TYPES = ['image/webp', 'image/jpeg', 'image/png'];

serviceRoutes.get('/', async (c) => c.json(await listServices(c.env.DB)));

/**
 * Cria ou edita um serviço/combo. Corpo multipart:
 *   data  = JSON { name, description, price_cents, duration_min, active, is_combo, items: number[] }
 *   photo = arquivo de imagem (obrigatório ao criar)
 */
async function save(c: Ctx, id: number | null) {
  const form = await c.req.parseBody();
  let data: Record<string, unknown>;
  try { data = JSON.parse(String(form.data ?? '{}')); } catch { throw bad('Dados inválidos.'); }
  const photo = form.photo instanceof File && form.photo.size > 0 ? form.photo : null;

  const name = text(data.name, 80);
  if (name.length < 2) throw bad('Informe o nome do serviço.');
  const description = longText(data.description, 300);
  const price = int(data.price_cents, 'preço', 0, 10_000_00);
  const duration = int(data.duration_min, 'duração', 15, 12 * 60);
  if (duration % 15 !== 0) throw bad('A duração deve ser em passos de 15 minutos.');
  const isCombo = !!data.is_combo;
  const items = Array.isArray(data.items) ? [...new Set(data.items.map(Number).filter((n) => Number.isInteger(n)))] : [];
  if (isCombo && items.length < 2) throw bad('Um combo precisa ter pelo menos 2 serviços.');
  const active = data.active === undefined ? true : !!data.active;
  const color = typeof data.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(data.color) ? data.color : null;

  const db = c.env.DB;
  const current = id ? await getService(db, id) : null;
  if (id && !current) throw bad('Serviço não encontrado.', 404);
  if (!photo && !current?.photo_key) throw bad('A foto do serviço é obrigatória.');
  // Confere o conteúdo real do arquivo, não só o tipo informado pelo navegador.
  let photoBytes: ArrayBuffer | null = null;
  let photoType: string | null = null;
  if (photo) {
    if (photo.size > MAX_PHOTO) throw bad('Foto muito grande (máx. 3 MB).');
    photoBytes = await photo.arrayBuffer();
    photoType = detectImage(new Uint8Array(photoBytes.slice(0, 16)));
    if (!photoType || !PHOTO_TYPES.includes(photoType)) throw bad('Arquivo inválido. Envie uma foto (JPG, PNG ou WebP).');
  }

  if (!id) {
    const max = await db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM services').first<{ m: number }>();
    const r = await db.prepare(
      'INSERT INTO services (name, description, price_cents, duration_min, is_combo, active, sort, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
    ).bind(name, description, price, duration, isCombo ? 1 : 0, active ? 1 : 0, (max?.m ?? -1) + 1, color).first<{ id: number }>();
    id = r!.id;
  } else {
    await db.prepare('UPDATE services SET name = ?, description = ?, price_cents = ?, duration_min = ?, is_combo = ?, active = ?, color = COALESCE(?, color) WHERE id = ?')
      .bind(name, description, price, duration, isCombo ? 1 : 0, active ? 1 : 0, color, id).run();
  }

  const stmts = [db.prepare('DELETE FROM combo_items WHERE combo_id = ?').bind(id)];
  if (isCombo) {
    for (const sid of items.filter((s) => s !== id)) {
      stmts.push(db.prepare('INSERT OR IGNORE INTO combo_items (combo_id, service_id) SELECT ?, id FROM services WHERE id = ? AND is_combo = 0').bind(id, sid));
    }
  }
  await db.batch(stmts);

  if (photoBytes && photoType) {
    const ext = photoType === 'image/webp' ? 'webp' : photoType === 'image/png' ? 'png' : 'jpg';
    const key = `services/${id}-${Date.now()}.${ext}`;
    await c.env.PHOTOS.put(key, photoBytes, { httpMetadata: { contentType: photoType } });
    await db.prepare('UPDATE services SET photo_key = ? WHERE id = ?').bind(key, id).run();
    if (current?.photo_key) await c.env.PHOTOS.delete(current.photo_key);
  }
  if (!current) {
    await audit(c, 'service_created', `${name} · ${fmtMoney(price)}`);
  } else {
    const ch: string[] = [];
    if (current.name !== name) ch.push(`nome: ${current.name} → ${name}`);
    if (current.price_cents !== price) ch.push(`preço: ${fmtMoney(current.price_cents)} → ${fmtMoney(price)}`);
    if (current.duration_min !== duration) ch.push(`duração: ${current.duration_min} → ${duration} min`);
    if (!!current.active !== active) ch.push(active ? 'voltou ao site' : 'oculto do site');
    if (photo) ch.push('nova foto');
    if (ch.length) await audit(c, 'service_updated', `${name} · ${ch.join(' · ')}`);
  }
  const all = await listServices(db);
  return c.json(all.find((s) => s.id === id), id && current ? 200 : 201);
}

serviceRoutes.post('/', (c) => save(c, null));
serviceRoutes.put('/:id', (c) => save(c, idParam(c.req.param('id'))));

/** Nova ordem de exibição: { ids: number[] } */
serviceRoutes.post('/reorder', async (c) => {
  const { ids } = await c.req.json<{ ids: number[] }>();
  if (!Array.isArray(ids)) throw bad('Ordem inválida.');
  await c.env.DB.batch(ids.map((id, i) => c.env.DB.prepare('UPDATE services SET sort = ? WHERE id = ?').bind(i, Number(id))));
  return c.json({ ok: true });
});

/** Exclui se nunca foi usado; caso contrário, apenas desativa (preserva o histórico). */
serviceRoutes.delete('/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  const db = c.env.DB;
  const svc = await getService(db, id);
  if (!svc) throw bad('Serviço não encontrado.', 404);
  const used = await db.prepare('SELECT 1 FROM appointments WHERE service_id = ? LIMIT 1').bind(id).first();
  if (used) {
    await db.prepare('UPDATE services SET active = 0 WHERE id = ?').bind(id).run();
    await audit(c, 'service_hidden', `${svc.name} (tem histórico, ficou oculto)`);
    return c.json({ deleted: false, deactivated: true });
  }
  await db.prepare('DELETE FROM services WHERE id = ?').bind(id).run();
  if (svc.photo_key) await c.env.PHOTOS.delete(svc.photo_key);
  await audit(c, 'service_deleted', `${svc.name} · ${fmtMoney(svc.price_cents)}`);
  return c.json({ deleted: true });
});
