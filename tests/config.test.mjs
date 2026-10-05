import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, validateConfig, inputHash, readSnapshot, allowedWindow } from '../scripts/config.mjs';

test('one config supplies only operational defaults and report policy', () => {
  const config = validateConfig({ reports: { prefix: 'my-lab', weeklyKeep: 3, timezone: 'America/Chicago' } });
  expect(config).not.toHaveProperty('site'); expect(config.reports.weeklyKeep).toBe(3);
  expect(loadConfig().hosts).toEqual([]); expect(config.backups.jobs).toEqual([]);
});
const invalid = [
  { hostz: [] }, { site: { brnad: 'bad' } }, { site: { filesUrl: 'javascript:alert(1)' } }, { site: { title: 1 } },
  { reports: { prefix: '../bad' } }, { reports: { weeklyKeep: 0 } }, { reports: { weeklyKeep: '2' } }, { reports: { timezone: 'Never/Happened' } },
  { thresholds: { criticalPercent: 50 } }, { thresholds: { diskWarningPercent: 'never' } }, { thresholds: { memoryWarnngPercent: 80 } },
  { hosts: [{ id: 'x', ssh: '-oProxyCommand=bad' }] }, { hosts: [{ id: '../bad' }] }, { hosts: [{ id: 'x' }, { id: 'x' }] },
  { hosts: [{ id: 'x', port: 0 }] }, { hosts: [{ id: 'x', port: true }] }, { hosts: [{ id: 'x', platform: 'other' }] },
  { endpoints: [{ id: 'x', url: 'https://user:pass@example.test' }] }, { endpoints: [{ id: 'x', url: 'javascript:alert(1)' }] },
  { hosts: [{ id: 'x', window: { timezone: 'UTC', start: '25:00', end: '08:00' } }] },
  { backups: { jobs: [{ id: 'x', unit: 'bad;touch /tmp/no', host: 'x' }] } }, { exclusions: { containers: { '*': '' } } }
];
for (const [i, config] of invalid.entries()) test(`invalid config ${i + 1} fails instead of silently dropping intent`, () => expect(() => validateConfig(config)).toThrow());
test('fingerprints use input files, never unrelated secrets or branding environment', () => {
  const temp = mkdtempSync(join(tmpdir(), 'config-hash.'));
  try {
    const path = join(temp, 'config.json'); writeFileSync(path, '{}');
    expect(inputHash({})).toBe(''); expect(inputHash({ PRIVATE_TOKEN: 'secret', SITE_BRAND: 'not configuration' })).toBe('');
    const one = inputHash({ CONFIG_FILE: path }); expect(one).toHaveLength(64);
    expect(inputHash({ CONFIG_FILE: path, PRIVATE_TOKEN: 'changed' })).toBe(one);
    writeFileSync(path, '{"reports":{"weeklyKeep":3}}'); expect(inputHash({ CONFIG_FILE: path })).not.toBe(one);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
test('snapshot parsing excludes unknown fact fields and rejects unsafe URLs', () => {
  const temp = mkdtempSync(join(tmpdir(), 'snapshot-read.')), path = join(temp, 'snapshot.json');
  try {
    writeFileSync(path, JSON.stringify({ observed_at: '2026-10-04T12:00:00Z', hosts: { server: { facts: { cpu: ['CPU'], PRIVATE: ['secret'] } } }, endpoints: [] }));
    expect(JSON.stringify(readSnapshot(path))).not.toContain('secret');
    writeFileSync(path, JSON.stringify({ observed_at: 'invalid', hosts: {}, endpoints: [] })); expect(() => readSnapshot(path)).toThrow();
    writeFileSync(path, JSON.stringify({ observed_at: null, hosts: {}, endpoints: [{ url: 'javascript:alert(1)' }] })); expect(() => readSnapshot(path)).toThrow();
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
test('overnight windows use the configured timezone', () => {
  const item = { window: { timezone: 'UTC', start: '22:00', end: '06:00' } };
  expect(allowedWindow(item, new Date('2026-10-04T23:00Z'))).toBe(true);
  expect(allowedWindow(item, new Date('2026-10-04T02:00Z'))).toBe(true);
  expect(allowedWindow(item, new Date('2026-10-04T12:00Z'))).toBe(false);
});
