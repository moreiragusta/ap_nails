import { useEffect, useRef } from 'react';

// Cloudflare Turnstile: verificação antirrobô gratuita, normalmente invisível.
// Só pede interação (um toque) quando o tráfego parece suspeito.

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
}
declare global { interface Window { turnstile?: TurnstileApi } }

let loader: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!loader) {
    loader = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { loader = null; reject(new Error('turnstile')); };
      document.head.appendChild(s);
    });
  }
  return loader;
}

/**
 * Renderiza o widget e entrega o token em onToken (null quando expira ou falha).
 * Mude `resetKey` para gerar um novo token (cada token vale para um envio só).
 */
export function Turnstile({ siteKey, action, onToken, resetKey = 0 }: {
  siteKey: string | null | undefined;
  action: string;
  onToken: (token: string | null) => void;
  resetKey?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  cb.current = onToken;

  useEffect(() => {
    if (!siteKey || !ref.current) return;
    let id: string | null = null;
    let cancelled = false;
    cb.current(null);
    loadScript().then(() => {
      if (cancelled || !ref.current || !window.turnstile) return;
      id = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        action,
        theme: 'light',
        language: 'pt-br',
        appearance: 'interaction-only',
        size: 'flexible',
        callback: (t: string) => cb.current(t),
        'expired-callback': () => cb.current(null),
        'error-callback': () => cb.current(null),
      });
    }).catch(() => cb.current(null));
    return () => {
      cancelled = true;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [siteKey, action, resetKey]);

  if (!siteKey) return null;
  return <div ref={ref} className="turnstile" />;
}
