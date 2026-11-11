/** Máscara de digitação: (18) 98809-5805 */
export function maskPhone(v: string): string {
  const d = v.replace(/\D/g, '').replace(/^55(?=\d{11})/, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export const phoneDigits = (v: string) => v.replace(/\D/g, '');
export const isValidPhone = (v: string) => {
  const d = phoneDigits(v).replace(/^55(?=\d{10,11}$)/, '');
  return d.length === 10 || d.length === 11;
};

/** Converte para o formato do wa.me (com 55). */
export function toWa(v: string): string {
  const d = phoneDigits(v);
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
}

export const waLink = (phone: string, text?: string) =>
  `https://wa.me/${toWa(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
