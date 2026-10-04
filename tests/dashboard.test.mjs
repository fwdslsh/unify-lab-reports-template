import { test, expect } from 'bun:test';
import { renderDashboard, containerState, backupState } from '../scripts/dashboard.mjs';

const now = new Date('2026-10-04T06:00:00Z');
function fixture() {
  const config = { hosts: [{ id: 'server' }], endpoints: [{ id: 'web', label: 'Web', url: 'https://web.example.test/health', purpose: 'Web route' }], backups: { jobs: [{ id: 'local', host: 'server', unit: 'backup', label: 'Local', maxAgeHours: 36, scope: 'Local copy' }], expectations: [{ target: 'server', jobs: ['local'], note: 'Configured scope' }] } };
  const host = { collected: true, facts: { memused: ['500'], memtot: ['1000'], rootuse: ['40%'], load: ['1 1 1'], cores: ['4'], containers: ['1'] }, docker: [{ id: 'a', name: 'web', state: 'running', health: 'healthy', restarts: 0 }], monitor: { journal: { available: true, count: 0 }, failed_units: [], backups: { backup: { last_success: now.toISOString(), result: 'success', exit_code: '0' } } } };
  const snapshot = { observed_at: now.toISOString(), hosts: { server: host }, endpoints: [{ ...config.endpoints[0], status: '200', latency: '10 ms' }] };
  return { config, host, snapshot, render: (previous = {}) => renderDashboard(snapshot, config, previous, now) };
}
test('native details, collapsed indicators and visible host metrics are preserved', () => {
  const f = fixture(), html = f.render();
  for (const id of ['attention', 'hosts', 'endpoints', 'containers', 'backups']) expect(html).toContain(`id="${id}"`);
  for (const text of ['No issues in checked signals', 'class="machine-metrics"', 'class="indicator"', 'HTTP reachability only']) expect(html).toContain(text);
  expect(html).not.toContain('<table'); expect(html).not.toContain('<details open'); expect(html).not.toContain('<input');
});
test('rendering is pure, repeatable and the empty template never claims health', () => {
  const f = fixture(), before = structuredClone(f.snapshot); expect(f.render()).toBe(f.render()); expect(f.snapshot).toEqual(before);
  const html = renderDashboard({ observed_at: null, hosts: {}, endpoints: [] }, {});
  expect(html).toContain('No observations yet'); expect(html).toContain('Not assessed'); expect(html).not.toContain('No issues in checked signals');
});
test('critical resources cannot be downgraded by high load; endpoint failures alert', () => {
  const f = fixture(); f.host.facts.rootuse = ['99%']; f.host.facts.load = ['8 8 8']; f.snapshot.endpoints[0].status = '000';
  const html = f.render(); expect(html).toContain('Root disk usage 99%'); expect(html).toContain('data-state="bad" id="host-server"'); expect(html).toContain('Web · unreachable');
});
test('RAM and mounted disk thresholds also produce actionable alerts', () => {
  const f = fixture(); f.host.facts.memused = ['999']; f.host.facts.storage = ['/data|rw|100 GiB total (95% used)'];
  expect(f.render()).toContain('RAM usage 100%'); expect(f.render()).toContain('/data disk usage 95%');
});
test('running without a healthcheck remains neutral', () => {
  const f = fixture(); f.host.docker[0].health = null;
  expect(f.render()).toContain('No Docker healthcheck'); expect(f.render()).not.toContain('>Healthy</span>');
});
for (const [c, old, state] of [
  [{ state: 'exited', exit_code: 0 }, null, 'warn'], [{ state: 'exited', exit_code: 137 }, null, 'bad'], [{ state: 'restarting' }, null, 'bad'],
  [{ state: 'running', oom: true }, null, 'bad'], [{ state: 'running', health: 'unhealthy' }, null, 'bad'], [{ state: 'running', health: 'starting' }, null, 'warn'],
  [{ state: 'running', id: 'same', health: 'healthy', restarts: 4 }, { id: 'same', restarts: 2 }, 'warn'],
  [{ state: 'running', id: 'same', health: 'healthy', restarts: 4 }, { id: 'old', restarts: 2 }, 'ok']
]) test(`container ${JSON.stringify(c)} has honest state ${state}`, () => expect(containerState(c, old)[0]).toBe(state));
test('exclusions stay visible and suppress only their own outage', () => {
  const f = fixture(); f.host.docker[0].state = 'exited'; f.host.docker[0].exit_code = 137; f.snapshot.endpoints[0].status = '500';
  f.config.exclusions = { containers: { 'server/web': 'Retained rollback' }, endpoints: { web: 'Intentionally inactive' } };
  const html = f.render(); expect(html).toContain('Excluded containers (1)'); expect(html).toContain('Intentionally inactive'); expect(html).not.toContain('Web · unreachable');
  expect(containerState({}, null, 'Excluded')[0]).toBe('off');
});
for (const [changes, state] of [[{ last_success: null }, 'unknown'], [{ last_success: '2026-09-30T00:00:00Z' }, 'warn'], [{ result: 'exit-code', exit_code: '1' }, 'bad'], [{ last_success: '2026-10-05T00:00:00Z' }, 'unknown'], [{ timer_drift: true }, 'warn'], [{ timer_active: 'inactive' }, 'warn'], [{ active: 'active' }, 'unknown']]) test(`backup evidence ${JSON.stringify(changes)} does not falsely pass`, () => {
  const f = fixture(); Object.assign(f.host.monitor.backups.backup, changes); expect(backupState(f.config.backups.jobs[0], f.host, now)[0]).toBe(state);
});
test('backup patterns track containers and overlapping patterns fail closed', () => {
  const f = fixture(); f.config.backups.expectations = [{ target: 'server/w*', jobs: [], note: 'Agent state' }]; expect(f.render()).toContain('server/web');
  f.config.backups.expectations.push({ target: 'server/web', jobs: [], note: 'Duplicate' }); expect(() => f.render()).toThrow('overlap');
});
test('local-only backup is not offsite coverage, and explicit exclusions are honored', () => {
  const f = fixture(); f.config.backups.expectations[0].needsOffsite = true;
  expect(f.render()).toContain('server · off-host'); f.config.exclusions = { backups: { server: 'Owner-managed' } };
  expect(f.render()).not.toContain('backup coverage gaps'); expect(f.render()).toContain('Owner-managed');
});
test('missing and unhealthy backup evidence creates coverage gaps', () => {
  const f = fixture(); f.config.backups.expectations[0].jobs = []; expect(f.render()).toContain('1 backup coverage gaps');
  f.config.backups.expectations[0].jobs = ['local']; f.host.monitor.backups = {}; expect(f.render()).toContain('No evidence'); expect(f.render()).toContain('Backup evidence needs review');
});
test('log errors and failed units have drill-down counts without any log messages', () => {
  const f = fixture(); f.host.monitor.journal = { available: true, count: 101, limited: true, units: ['docker.service'], MESSAGE: 'secret-token=private' }; f.host.monitor.failed_units = ['broken.service'];
  const html = f.render(); expect(html).toContain('≥101 recent system-log errors'); expect(html).toContain('1 failed system unit'); expect(html).toContain('journalctl --since'); expect(html).not.toContain('secret-token'); expect(html).toContain('data-state="warn" id="host-server"');
});
test('unavailable journal and Docker checks never imply a clean check', () => {
  const f = fixture(); f.host.monitor.journal = { available: false }; f.host.monitor.container_checks_available = false;
  expect(f.render()).toContain('System logs not checked'); expect(f.render()).toContain('Container checks unavailable');
});
test('optional skipped hosts/endpoints are not outages; absent configured endpoints are unknown', () => {
  const f = fixture(); f.config.hosts.push({ id: 'optional', optional: true }); f.snapshot.hosts.optional = { skipped: true };
  f.snapshot.endpoints[0].status = 'not probed'; expect(f.render()).not.toContain('Host unreachable'); expect(f.render()).toContain('Not monitored');
  f.snapshot.endpoints = []; expect(f.render()).toContain('Not collected'); expect(f.render()).not.toContain('Web · unreachable');
});
test('unreachable required hosts and stale/future observations cannot pass', () => {
  const f = fixture(); f.host.collected = false; expect(f.render()).toContain('Host unreachable');
  for (const stamp of ['2026-10-03T00:00:00Z', '2026-10-05T00:00:00Z']) { f.snapshot.observed_at = stamp; expect(f.render()).toContain('Observation is stale'); }
});
test('new configured hosts without a sample are unknown, not unreachable', () => {
  const f = fixture(); f.config.hosts.push({ id: 'new-host' });
  expect(f.render()).toContain('Host not collected');
  expect(f.render()).not.toContain('Host unreachable');
});
test('host facts are escaped; container IDs are unique even for similar names', () => {
  const f = fixture(); f.host.facts.cpu = ['<img onerror="x">']; f.host.docker = ['web.one', 'web-one', '<script>alert(1)</script>'].map(name => ({ ...f.host.docker[0], name }));
  const html = f.render(); expect(html).not.toContain('<img onerror'); expect(html).not.toContain('<script>alert'); expect(html).toContain('&lt;img');
  const ids = [...html.matchAll(/id="(container-[^"]+)"/g)].map(m => m[1]); expect(new Set(ids).size).toBe(3);
});
