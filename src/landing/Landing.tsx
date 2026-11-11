import { useEffect, useState } from 'react';
import { fmtDuration, fmtMoney, fmtPhone } from '../../shared/format';
import type { Service, WeeklyHour } from '../../shared/types';
import { api } from '../lib/api';
import { waLink } from '../lib/phone';
import BookingSheet from './BookingSheet';
import { content } from './content';
import Gallery from './Gallery';
import { ClockIcon, Divider, InstagramIcon, PinIcon, Sparkle, WhatsAppIcon } from './Ornaments';
import './landing.css';

interface Catalog {
  business: { business_name: string; owner_name: string; address: string; maps_url: string; whatsapp: string; instagram: string };
  services: Service[];
  weekly: WeeklyHour[];
}

const DAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const hourLabel = (t: string) => (t.endsWith(':00') ? `${Number(t.slice(0, 2))}h` : t.replace(':', 'h'));

/** Agrupa dias seguidos com o mesmo horário: "Seg a Sex · 18h às 22h". */
function groupHours(weekly: WeeklyHour[]) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const groups: { days: number[]; label: string }[] = [];
  for (const d of order) {
    const h = weekly.find((w) => w.weekday === d);
    if (!h?.open) continue;
    const label = `${hourLabel(h.start_time)} às ${hourLabel(h.end_time)}`;
    const last = groups.at(-1);
    const prevDay = last?.days.at(-1);
    if (last && last.label === label && prevDay !== undefined && order.indexOf(prevDay) === order.indexOf(d) - 1) last.days.push(d);
    else groups.push({ days: [d], label });
  }
  return groups.map((g) => ({
    days: g.days.length > 2 ? `${DAY_SHORT[g.days[0]]} a ${DAY_SHORT[g.days.at(-1)!]}` : g.days.map((d) => DAY_SHORT[d]).join(' e '),
    label: g.label,
  }));
}

export default function Landing() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<Service | null>(null);
  const [showFab, setShowFab] = useState(false);

  useEffect(() => {
    api<Catalog>('/api/public/catalog').then(setCatalog).catch(() => setFailed(true));
    const onScroll = () => setShowFab(window.scrollY > window.innerHeight * 0.7);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const b = catalog?.business;
  const whatsapp = b?.whatsapp || '5518988095805';
  const hours = catalog ? groupHours(catalog.weekly) : [];
  const mapsQuery = b?.address ? encodeURIComponent(b.address) : '';

  return (
    <div className="landing">
      {/* ------------------------------------------------ abertura */}
      <header className="hero">
        <div className="hero-glow" aria-hidden="true" />
        <img className="hero-logo" src={content.logo} alt={`${b?.business_name ?? 'AP Nails'} — ${content.ownerFullName}`} />
        <p className="hero-headline">{content.headline}</p>
        <Divider icon="heart" />
        <a href="#servicos" className="btn btn-gold hero-cta">Agendar meu horário</a>
        <p className="hero-sub">{content.intro}</p>
      </header>

      {/* ------------------------------------------------ serviços */}
      <section id="servicos" className="section section-cream">
        <p className="eyebrow">Escolha o seu</p>
        <h2 className="section-title">Serviços</h2>
        <Divider />
        {!catalog && !failed && <p className="muted center">Carregando serviços…</p>}
        {failed && (
          <p className="muted center">
            Não foi possível carregar os serviços agora. <a href={waLink(whatsapp)}>Fale com a Amanda no WhatsApp</a>.
          </p>
        )}
        {catalog && !catalog.services.length && (
          <p className="muted center">Em breve os serviços estarão disponíveis aqui. Enquanto isso, <a href={waLink(whatsapp)}>chame no WhatsApp</a>.</p>
        )}
        <div className="service-grid">
          {catalog?.services.map((s) => (
            <article key={s.id} className="service-card">
              <button type="button" className="service-photo" onClick={() => setSelected(s)} aria-label={`Agendar ${s.name}`}>
                {s.photo_url && <img src={s.photo_url} alt="" loading="lazy" />}
                {s.is_combo && <span className="badge-combo"><Sparkle size={10} /> Combo</span>}
              </button>
              <div className="service-info">
                <h3>{s.name}</h3>
                {s.is_combo && s.items.length > 0 && <p className="service-items">{s.items.map((i) => i.name).join(' + ')}</p>}
                {s.description && <p className="service-desc">{s.description}</p>}
                <div className="service-meta">
                  <span className="price">{fmtMoney(s.price_cents)}</span>
                  <span className="duration"><ClockIcon size={14} /> {fmtDuration(s.duration_min)}</span>
                </div>
                <button type="button" className="btn btn-primary btn-block" onClick={() => setSelected(s)}>Agendar</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ galeria */}
      {content.gallery.length > 0 && (
        <section className="section section-rose">
          <p className="eyebrow light">Alguns trabalhos</p>
          <h2 className="section-title light">Galeria</h2>
          <Divider />
          <Gallery photos={content.gallery} />
        </section>
      )}

      {/* ------------------------------------------------ sobre */}
      <section className="section section-cream about">
        <div className="about-photo"><img src={content.about.photo} alt={content.ownerFullName} loading="lazy" /></div>
        <div className="about-text">
          <p className="eyebrow">{content.ownerFullName}</p>
          <h2 className="section-title">{content.about.title}</h2>
          {content.about.paragraphs.map((p) => <p key={p}>{p}</p>)}
          <p className="signature">{content.ownerFullName}</p>
        </div>
      </section>

      {/* ------------------------------------------------ localização */}
      {b?.address && (
        <section className="section section-blush">
          <p className="eyebrow">Onde estou</p>
          <h2 className="section-title">Localização</h2>
          <Divider />
          <p className="address"><PinIcon size={18} /> {b.address}</p>
          <div className="map-frame">
            <iframe
              title="Mapa"
              src={`https://maps.google.com/maps?q=${mapsQuery}&z=16&output=embed`}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
          <a className="btn btn-outline" href={b.maps_url || `https://www.google.com/maps/dir/?api=1&destination=${mapsQuery}`} target="_blank" rel="noreferrer">
            Como chegar
          </a>
        </section>
      )}

      {/* ------------------------------------------------ perguntas frequentes */}
      <section className="section section-cream">
        <p className="eyebrow">Dúvidas</p>
        <h2 className="section-title">Perguntas frequentes</h2>
        <Divider />
        <div className="faq">
          {content.faq.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ rodapé */}
      <footer className="footer">
        <p className="footer-brand">{b?.business_name ?? 'AP Nails'}</p>
        <p className="footer-script">{content.ownerFullName}</p>
        <div className="footer-links">
          <a href={waLink(whatsapp)} target="_blank" rel="noreferrer"><WhatsAppIcon /> {fmtPhone(whatsapp)}</a>
          {b?.instagram && (
            <a href={`https://instagram.com/${b.instagram}`} target="_blank" rel="noreferrer"><InstagramIcon /> @{b.instagram}</a>
          )}
        </div>
        {hours.length > 0 && (
          <div className="footer-hours">
            <ClockIcon size={16} />
            <div>{hours.map((h) => <p key={h.days}><strong>{h.days}</strong> · {h.label}</p>)}</div>
          </div>
        )}
        <p className="footer-script small">Agende seu horário</p>
        <a className="credit" href={content.credit.href}>{content.credit.label}</a>
      </footer>

      <a href="#servicos" className={`fab-book${showFab ? ' is-visible' : ''}`} aria-hidden={!showFab} tabIndex={showFab ? 0 : -1}>
        <Sparkle size={12} /> Agendar
      </a>

      {selected && <BookingSheet service={selected} whatsapp={whatsapp} onClose={() => setSelected(null)} />}
    </div>
  );
}
