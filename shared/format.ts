// Formatação em pt-BR, usada no painel, na landing e nas notificações.
import { weekdayOf } from './time';

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtMoney = (cents: number) => money.format((cents || 0) / 100);

export const weekdayName = (date: string) => WEEKDAYS[weekdayOf(date)];
export const weekdayShort = (date: string) => WEEKDAYS_SHORT[weekdayOf(date)];
export const monthName = (m: number) => MONTHS[m - 1];
export const monthShort = (m: number) => MONTHS_SHORT[m - 1];

/** 15/11 */
export const fmtDayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
/** 15/11/2026 */
export const fmtDateBR = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
/** sáb, 15/11 */
export const fmtDateShort = (date: string) => `${weekdayShort(date)}, ${fmtDayMonth(date)}`;
/** sábado, 15 de novembro */
export const fmtDateLong = (date: string) =>
  `${weekdayName(date)}, ${Number(date.slice(8, 10))} de ${monthName(Number(date.slice(5, 7)))}`;

/** 90 → "1h30", 60 → "1h", 45 → "45 min" */
export function fmtDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

/** 5518988095805 → (18) 98809-5805 */
export function fmtPhone(phone: string): string {
  const d = phone.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export interface TemplateData {
  nome: string;
  nome_completo: string;
  servico: string;
  data: string;
  dia_semana: string;
  hora: string;
  valor: string;
  endereco: string;
  quando: string;
}

/** Substitui {variaveis} do modelo de mensagem. Variáveis desconhecidas ficam como estão. */
export function renderTemplate(tpl: string, data: TemplateData): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in data ? (data as unknown as Record<string, string>)[k] : m));
}

export const TEMPLATE_VARS: { key: keyof TemplateData; hint: string }[] = [
  { key: 'nome', hint: 'primeiro nome da cliente' },
  { key: 'nome_completo', hint: 'nome completo' },
  { key: 'servico', hint: 'serviço ou combo' },
  { key: 'dia_semana', hint: 'ex.: sábado' },
  { key: 'data', hint: 'ex.: 15/11' },
  { key: 'hora', hint: 'ex.: 18:00' },
  { key: 'valor', hint: 'ex.: R$ 60,00' },
  { key: 'endereco', hint: 'endereço do atendimento' },
  { key: 'quando', hint: '"hoje" ou "amanhã" (lembrete)' },
];
