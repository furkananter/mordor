/**
 * Tiny date formatter — replaces the ~70 KB `date-fns` dependency, which we
 * were only using to render two patterns. Keep the surface small; if you find
 * yourself reaching for more patterns, weigh the bundle cost first.
 */

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** "2026-05-19" — ISO calendar date in the local timezone. */
export function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** "May 19, 2026" — short month name. */
export function formatHumanDate(date: Date): string {
  return `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}
