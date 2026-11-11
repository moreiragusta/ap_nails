import { createContext, useContext } from 'react';
import { fmtDateBR, fmtDayMonth, fmtMoney, firstName, renderTemplate, weekdayName } from '../../shared/format';
import { addDays } from '../../shared/time';
import type { Appointment, Service, Settings } from '../../shared/types';
import { waLink } from '../lib/phone';

export interface AdminCtx {
  today: string;
  settings: Settings;
  setSettings: (s: Settings) => void;
  services: Service[];
  reloadServices: () => Promise<void>;
}

export const AdminContext = createContext<AdminCtx | null>(null);
export function useAdmin() {
  const c = useContext(AdminContext);
  if (!c) throw new Error('AdminContext ausente');
  return c;
}

export type MessageKind = 'confirm' | 'reminder' | 'reschedule' | 'chat';

/** Monta o link do WhatsApp com a mensagem pronta para a cliente. */
export function whatsappFor(kind: MessageKind, a: Appointment, settings: Settings, today: string): string {
  if (kind === 'chat') return waLink(a.client_phone);
  const tpl = kind === 'confirm' ? settings.tpl_confirm : kind === 'reminder' ? settings.tpl_reminder : settings.tpl_reschedule;
  const quando = a.date === today ? 'hoje' : a.date === addDays(today, 1) ? 'amanhã' : `em ${fmtDayMonth(a.date)}`;
  const text = renderTemplate(tpl, {
    nome: firstName(a.client_name),
    nome_completo: a.client_name,
    servico: a.service_name,
    data: fmtDayMonth(a.date),
    dia_semana: weekdayName(a.date),
    hora: a.start_time,
    valor: fmtMoney(a.price_cents),
    endereco: settings.address || '',
    quando,
  })
    // Remove linhas que ficaram vazias (ex.: endereço não cadastrado).
    .replace(/\n📍 *\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return waLink(a.client_phone, text);
}

export const fullDate = (d: string) => `${weekdayName(d)}, ${fmtDateBR(d)}`;
