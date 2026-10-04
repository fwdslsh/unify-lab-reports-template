import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../site/assets/status.js', import.meta.url), 'utf8');
function run(age, missing = false) {
  const stamp = { dateTime: '2026-10-04T06:00:00+00:00', dataset: { staleMinutes: '90' } };
  const warning = { hidden: true };
  let tick;
  const date = new Date('2026-10-04T06:00:00Z').getTime();
  runInNewContext(source, { Date: { parse: Date.parse, now: () => date + age * 60000 }, Number,
    document: { getElementById: id => missing ? null : id === 'snapshot-time' ? stamp : warning },
    setInterval: callback => { tick = callback; } });
  return { stamp, warning, tick };
}
test('fresh snapshots stay quiet; stale or future snapshots are visibly flagged', () => {
  expect(run(30).warning.hidden).toBe(true);
  expect(run(91).warning.hidden).toBe(false);
  expect(run(-10).warning.hidden).toBe(false);
  expect(run(91).stamp.dataset.state).toBe('warn');
  expect(typeof run(30).tick).toBe('function');
});
test('other pages need no dashboard elements or background requests', () => {
  expect(run(30, true).tick).toBeUndefined();
  expect(source).not.toContain('fetch(');
});
