import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import './theme.css';
import Landing from './landing/Landing';

// O app instalável (PWA) é só o painel.
if (location.pathname.startsWith('/admin')) {
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = '/manifest.webmanifest';
  document.head.appendChild(link);
}

// O painel é carregado à parte: a landing fica leve para as clientes.
const AdminApp = lazy(() => import('./admin/AdminApp'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route
          path="/admin/*"
          element={(
            <Suspense fallback={<div className="boot-loading">Carregando…</div>}>
              <AdminApp />
            </Suspense>
          )}
        />
        <Route path="*" element={<Landing />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
