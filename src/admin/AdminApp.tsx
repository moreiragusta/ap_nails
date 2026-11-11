import { useCallback, useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router';
import type { Service, Settings } from '../../shared/types';
import { api, ApiError } from '../lib/api';
import { registerSW } from '../lib/push';
import './admin.css';
import AppointmentForm from './AppointmentForm';
import AppointmentSheet from './AppointmentSheet';
import { FirstAccess, Login, Recover } from './AuthScreens';
import { AdminContext } from './context';
import Agenda from './pages/Agenda';
import Clients from './pages/Clients';
import Finance from './pages/Finance';
import More from './pages/More';
import Services from './pages/Services';
import SettingsSection from './pages/Settings';
import { GlobalLayers, Icon } from './ui';

interface Me { today: string; settings: Settings }

export default function AdminApp() {
  const [state, setState] = useState<'loading' | 'login' | 'ready' | 'error'>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [recovering, setRecovering] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

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
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#FAF6F2');
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

  const enter = () => { setRecovering(false); navigate('/admin', { replace: true }); setState('loading'); load(); };

  // Primeiro acesso: link de uso único, vale mesmo sem estar logada.
  if (location.pathname.startsWith('/admin/primeiro-acesso')) return <><FirstAccess onDone={enter} /><GlobalLayers /></>;

  if (state === 'loading') return <div className="admin boot"><span className="mono" /><p className="muted">Carregando…</p></div>;
  if (state === 'login') {
    return (
      <>
        {recovering ? <Recover onDone={enter} onBack={() => setRecovering(false)} /> : <Login onDone={enter} onForgot={() => setRecovering(true)} />}
        <GlobalLayers />
      </>
    );
  }
  if (state === 'error' || !me) {
    return (
      <div className="admin boot">
        <span className="mono" />
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
  const creating = params.get('novo') === '1';

  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);

  const closeParams = (...keys: string[]) => {
    keys.forEach((k) => params.delete(k));
    setParams(params, { replace: true });
  };
  const openNew = () => {
    params.set('novo', '1');
    setParams(params);
  };

  const inMore = ['/admin/mais', '/admin/servicos', '/admin/ajustes'].some((p) => location.pathname.startsWith(p));

  return (
    <div className="admin">
      <main>
        <Routes>
          <Route index element={<Agenda />} />
          <Route path="clientes" element={<Clients />} />
          <Route path="financeiro" element={<Finance />} />
          <Route path="mais" element={<More />} />
          <Route path="servicos" element={<Services />} />
          <Route path="ajustes/:section" element={<SettingsSection />} />
          <Route path="*" element={<Agenda />} />
        </Routes>
      </main>

      <nav className="tabbar" aria-label="Menu">
        <NavLink to="/admin" end className={({ isActive }) => `tab${isActive ? ' is-active' : ''}`}>
          <Icon name="calendar" /><span>Agenda</span>
        </NavLink>
        <NavLink to="/admin/clientes" className={({ isActive }) => `tab${isActive ? ' is-active' : ''}`}>
          <Icon name="users" /><span>Clientes</span>
        </NavLink>
        <button type="button" className="tab-plus" onClick={openNew} aria-label="Novo agendamento">
          <Icon name="plus" size={26} />
        </button>
        <NavLink to="/admin/financeiro" className={({ isActive }) => `tab${isActive ? ' is-active' : ''}`}>
          <Icon name="wallet" /><span>Financeiro</span>
        </NavLink>
        <NavLink to="/admin/mais" className={`tab${inMore ? ' is-active' : ''}`}>
          <Icon name="dots" /><span>Mais</span>
        </NavLink>
      </nav>

      {creating && (
        <AppointmentForm
          defaultDate={params.get('data') ?? undefined}
          defaultTime={params.get('hora') ?? undefined}
          onClose={() => closeParams('novo', 'data', 'hora')}
        />
      )}
      {apptId && (
        <AppointmentSheet
          id={apptId}
          initialMode={params.get('do') === 'complete' ? 'complete' : 'view'}
          onClose={() => closeParams('appt', 'do')}
        />
      )}
    </div>
  );
}
