export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[c]);
export function number(value) {
  const text = String(value ?? '').replace(/%$/, '');
  const result = text.trim() ? Number(text) : NaN;
  return Number.isFinite(result) && result >= 0 ? result : null;
}
export function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null;
  const result = new Date(value);
  return Number.isFinite(result.getTime()) ? result : null;
}
export function isoDate(value) {
  if (!/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)?)?$/.test(value)) throw new Error('Date must be ISO 8601');
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || !Number.isFinite(Date.parse(value))) throw new Error('Invalid ISO date');
  return value;
}
export const definition = items => '<dl>' + items.map(([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('') + '</dl>';
export const matches = (pattern, value) => new Bun.Glob(pattern).match(value);
export const exclusion = (mapping, target) => Object.entries(mapping ?? {}).find(([pattern]) => matches(pattern, target))?.[1];
