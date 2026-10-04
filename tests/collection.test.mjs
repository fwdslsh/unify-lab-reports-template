import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfig, readSnapshot } from '../scripts/config.mjs';
import { collect, parseHost, hostScript, hostCommand, observeHost, observeEndpoint, writeSnapshot } from '../scripts/collect.mjs';

test('collection does not connect outside observation windows', async () => {
  const window = { timezone: 'UTC', start: '22:00', end: '06:00' }, now = new Date('2026-10-04T12:00Z');
  const config = validateConfig({ hosts: [{ id: 'optional', ssh: 'observer@example.test', window }] });
  const result = await collect(config, now, () => { throw new Error('must not connect'); }); expect(result.hosts.optional.skipped).toBe(true);
  const endpoint = await observeEndpoint({ id: 'x', url: 'https://example.test', window }, now, () => { throw new Error('must not fetch'); }); expect(endpoint.status).toBe('not probed');
});
test('native SSH uses strict trust and arguments; all platforms need no Python', () => {
  const host = { id: 'server', ssh: 'observer@example.test', port: 2222 }, command = hostCommand(host, { SSH_KEY_FILE: '/keys/key', SSH_KNOWN_HOSTS_FILE: '/keys/hosts' });
  expect(command.slice(0, 3)).toEqual(['ssh', '-o', 'BatchMode=yes']); expect(command).toContain('StrictHostKeyChecking=yes'); expect(command).toContain('2222'); expect(command).toContain('/keys/key');
  for (const platform of ['linux', 'macos', 'windows']) expect(hostScript({ ...host, platform }, [])).not.toMatch(/python|node |bun |jq /i);
  expect(hostCommand({ platform: 'windows' }, {})).toEqual(['powershell', '-NoProfile', '-NonInteractive', '-Command', '-']);
});
test('native host calls are bounded and failures remain unknown', () => {
  const result = observeHost({ id: 'local' }, [], (command, args, options) => {
    expect(command).toBe('bash'); expect(args).toEqual(['-s']); expect(options.timeout).toBe(45000); expect(options.shell).toBeUndefined();
    return { stdout: 'host=local\nos=Linux\n' };
  }); expect(result.collected).toBe(true);
  expect(observeHost({ id: 'local' }, [], () => { throw new Error('timeout'); }).collected).toBe(false);
});
test('safe inventory joins only matching IDs and excludes secrets and raw logs', () => {
  const container = { id: 'same', name: 'web', state: 'running', Env: ['private-secret'] }, check = { id: 'same', health: 'healthy', restarts: 2, Log: ['private-secret'] };
  const monitor = { journal: { available: true, count: 1, units: ['docker.service'], MESSAGE: 'private-secret' }, backups: { backup: { result: 'success', private: 'private-secret' } } };
  let raw = 'docker=' + JSON.stringify(container) + '\ndocker-health=' + JSON.stringify(check) + '\nmonitor=' + JSON.stringify(monitor);
  expect(parseHost(raw).docker[0].health).toBe('healthy'); expect(JSON.stringify(parseHost(raw))).not.toContain('private-secret');
  check.id = 'other'; raw = 'docker=' + JSON.stringify(container) + '\ndocker-health=' + JSON.stringify(check); expect(parseHost(raw).docker[0].health).toBeUndefined();
});
test('HTTP failures and optional unreachable endpoints preserve honest statuses', async () => {
  const item = { id: 'x', url: 'https://example.test' };
  expect((await observeEndpoint(item, new Date(), () => { throw new Error('offline'); })).status).toBe('000');
  expect((await observeEndpoint({ ...item, optional: true }, new Date(), () => { throw new Error('offline'); })).status).toBe('off');
  let cancelled = false;
  expect((await observeEndpoint(item, new Date(), async () => ({ status: 503, body: { cancel: () => { cancelled = true; } } }))).status).toBe('503'); expect(cancelled).toBe(true);
});
test('atomic snapshots preserve the old observation on serialization failure', () => {
  const temp = mkdtempSync(join(tmpdir(), 'atomic-snapshot.')), path = join(temp, 'observed.json');
  try {
    const snapshot = { observed_at: null, hosts: {}, endpoints: [] }; writeSnapshot(path, snapshot);
    const circular = {}; circular.self = circular; expect(() => writeSnapshot(path, circular)).toThrow();
    expect(readSnapshot(path)).toEqual(snapshot); expect(readdirSync(temp)).toEqual(['observed.json']);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
function nativeFixture(fail = false) {
  const dir = mkdtempSync(join(tmpdir(), 'native-observer.'));
  const script = name => join(dir, name);
  writeFileSync(script('sudo'), '#!/bin/bash\nshift\nexec "$@"\n', { mode: 0o755 });
  writeFileSync(script('docker'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  writeFileSync(script('journalctl'), '#!/bin/bash\n' + (fail ? 'exit 1' : `printf '%s\\n' '{"_SYSTEMD_UNIT":"docker.service","MESSAGE":"private password=value"}'`), { mode: 0o755 });
  writeFileSync(script('systemctl'), `#!/bin/bash
if [ "$1" = --failed ]; then echo 'broken.service loaded failed failed Description';
elif [[ "$2" = *.timer ]]; then printf 'ActiveState=active\\nNeedDaemonReload=yes\\n';
else printf 'LoadState=loaded\\nResult=success\\nExecMainStatus=0\\nExecMainExitTimestamp=2026-10-04 06:00:00 UTC\\nActiveState=inactive\\n'; fi
`, { mode: 0o755 });
  const monitor = readFileSync(new URL('../scripts/probes/monitor.sh', import.meta.url), 'utf8');
  const run = calls => spawnSync('bash', ['-s'], { input: monitor + '\n' + calls + '\nprintf \'monitor={"journal":%s,"failed_units":%s,"backups":{%s},"container_checks_available":%s}\\n\' "$journal" "$failed" "$backup_json" "$checks"\n', env: { ...process.env, PATH: dir + ':' + process.env.PATH }, encoding: 'utf8', timeout: 10000 });
  return { dir, run, close: () => rmSync(dir, { recursive: true, force: true }) };
}
test('real Bash observer emits only counts and unit names, with configurable timer checks', () => {
  const f = nativeFixture();
  try {
    const result = f.run("observe_backup 'custom-backup' '' ''"); expect(result.status, result.stderr).toBe(0);
    const data = parseHost(result.stdout).monitor;
    expect(data.journal.count).toBe(1); expect(data.failed_units).toEqual(['broken.service']); expect(JSON.stringify(data)).not.toContain('password');
    expect(new Date(data.backups['custom-backup'].last_success).toISOString()).toBe('2026-10-04T06:00:00.000Z'); expect(data.backups['custom-backup'].timer_drift).toBe(true);
  } finally { f.close(); }
});
test('missing receipts/markers never fall back to systemd success', () => {
  const f = nativeFixture();
  try {
    let result = f.run(`observe_backup 'backup' '${f.dir}/missing-receipt' ''`); expect(parseHost(result.stdout).monitor.backups.backup.last_success).toBeNull();
    writeFileSync(join(f.dir, 'receipt'), '2026-10-04T06:00:00Z');
    result = f.run(`observe_backup 'backup' '${f.dir}/receipt' '${f.dir}/missing-marker'`); expect(parseHost(result.stdout).monitor.backups.backup.last_success).toBeNull();
  } finally { f.close(); }
});
test('unavailable journal access is unknown, and invalid units are not executed', () => {
  const f = nativeFixture(true);
  try { const result = f.run("observe_backup 'backup;touch /tmp/no' '' ''"); expect(parseHost(result.stdout).monitor.journal.available).toBe(false); expect(parseHost(result.stdout).monitor.backups).toEqual({}); }
  finally { f.close(); }
});
test('configured receipt paths are shell-quoted, not executable text', () => {
  const script = hostScript({ id: 'server' }, [{ unit: 'backup', receiptPath: "/tmp/some'file", completionMarker: '' }]);
  const syntax = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' }); expect(syntax.status, syntax.stderr).toBe(0);
  expect(script).toContain("'/tmp/some'\\''file'");
});
