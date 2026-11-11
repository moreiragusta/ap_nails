import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import { Turnstile } from '../lib/turnstile';
import { Icon, toast } from './ui';

interface AuthConfig { turnstile_site_key: string | null; has_password: boolean }

function useAuthConfig() {
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  useEffect(() => { api<AuthConfig>('/api/admin/auth/config').then(setCfg).catch(() => setCfg({ turnstile_site_key: null, has_password: true })); }, []);
  return cfg;
}

function Frame({ title, eyebrow = 'AP Nails', children }: { title: string; eyebrow?: string; children: ReactNode }) {
  return (
    <div className="admin boot">
      <div className="login-card">
        <span className="mono" />
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="display">{title}</h1>
        {children}
      </div>
    </div>
  );
}

/** Mensagem de erro com o tempo de espera quando há bloqueio. */
function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="form-error" role="alert">{error}</p>;
}

// ------------------------------------------------------------ força da senha

export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (pw.length < 8) return { score: 0, label: 'Mínimo de 8 caracteres' };
  let s = 0;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw) || /\s/.test(pw)) s++;
  if (s <= 1) return { score: 1, label: 'Fraca: misture letras, números ou use uma frase' };
  if (s === 2) return { score: 2, label: 'Boa' };
  return { score: 3, label: 'Forte' };
}

export function NewPasswordFields({ value, confirm, onChange, onConfirm }: {
  value: string; confirm: string; onChange: (v: string) => void; onConfirm: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  const st = passwordStrength(value);
  return (
    <>
      <label className="field">
        <span>Nova senha</span>
        <div className="pw-wrap">
          <input type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" />
          <button type="button" className="pw-toggle" onClick={() => setShow(!show)}>{show ? 'Ocultar' : 'Mostrar'}</button>
        </div>
        {value && (
          <span className={`pw-meter s${st.score}`}><i /><i /><i /><em>{st.label}</em></span>
        )}
      </label>
      <label className="field">
        <span>Repita a nova senha</span>
        <input type={show ? 'text' : 'password'} value={confirm} onChange={(e) => onConfirm(e.target.value)} autoComplete="new-password" />
        {confirm && confirm !== value && <small className="field-error">As senhas não são iguais.</small>}
      </label>
    </>
  );
}

export const passwordReady = (pw: string, confirm: string) => pw.length >= 8 && pw === confirm;

// ------------------------------------------------------------ código de recuperação

export function RecoveryCodeReveal({ code, onDone, doneLabel = 'Continuar' }: { code: string; onDone: () => void; doneLabel?: string }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="recovery">
      <p className="hint">
        Este é o seu <b>código de recuperação</b>. Se um dia esquecer a senha, é com ele que você cria uma nova, sem depender de ninguém.
        Ele aparece <b>só agora</b>.
      </p>
      <div className="recovery-code num" aria-label="Código de recuperação">{code}</div>
      <button type="button" className="btn btn-soft btn-block" onClick={() => navigator.clipboard?.writeText(code).then(() => toast('Código copiado'))}>
        <Icon name="link" size={18} /> Copiar código
      </button>
      <ul className="recovery-tips">
        <li>Tire um print e guarde num álbum só seu, ou anote num papel.</li>
        <li>Não envie para ninguém. Quem tiver o código consegue trocar sua senha.</li>
        <li>Depois de usado, ele deixa de valer e um novo é gerado.</li>
      </ul>
      <label className="check-row surface">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>Guardei o código em um lugar seguro</span>
      </label>
      <button type="button" className="btn btn-primary btn-block btn-lg" style={{ marginTop: 14 }} disabled={!saved} onClick={onDone}>{doneLabel}</button>
    </div>
  );
}

// ------------------------------------------------------------ login

export function Login({ onDone, onForgot }: { onDone: () => void; onForgot: () => void }) {
  const cfg = useAuthConfig();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [tsReset, setTsReset] = useState(0);
  const needToken = !!cfg?.turnstile_site_key;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/login', { body: { password, turnstile: token } });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
      setTsReset((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  if (cfg && !cfg.has_password) {
    return (
      <Frame title="Bem-vinda">
        <p className="hint">A senha do painel ainda não foi criada. Abra o <b>link de primeiro acesso</b> que você recebeu para criar a sua.</p>
      </Frame>
    );
  }

  return (
    <Frame title="Olá, Amanda">
      <form onSubmit={submit}>
        <label className="field">
          <span>Senha</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus maxLength={128} />
        </label>
        <Turnstile siteKey={cfg?.turnstile_site_key} action="login" onToken={setToken} resetKey={tsReset} />
        <ErrorBox error={error} />
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy || !password || (needToken && !token)}>
          {busy ? 'Entrando…' : needToken && !token ? 'Verificando segurança…' : 'Entrar'}
        </button>
      </form>
      <button type="button" className="link login-help" onClick={onForgot}>Esqueci minha senha</button>
    </Frame>
  );
}

// ------------------------------------------------------------ recuperar com o código

export function Recover({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const cfg = useAuthConfig();
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [tsReset, setTsReset] = useState(0);
  const [newCode, setNewCode] = useState<string | null>(null);
  const needToken = !!cfg?.turnstile_site_key;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ recovery_code: string }>('/api/admin/recover', { body: { code, password: pw, turnstile: token } });
      setNewCode(r.recovery_code);
    } catch (err) {
      setError(errorMessage(err));
      setTsReset((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  if (newCode) {
    return (
      <Frame title="Senha redefinida" eyebrow="Pronto">
        <p className="hint">Por segurança, todos os outros aparelhos foram desconectados. Seu código antigo deixou de valer. Guarde o novo:</p>
        <RecoveryCodeReveal code={newCode} onDone={onDone} doneLabel="Entrar no painel" />
      </Frame>
    );
  }

  return (
    <Frame title="Criar nova senha" eyebrow="Recuperação">
      <p className="hint">Use o código de recuperação que você guardou quando criou a senha.</p>
      <form onSubmit={submit}>
        <label className="field">
          <span>Código de recuperação</span>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX-XXXX" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} maxLength={24} className="num" />
        </label>
        <NewPasswordFields value={pw} confirm={pw2} onChange={setPw} onConfirm={setPw2} />
        <Turnstile siteKey={cfg?.turnstile_site_key} action="recover" onToken={setToken} resetKey={tsReset} />
        <ErrorBox error={error} />
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy || code.replace(/[^A-Z0-9]/g, '').length < 16 || !passwordReady(pw, pw2) || (needToken && !token)}>
          {busy ? 'Salvando…' : 'Criar nova senha'}
        </button>
      </form>
      <button type="button" className="link login-help" onClick={onBack}>Voltar para o login</button>
      <p className="login-help muted">Perdeu também o código? Peça à NUKKI um novo link de primeiro acesso.</p>
    </Frame>
  );
}

// ------------------------------------------------------------ primeiro acesso (link de uso único)

export function FirstAccess({ onDone }: { onDone: () => void }) {
  const cfg = useAuthConfig();
  const [token] = useState(() => {
    const t = location.hash.slice(1);
    // Remove o token da barra de endereço (não fica no histórico).
    if (t) history.replaceState(null, '', location.pathname);
    return t;
  });
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ts, setTs] = useState<string | null>(null);
  const [tsReset, setTsReset] = useState(0);
  const [code, setCode] = useState<string | null>(null);
  const needToken = !!cfg?.turnstile_site_key;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ recovery_code: string }>('/api/admin/setup', { body: { token, password: pw, turnstile: ts } });
      setCode(r.recovery_code);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
      setTsReset((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <Frame title="Link incompleto">
        <p className="hint">Abra o link de primeiro acesso exatamente como você recebeu. Se ele não funcionar, peça um novo à NUKKI.</p>
      </Frame>
    );
  }

  if (code) {
    return (
      <Frame title="Senha criada" eyebrow="Tudo pronto">
        <RecoveryCodeReveal code={code} onDone={onDone} doneLabel="Entrar no painel" />
      </Frame>
    );
  }

  return (
    <Frame title="Crie sua senha" eyebrow="Primeiro acesso">
      <p className="hint">Só você vai saber esta senha. Escolha algo fácil de lembrar e difícil de adivinhar, como uma frase curta.</p>
      <form onSubmit={submit}>
        <NewPasswordFields value={pw} confirm={pw2} onChange={setPw} onConfirm={setPw2} />
        <Turnstile siteKey={cfg?.turnstile_site_key} action="setup" onToken={setTs} resetKey={tsReset} />
        <ErrorBox error={error} />
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy || !passwordReady(pw, pw2) || (needToken && !ts)}>
          {busy ? 'Salvando…' : 'Criar senha'}
        </button>
      </form>
    </Frame>
  );
}
