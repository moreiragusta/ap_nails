// Tipos e constantes compartilhados entre o Worker (API) e o front-end.

export type Status = 'pending' | 'confirmed' | 'done' | 'cancelled' | 'expired';
export type PaymentMethod = 'pix' | 'cash' | 'debit' | 'credit';
export type BookingMode = 'blocks' | 'free';
export type ReminderWhen = 'same_day' | 'day_before';
export type ExceptionKind = 'closed' | 'block' | 'special';

export const STATUS_LABEL: Record<Status, string> = {
  pending: 'Aguardando',
  confirmed: 'Confirmado',
  done: 'Concluído',
  cancelled: 'Cancelado',
  expired: 'Expirado',
};

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  pix: 'Pix',
  cash: 'Dinheiro',
  debit: 'Débito',
  credit: 'Crédito',
};

export interface Service {
  id: number;
  name: string;
  description: string;
  price_cents: number;
  duration_min: number;
  photo_url: string | null;
  is_combo: boolean;
  active: boolean;
  sort: number;
  items: { id: number; name: string }[];
}

export interface Appointment {
  id: number;
  client_id: number;
  client_name: string;
  client_phone: string;
  service_id: number | null;
  service_name: string;
  price_cents: number;
  duration_min: number;
  date: string;
  start_time: string;
  end_time: string;
  status: Status;
  source: 'site' | 'admin';
  notes: string;
  confirmation_sent_at: string | null;
  confirmed_at: string | null;
  alert_sent_at: string | null;
  reminder_sent_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  expired_at: string | null;
  payment_method: PaymentMethod | null;
  created_at: string;
}

/** Detalhe de um agendamento com o contexto da cliente. */
export interface AppointmentDetail extends Appointment {
  client: { visits: number; total_cents: number; last_visit: string | null; notes: string };
}

export interface Client {
  id: number;
  name: string;
  phone: string;
  notes: string;
  created_at: string;
  visits: number;
  total_cents: number;
  last_visit: string | null;
  next_visit: string | null;
}

export interface WeeklyHour {
  weekday: number;
  open: boolean;
  start_time: string;
  end_time: string;
}

export interface DateException {
  id: number;
  kind: ExceptionKind;
  date_from: string;
  date_to: string;
  start_time: string | null;
  end_time: string | null;
  reason: string;
}

export interface Expense {
  id: number;
  date: string;
  description: string;
  category: string;
  amount_cents: number;
}

export interface Settings {
  business_name: string;
  owner_name: string;
  address: string;
  maps_url: string;
  whatsapp: string;
  instagram: string;
  booking_mode: BookingMode;
  slot_step_min: number;
  buffer_min: number;
  min_advance_min: number;
  window_days: number;
  tpl_confirm: string;
  tpl_reminder: string;
  tpl_reschedule: string;
  reminder_when: ReminderWhen;
  reminder_notice_time: string;
  missing_after_days: number;
  expense_categories: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  business_name: 'AP Nails',
  owner_name: 'Amanda',
  address: '',
  maps_url: '',
  whatsapp: '5518988095805',
  instagram: 'apnails.pp',
  booking_mode: 'blocks',
  slot_step_min: 30,
  buffer_min: 0,
  min_advance_min: 60,
  window_days: 60,
  tpl_confirm:
    'Olá, {nome}! Aqui é a Amanda, da AP Nails 💅\n\n'
    + 'Recebi seu agendamento:\n'
    + '✨ {servico}\n'
    + '📅 {dia_semana}, {data}\n'
    + '⏰ {hora}\n'
    + '💰 {valor}\n\n'
    + 'Posso confirmar seu horário? Responda *SIM* para confirmar. 😊',
  tpl_reminder:
    'Oi, {nome}! Passando para lembrar do seu horário {quando} às *{hora}* — {servico}. 💅\n\n'
    + '📍 {endereco}\n\n'
    + 'Te espero! Se tiver algum imprevisto, me avise por aqui, tá?',
  tpl_reschedule:
    'Oi, {nome}! Seu horário foi remarcado para *{dia_semana}, {data} às {hora}* — {servico}. 💅\n\n'
    + 'Qualquer coisa, é só me chamar!',
  reminder_when: 'same_day',
  reminder_notice_time: '09:00',
  missing_after_days: 45,
  expense_categories: ['Materiais', 'Aluguel e contas', 'Cursos', 'Marketing', 'Outros'],
};

/** Chaves que a cliente (site público) pode ver. */
export const PUBLIC_SETTING_KEYS = ['business_name', 'owner_name', 'address', 'maps_url', 'whatsapp', 'instagram', 'window_days'] as const;
