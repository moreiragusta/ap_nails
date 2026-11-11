import { api } from './api';

export type PushState = 'unsupported' | 'denied' | 'off' | 'on' | 'no-key';

const b64ToBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

export async function registerSW(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/admin' });
  } catch {
    return null;
  }
}

export async function pushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/admin');
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

/** Pede permissão, inscreve o aparelho e salva no servidor. */
export async function enablePush(): Promise<PushState> {
  if (!('PushManager' in window)) return 'unsupported';
  const { key } = await api<{ key: string | null }>('/api/admin/settings/push/key');
  if (!key) return 'no-key';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  const reg = (await registerSW()) ?? (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  await api('/api/admin/settings/push/subscribe', { body: sub.toJSON() as Record<string, unknown> });
  return 'on';
}
