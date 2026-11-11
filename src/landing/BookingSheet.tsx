import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtDateLong, fmtDuration, fmtMoney, monthShort, weekdayShort } from '../../shared/format';
import type { Service } from '../../shared/types';
import { api, ApiError, errorMessage } from '../lib/api';
import { isValidPhone, maskPhone, waLink } from '../lib/phone';
import { Turnstile } from '../lib/turnstile';
import { content } from './content';
import { Sparkle, WhatsAppIcon } from './Ornaments';

interface Day { date: string; slots: string[] }
interface Booked { id: number; service_name: string; price_cents: number; date: string; start_time: string; end_time: string }

type Step = 'when' | 'details' | 'done';

export default function BookingSheet({ service, whatsapp, turnstileKey, onClose }: {
  service: Service;
  whatsapp: string;
  turnstileKey: string | null;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>('when');
  const [days, setDays] = useState<Day[] | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [booked, setBooked] = useState<Booked | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tsReset, setTsReset] = useState(0);
  const stripRef = useRef<HTMLDivElement>(null);

  async function loadDays(keepDate?: string | null) {
    setDays(null);
    try {
      const r = await api<{ days: Day[] }>(`/api/public/availability?service_id=${service.id}`);
      setDays(r.days);
      const keep = keepDate && r.days.find((d) => d.date === keepDate && d.slots.length);
      setDate(keep ? keepDate! : r.days.find((d) => d.slots.length)?.date ?? null);
    } catch (e) {
      setError(errorMessage(e));
      setDays([]);
    }
  }

  useEffect(() => { loadDays(); }, [service.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  // Mantém o dia selecionado visível na faixa.
  useEffect(() => {
    stripRef.current?.querySelector('.day-chip.is-selected')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [date, days]);

  const slots = useMemo(() => days?.find((d) => d.date === date)?.slots ?? [], [days, date]);
  const hasAny = days?.some((d) => d.slots.length);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError('Informe seu nome.');
    if (!isValidPhone(phone)) return setError('Informe seu WhatsApp com DDD.');
    setError(null);
    setSending(true);
    try {
      const r = await api<{ appointment: Booked }>('/api/public/book', {
        body: { service_id: service.id, date, time, name: name.trim(), phone, turnstile: token },
      });
      setBooked(r.appointment);
      setStep('done');
    } catch (err) {
      if (err instanceof ApiError && err.data.code === 'slot_taken') {
        setTime(null);
        setStep('when');
        await loadDays(date);
      }
      setError(errorMessage(err));
      setTsReset((n) => n + 1); // cada verificação vale para um envio
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="bk-overlay" onClick={onClose}>
      <section className="bk-sheet" role="dialog" aria-modal="true" aria-labelledby="bk-title" onClick={(e) => e.stopPropagation()}>
        <div className="bk-handle" aria-hidden="true" />
        <header className="bk-head">
          <div className="bk-service">
            {service.photo_url && <img src={service.photo_url} alt="" />}
            <div>
              <h2 id="bk-title">{service.name}</h2>
              <p>{fmtMoney(service.price_cents)} · {fmtDuration(service.duration_min)}</p>
            </div>
          </div>
          <button type="button" className="bk-close" onClick={onClose} aria-label="Fechar">✕</button>
        </header>

        {step !== 'done' && (
          <ol className="bk-steps" aria-label="Etapas">
            <li className="is-done">Serviço</li>
            <li className={step === 'when' ? 'is-current' : 'is-done'}>Dia e horário</li>
            <li className={step === 'details' ? 'is-current' : ''}>Seus dados</li>
          </ol>
        )}

        {error && <p className="bk-error" role="alert">{error}</p>}

        {step === 'when' && (
          <div className="bk-body">
            {days === null && <p className="bk-muted">Buscando horários livres…</p>}
            {days && !hasAny && (
              <div className="bk-empty">
                <p>No momento não há horários livres para este serviço.</p>
                <a className="btn btn-outline" href={waLink(whatsapp, `Olá, Amanda! Queria agendar ${service.name}. Tem algum horário?`)} target="_blank" rel="noreferrer">
                  <WhatsAppIcon size={18} /> Pedir um horário no WhatsApp
                </a>
              </div>
            )}
            {days && hasAny && (
              <>
                <h3 className="bk-label">Escolha o dia</h3>
                <div className="day-strip" ref={stripRef}>
                  {days.map((d, i) => {
                    const showMonth = i === 0 || d.date.endsWith('-01');
                    return (
                      <button
                        key={d.date}
                        type="button"
                        className={`day-chip${d.date === date ? ' is-selected' : ''}`}
                        disabled={!d.slots.length}
                        onClick={() => { setDate(d.date); setTime(null); setError(null); }}
                        aria-label={`${fmtDateLong(d.date)}${d.slots.length ? '' : ', sem horários'}`}
                      >
                        <span className="dc-month">{showMonth ? monthShort(Number(d.date.slice(5, 7))) : ' '}</span>
                        <span className="dc-week">{weekdayShort(d.date)}</span>
                        <span className="dc-day">{Number(d.date.slice(8))}</span>
                      </button>
                    );
                  })}
                </div>
                {date && (
                  <>
                    <h3 className="bk-label">Horários em {fmtDateLong(date)}</h3>
                    <div className="slot-grid">
                      {slots.map((s) => (
                        <button key={s} type="button" className={`slot${s === time ? ' is-selected' : ''}`} onClick={() => { setTime(s); setError(null); }}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
            <div className="bk-actions">
              <button type="button" className="btn btn-primary" disabled={!date || !time} onClick={() => setStep('details')}>
                Continuar
              </button>
            </div>
          </div>
        )}

        {step === 'details' && date && time && (
          <form className="bk-body" onSubmit={submit} noValidate>
            <div className="bk-summary">
              <Sparkle size={12} />
              <span><strong>{fmtDateLong(date)}</strong> às <strong>{time}</strong></span>
              <button type="button" className="link" onClick={() => setStep('when')}>Alterar</button>
            </div>
            <label className="field">
              <span>Seu nome</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} placeholder="Como você se chama?" required />
            </label>
            <label className="field">
              <span>Seu WhatsApp</span>
              <input
                value={phone}
                onChange={(e) => setPhone(maskPhone(e.target.value))}
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="(18) 99999-9999"
                required
              />
            </label>
            <p className="bk-privacy">{content.privacyNote}</p>
            <Turnstile siteKey={turnstileKey} action="booking" onToken={setToken} resetKey={tsReset} />
            <div className="bk-actions">
              <button type="submit" className="btn btn-primary" disabled={sending || (!!turnstileKey && !token)}>
                {sending ? 'Enviando…' : turnstileKey && !token ? 'Verificando segurança…' : 'Confirmar agendamento'}
              </button>
            </div>
          </form>
        )}

        {step === 'done' && booked && (
          <div className="bk-body bk-done">
            <div className="bk-done-icon" aria-hidden="true"><Sparkle size={28} /></div>
            <h3>Pedido recebido!</h3>
            <p>A Amanda vai confirmar seu horário pelo WhatsApp em breve.</p>
            <div className="bk-ticket">
              <strong>{booked.service_name}</strong>
              <span>{fmtDateLong(booked.date)}</span>
              <span>{booked.start_time} às {booked.end_time}</span>
              <span>{fmtMoney(booked.price_cents)}</span>
            </div>
            <div className="bk-actions stacked">
              <a className="btn btn-outline" href={waLink(whatsapp, `Olá, Amanda! Acabei de agendar ${booked.service_name} para ${fmtDateLong(booked.date)} às ${booked.start_time}.`)} target="_blank" rel="noreferrer">
                <WhatsAppIcon size={18} /> Falar com a Amanda
              </a>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
