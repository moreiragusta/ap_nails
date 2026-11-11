import { useCallback, useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation, useSearchParams } from 'react-router';
import type { Service, Settings } from '../../shared/types';
import { api, ApiError, errorMessage } from '../lib/api';
import { registerSW } from '../lib/push';
import './admin.css';
import AppointmentSheet from './AppointmentSheet';
import { AdminContext } from './context';
import Agenda from './pages/Agenda';
import Clients from './pages/Clients';
import Finance from './pages/Finance';
import Services from './pages/Services';
import SettingsPage from './pages/Settings';
import { GlobalLayers, Icon } from './ui';

interface Me { today: string; settings: Settings }

const TABS = [
  { to: '/admin', end: true, icon: 'calendar', label: 'Agenda' },
  { to: '/admin/clientes', icon: 'users', label: 'Clientes' },
  { to: '/admin/servicos', icon: 'sparkle', label: 'Serviços' },
  { to: '/admin/financeiro', icon: 'wallet', label: 'Financeiro' },
  { to: '/admin/ajustes', icon: 'settings', label: 'Ajustes' },
] as const;

export default function AdminApp() {
  const [state, setState] = useState<'loading' | 'login' | 'ready' | 'error'>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [services, setServices] = useState<Service[]>([]);

  const load = useCallback(async () => {
    try {
      const m = await api<Me>('/api/admin/me');
      setMe(m);
      setServices(await api<Service[]>('/api/admin/services'));
      setState('ready');
      registerSW();
    } catch (e) {
      setState(e instanceof ApiError && e.status === 401 ? 'login' : 'error');
    }
  }, []);

  useEffect(() => {
    document.title = 'AP Nails · Painel';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#9E6258');
    load();
    const onUnauthorized = () => setState('login');
    window.addEventListener('apn:unauthorized', onUnauthorized);
    return () => window.removeEventListener('apn:unauthorized', onUnauthorized);
  }, [load]);

  // Atualiza "hoje" quando o app volta para a frente (ex.: aberto desde ontem).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && state === 'ready') {
        api<Me>('/api/admin/me').then((m) => setMe((old) => (old?.today === m.today ? old : m))).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [state]);

  if (state === 'loading') return <div className="admin boot"><img src="/brand/icon-192.png" alt="" /><p>Carregando…</p></div>;
  if (state === 'login') return <Login onDone={load} />;
  if (state === 'error' || !me) {
    return (
      <div className="admin boot">
        <p>Não foi possível conectar.</p>
        <button type="button" className="btn btn-primary" onClick={() => { setState('loading'); load(); }}>Tentar de novo</button>
      </div>
    );
  }

  return (
    <AdminContext.Provider value={{
      today: me.today,
      settings: me.settings,
      setSettings: (s) => setMe((m) => (m ? { ...m, settings: s } : m)),
      services,
      reloadServices: async () => setServices(await api<Service[]>('/api/admin/services')),
    }}
    >
      <Shell />
      <GlobalLayers />
    </AdminContext.Provider>
  );
}

function Shell() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const apptId = Number(params.get('appt')) || null;
  const title = TABS.find((t) => ('end' in t ? location.pathname === t.to || location.pathname === `${t.to}/` : location.pathname.startsWith(t.to)))?.label ?? 'Agenda';

  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);

  return (
    <div className="admin">
      <header className="topbar">
        <img src="/brand/icon-192.png" alt="" className="topbar-logo" />
        <div>
          <p className="topbar-brand">AP Nails</p>
          <h1>{title}</h1>
        </div>
      </header>
      <main className="content">
        <Routes>
          <Route index element={<Agenda />} />
          <Route path="clientes" element={<Clients />} />
          <Route path="servicos" element={<Services />} />
          <Route path="financeiro" element={<Finance />} />
          <Route path="ajustes" element={<SettingsPage />} />
          <Route path="*" element={<Agenda />} />
        </Routes>
      </main>
      <nav className="tabbar" aria-label="Menu">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={'end' in t} className={({ isActive }) => `tab${isActive ? ' is-active' : ''}`}>
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
      {apptId && (
        <AppointmentSheet
          id={apptId}
          initialMode={params.get('do') === 'complete' ? 'complete' : 'view'}
          onClose={() => { params.delete('appt'); params.delete('do'); setParams(params, { replace: true }); }}
        />
      )}
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/login', { body: { password } });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin login">
      <form className="login-card" onSubmit={submit}>
        <img src="/brand/icon-192.png" alt="" className="login-logo" />
        <p className="login-brand">AP Nails</p>
        <h1>Painel da Amanda</h1>
        <label className="field">
          <span>Senha</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !password}>{busy ? 'Entrando…' : 'Entrar'}</button>
        <p className="login-help">Esqueceu a senha? Fale com a NUKKI.</p>
      </form>
    </div>
  );
}
