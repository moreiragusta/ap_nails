// Cálculo de horários livres. Função pura: recebe os dados do dia e devolve os inícios possíveis.
import type { BookingMode, DateException, WeeklyHour } from './types';
import { toHHMM, toMin, weekdayOf } from './time';

export interface Interval { s: number; e: number }

export interface DayInput {
  date: string;
  weekly: WeeklyHour[];
  exceptions: DateException[]; // exceções que tocam a data
  busy: Interval[];            // agendamentos ativos do dia, em minutos
}

export interface SlotRules {
  mode: BookingMode;
  stepMin: number;
  bufferMin: number;
  /** Minuto mínimo de início (para hoje, agora + antecedência). -1 = sem limite. */
  minStart: number;
}

/** Janela de atendimento do dia, ou null se fechado. */
export function dayWindow(date: string, weekly: WeeklyHour[], exceptions: DateException[]): Interval | null {
  const touching = exceptions.filter((x) => x.date_from <= date && x.date_to >= date);
  if (touching.some((x) => x.kind === 'closed')) return null;
  const special = touching.find((x) => x.kind === 'special' && x.start_time && x.end_time);
  if (special) return { s: toMin(special.start_time!), e: toMin(special.end_time!) };
  const w = weekly.find((h) => h.weekday === weekdayOf(date));
  if (!w || !w.open) return null;
  return { s: toMin(w.start_time), e: toMin(w.end_time) };
}

/** Intervalos bloqueados do dia (trechos fechados). */
export function dayBlocks(date: string, exceptions: DateException[]): Interval[] {
  return exceptions
    .filter((x) => x.kind === 'block' && x.date_from <= date && x.date_to >= date && x.start_time && x.end_time)
    .map((x) => ({ s: toMin(x.start_time!), e: toMin(x.end_time!) }));
}

export function computeSlots(day: DayInput, durationMin: number, rules: SlotRules): string[] {
  const win = dayWindow(day.date, day.weekly, day.exceptions);
  if (!win) return [];
  const busy = [...day.busy, ...dayBlocks(day.date, day.exceptions)];
  const buf = rules.bufferMin;
  const fits = (t: number) =>
    t >= win.s && t + durationMin <= win.e && t >= rules.minStart
    && !busy.some((b) => t < b.e + buf && t + durationMin + buf > b.s);

  let candidates: number[];
  if (rules.mode === 'blocks') {
    // Início do expediente e fim de cada compromisso: encaixe sem sobras.
    candidates = [win.s, ...busy.map((b) => b.e + buf)];
    // Hoje, depois do início do expediente: primeiro horário "redondo" após a antecedência.
    if (rules.minStart > win.s) {
      const step = Math.max(5, rules.stepMin);
      candidates.push(Math.ceil(rules.minStart / step) * step);
    }
  } else {
    const step = Math.max(5, rules.stepMin);
    candidates = [];
    for (let t = win.s; t + durationMin <= win.e; t += step) candidates.push(t);
  }
  return [...new Set(candidates)].filter(fits).sort((a, b) => a - b).map(toHHMM);
}

/** Retorna true se [s, e) cabe no dia sem conflito (ignora antecedência). */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.s < b.e && a.e > b.s;
}
