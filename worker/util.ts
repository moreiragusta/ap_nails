import { bad } from './env';

/** Normaliza para o formato do wa.me: só dígitos, com DDI 55 quando faltar. */
export function normalizePhone(p: unknown): string {
  let d = String(p ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d;
}
export const validPhone = (d: string) => /^\d{12,13}$/.test(d);

export function text(v: unknown, max = 200): string {
  return String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}
export function longText(v: unknown, max = 2000): string {
  return String(v ?? '').trim().slice(0, max);
}

export function int(v: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.round(n) !== n || n < min || n > max) throw bad(`Valor inválido: ${field}.`);
  return n;
}

export function idParam(v: string | undefined): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw bad('Registro não encontrado.', 404);
  return n;
}
