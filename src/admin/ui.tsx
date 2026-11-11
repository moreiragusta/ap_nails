import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SERVICE_COLORS, STATUS_LABEL, type Status } from '../../shared/types';

// ------------------------------------------------------------------ ícones

const paths: Record<string, ReactNode> = {
  calendar: <><rect x="3" y="4.5" width="18" height="16" rx="3" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.6 3 2.4 3.5 5.2" /></>,
  sparkle: <path d="M12 3c.5 4.5 3.5 7.5 8 8-4.5.5-7.5 3.5-8 8-.5-4.5-3.5-7.5-8-8 4.5-.5 7.5-3.5 8-8z" />,
  wallet: <><path d="M4 7.5V18a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-3" /><path d="M20 12v-3a1 1 0 0 0-1-1H6a2 2 0 0 1 0-4h11" /><path d="M16 12h5v4h-5a2 2 0 0 1 0-4z" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  left: <path d="M15 5l-7 7 7 7" />,
  right: <path d="M9 5l7 7-7 7" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>,
  camera: <><path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="3.5" /></>,
  trash: <><path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></>,
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z" />,
  logout: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 16l-4-4 4-4M6 12h10" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  up: <path d="M5 15l7-7 7 7" />,
  down: <path d="M5 9l7 7 7-7" />,
  refresh: <><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8" /><path d="M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16" /><path d="M20 20v-4h-4" /></>,
  alert: <><path d="M12 3l9.5 17h-19L12 3z" /><path d="M12 10v4M12 17.2v.1" /></>,
  undo: <><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-2" /></>,
  money: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 9.5v5M18 9.5v5" /></>,
  dots: <><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>,
  pencil: <><path d="M4 20h4L19 9l-4-4L4 16v4z" /></>,
  pix: <><path d="M12 3l3.5 3.5L12 10 8.5 6.5 12 3zM12 14l3.5 3.5L12 21l-3.5-3.5L12 14zM3 12l3.5-3.5L10 12l-3.5 3.5L3 12zM14 12l3.5-3.5L21 12l-3.5 3.5L14 12z" /></>,
  card: <><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19M6.5 15h4" /></>,
  contactless: <><path d="M8.5 8.5a5 5 0 0 1 0 7M12 6a8.5 8.5 0 0 1 0 12M15.5 3.5a12 12 0 0 1 0 17" /></>,
  message: <><path d="M4 5h16v11H9l-5 4V5z" /></>,
  shield: <><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6l8-3z" /></>,
  external: <><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
  scissors: <><circle cx="6" cy="7" r="2.5" /><circle cx="6" cy="17" r="2.5" /><path d="M8 8.5L20 18M8 15.5L20 6" /></>,
};

export function Icon({ name, size = 22, className }: { name: keyof typeof paths | 'whatsapp'; size?: number; className?: string }) {
  if (name === 'whatsapp') {
    return (
      <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm4.52 11.98c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.17.25-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.23.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28z" />
      </svg>
    );
  }
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

// ------------------------------------------------------------------ eventos globais (toast, confirmar, recarregar)

type Listener<T> = (v: T) => void;
function channel<T>() {
  const ls = new Set<Listener<T>>();
  return {
    emit: (v: T) => ls.forEach((l) => l(v)),
    on: (l: Listener<T>) => { ls.add(l); return () => { ls.delete(l); }; },
  };
}

const toastCh = channel<{ text: string; kind: 'ok' | 'error' }>();
export const toast = (text: string, kind: 'ok' | 'error' = 'ok') => toastCh.emit({ text, kind });

/** Avisa as telas que os dados mudaram (depois de salvar algo). */
const refreshCh = channel<void>();
export const bumpData = () => refreshCh.emit();
export function useDataVersion() {
  const [v, setV] = useState(0);
  useEffect(() => refreshCh.on(() => setV((x) => x + 1)), []);
  return v;
}

interface ConfirmReq { title: string; text?: string; ok?: string; danger?: boolean; resolve: (b: boolean) => void }
const confirmCh = channel<ConfirmReq>();
export const confirmDialog = (title: string, opts: { text?: string; ok?: string; danger?: boolean } = {}) =>
  new Promise<boolean>((resolve) => confirmCh.emit({ title, ...opts, resolve }));

export function GlobalLayers() {
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: string }[]>([]);
  const [confirm, setConfirm] = useState<ConfirmReq | null>(null);
  useEffect(() => toastCh.on((t) => {
    const id = Date.now() + Math.random();
    setToasts((l) => [...l, { id, ...t }]);
    window.setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), 3200);
  }), []);
  useEffect(() => confirmCh.on(setConfirm), []);
  const answer = (b: boolean) => { confirm?.resolve(b); setConfirm(null); };
  return createPortal(
    <>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>)}
      </div>
      {confirm && (
        <div className="dialog-backdrop" onClick={() => answer(false)}>
          <div className="dialog" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>{confirm.title}</h3>
            {confirm.text && <p>{confirm.text}</p>}
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={() => answer(false)}>Voltar</button>
              <button type="button" className={`btn ${confirm.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => answer(true)} autoFocus>
                {confirm.ok ?? 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}

// ------------------------------------------------------------------ sheet (painel que sobe de baixo)

export function Sheet({ title, onClose, children, footer, wide }: {
  /** Sem título, o conteúdo traz o próprio cabeçalho (fecha tocando fora ou no botão voltar). */
  title?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('no-scroll'); };
  }, [onClose]);
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <section className={`sheet${wide ? ' sheet-wide' : ''}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" aria-hidden="true" />
        {title !== undefined && (
          <header className="sheet-head">
            <h2>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar"><Icon name="x" /></button>
          </header>
        )}
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ pequenos componentes

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`pill pill-${status}`}>{STATUS_LABEL[status]}</span>;
}

/** Valor em reais: "R$" menor e discreto; centavos só quando existem (ou sempre, com cents). */
export function Money({ cents, showCents = false, className = '' }: { cents: number; showCents?: boolean; className?: string }) {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const reais = Math.floor(abs / 100).toLocaleString('pt-BR');
  const c = abs % 100;
  return (
    <span className={`money${neg ? ' neg' : ''}${className ? ` ${className}` : ''}`} aria-label={`${neg ? 'menos ' : ''}R$ ${reais},${String(c).padStart(2, '0')}`}>
      {neg && '−'}<span className="cur">R$</span>{reais}
      {(showCents || c !== 0) && <span className="cents">,{String(c).padStart(2, '0')}</span>}
    </span>
  );
}

export const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');

/** Cor estável por nome: cada cliente fica sempre com a mesma cor. */
export function nameColor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SERVICE_COLORS[h % SERVICE_COLORS.length];
}

export function Avatar({ name, size }: { name: string; size?: 'lg' }) {
  const c = nameColor(name);
  return (
    <span className={`avatar${size ? ` ${size}` : ''}`} aria-hidden="true"
      style={{ background: `color-mix(in srgb, ${c} 22%, #fff)`, color: `color-mix(in srgb, ${c} 70%, #2e1f1c)` }}>
      {initials(name)}
    </span>
  );
}

export function PageHead({ eyebrow, title, onBack, backLabel = 'Voltar', right }: {
  eyebrow?: ReactNode; title: ReactNode; onBack?: () => void; backLabel?: string; right?: ReactNode;
}) {
  return (
    <>
      {onBack && <button type="button" className="back-btn" onClick={onBack}><Icon name="left" size={20} /> {backLabel}</button>}
      <header className="page-head">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1 className="display">{title}</h1>
        </div>
        {right}
      </header>
    </>
  );
}

export function SecHead({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="sec-head"><h3>{title}</h3>{action}</div>;
}

export function Empty({ icon = 'sparkle', title, text, action }: { icon?: Parameters<typeof Icon>[0]['name']; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={30} />
      <p className="empty-title">{title}</p>
      {text && <p className="empty-text">{text}</p>}
      {action}
    </div>
  );
}

export const Loading = ({ text = 'Carregando…' }: { text?: string }) => <p className="loading">{text}</p>;

/** "45,50" → 4550 */
export function parseMoney(v: string): number | null {
  const clean = v.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = Number(clean);
  return clean && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
export const centsToInput = (c: number) => (c / 100).toFixed(2).replace('.', ',');
