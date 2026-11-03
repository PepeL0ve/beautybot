// lib/fmt.js — форматирование денег, чисел, списков.

export function money(cents) {
  const rub = Math.floor(Math.abs(cents) / 100);
  const kop = Math.abs(cents) % 100;
  const rubStr = String(rub).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const sign = cents < 0 ? '−' : '';
  return kop ? `${sign}${rubStr},${String(kop).padStart(2, '0')} ₽` : `${sign}${rubStr} ₽`;
}

// '1000' | '1000.50' | '1000,50' → копейки; null при ошибке.
export function parseMoney(s) {
  const m = /^\s*(\d+)(?:[.,](\d{1,2}))?\s*$/.exec(String(s));
  if (!m) return null;
  const kop = m[2] ? Math.round(Number(m[2].padEnd(2, '0'))) : 0;
  return Number(m[1]) * 100 + kop;
}

export function plural(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
