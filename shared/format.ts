// One set of display numbers for every panel, log and sheet.

/** A whole non-negative number, with thousands separators. */
export function formatWhole(value: number): string {
  const whole = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Money is always whole pieces of eight. */
export function formatMoney(amount: number): string {
  const value = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A whole percentage. */
export function formatPercent(value: number): string {
  const percent = Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
  return `${percent}%`;
}

/** Whole crew and whole crew percent: "93% (263/284)". */
export function formatCrew(crew: number, fullCrew: number): string {
  const current = Math.max(0, Math.round(Number.isFinite(crew) ? crew : 0));
  const full = Math.max(0, Math.round(Number.isFinite(fullCrew) ? fullCrew : 0));
  const percent = full > 0 ? Math.round((current / full) * 100) : 0;
  return `${formatPercent(percent)} (${formatWhole(current)}/${formatWhole(full)})`;
}

/** Tonnes show one decimal, with no trailing .0. */
export function formatTonnes(tonnes: number): string {
  const rounded = Math.round((Number.isFinite(tonnes) ? Math.max(0, tonnes) : 0) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatTonnesWithUnit(tonnes: number): string {
  return `${formatTonnes(tonnes)} t`;
}

/** Speed always shows one decimal. */
export function formatKnots(knots: number): string {
  const value = Number.isFinite(knots) ? Math.max(0, knots) : 0;
  return `${value.toFixed(1)} kn`;
}
