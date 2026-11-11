import { buildPushPayload, type PushSubscription } from '@block65/webcrypto-web-push';
import type { Env } from './env';

export interface PushNote {
  title: string;
  body: string;
  /** Caminho do painel aberto ao tocar na notificação. */
  url: string;
  tag?: string;
}

/** Envia a notificação para todos os aparelhos inscritos. Remove inscrições vencidas. */
export async function notifyAdmin(env: Env, note: PushNote): Promise<number> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    console.warn('[push] VAPID não configurado; notificação ignorada:', note.title);
    return 0;
  }
  const { results } = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions')
    .all<{ endpoint: string; p256dh: string; auth: string }>();
  const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  let sent = 0;
  await Promise.all(results.map(async (r) => {
    const sub: PushSubscription = { endpoint: r.endpoint, expirationTime: null, keys: { p256dh: r.p256dh, auth: r.auth } };
    try {
      const payload = await buildPushPayload({ data: JSON.stringify(note), options: { ttl: 86400, urgency: 'high' } }, sub, vapid);
      const res = await fetch(sub.endpoint, payload);
      if (res.status === 404 || res.status === 410) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(r.endpoint).run();
      } else if (res.ok) sent++;
      else console.warn('[push] falhou', res.status, await res.text());
    } catch (e) {
      console.error('[push] erro', e);
    }
  }));
  return sent;
}
