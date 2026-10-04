// Explicit read-only observation. Builds never invoke this entrypoint.
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { ROOT, FACT_KEYS, loadConfig, runtimePath, allowedWindow, readSnapshot } from './config.mjs';
import { environment } from './environment.mjs';

const pick = (value, keys) => Object.fromEntries(keys.filter(k => k in value).map(k => [k, value[k]]));
export function parseHost(raw) {
  const facts = {}, containers = [], checks = new Map();
  let monitor = {};
  for (const line of raw.split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index < 0) continue;
    const key = line.slice(0, index), value = line.slice(index + 1);
    if (FACT_KEYS.has(key)) (facts[key] ??= []).push(value);
    else if (['docker', 'docker-health', 'monitor'].includes(key)) {
      const row = JSON.parse(value);
      if (key === 'docker') containers.push(pick(row, ['name', 'image', 'state', 'status', 'ports', 'project', 'service', 'id']));
      else if (key === 'docker-health') checks.set(row.id, pick(row, ['health', 'restarts', 'exit_code', 'oom', 'started_at']));
      else monitor = { ...pick(row, ['failed_units', 'container_checks_available']), journal: pick(row.journal ?? {}, ['available', 'window_minutes', 'count', 'limited', 'units']), backups: Object.fromEntries(Object.entries(row.backups ?? {}).map(([unit, job]) => [unit, pick(job, ['result', 'exit_code', 'active', 'last_success', 'last_run', 'timer_active', 'timer_drift', 'evidence'])])) };
    }
  }
  for (const container of containers) Object.assign(container, checks.get(container.id));
  return { facts, docker: containers, monitor, collected: Boolean(facts.host?.length && (facts.os?.length || facts.kernel?.length)) };
}
const shellQuote = value => "'" + value.replace(/'/g, "'\\''") + "'";
export function hostScript(host, jobs) {
  const platform = host.platform ?? 'linux';
  let script = readFileSync(join(ROOT, 'scripts/probes', { linux: 'linux.sh', macos: 'macos.sh', windows: 'windows.ps1' }[platform]), 'utf8');
  if (platform === 'linux') {
    script += '\n' + readFileSync(join(ROOT, 'scripts/probes/monitor.sh'), 'utf8') + '\n';
    for (const job of jobs) script += 'observe_backup ' + [job.unit, job.receiptPath ?? '', job.completionMarker ?? ''].map(shellQuote).join(' ') + '\n';
    script += 'printf \'monitor={"journal":%s,"failed_units":%s,"backups":{%s},"container_checks_available":%s}\\n\' "$journal" "$failed" "$backup_json" "$checks"\n';
  }
  return script;
}
export function hostCommand(host, env = environment()) {
  const interpreter = host.platform === 'windows' ? ['powershell', '-NoProfile', '-NonInteractive', '-Command', '-'] : ['bash', '-s'];
  if (!host.ssh) return interpreter;
  const args = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-p', String(host.port ?? 22)];
  if (env.SSH_KEY_FILE) args.push('-i', env.SSH_KEY_FILE, '-o', 'IdentitiesOnly=yes');
  if (env.SSH_KNOWN_HOSTS_FILE) args.push('-o', 'UserKnownHostsFile=' + env.SSH_KNOWN_HOSTS_FILE);
  return [...args, host.ssh, ...interpreter];
}
export function observeHost(host, jobs, run = spawnSync) {
  try {
    const [cmd, ...args] = hostCommand(host);
    const result = run(cmd, args, { input: hostScript(host, jobs), encoding: 'utf8', timeout: 45000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 });
    return parseHost(result.stdout ?? '');
  } catch { return { collected: false, facts: {}, docker: [], monitor: {} }; }
}
export async function observeEndpoint(item, now = new Date(), fetcher = fetch) {
  const row = { ...item, status: 'not probed', latency: '—' };
  if (!allowedWindow(item, now)) return row;
  const start = performance.now();
  try {
    const response = await fetcher(item.url, { signal: AbortSignal.timeout(12000), redirect: 'follow' });
    row.status = String(response.status);
    await response.body?.cancel();
  } catch { row.status = item.optional ? 'off' : '000'; }
  row.latency = `${Math.round(performance.now() - start)} ms`;
  return row;
}
export async function collect(config, now = new Date(), observer = observeHost, endpoint = observeEndpoint) {
  const hosts = {};
  for (const host of config.hosts) hosts[host.id] = allowedWindow(host, now) ? observer(host, config.backups.jobs.filter(j => j.host === host.id)) : { collected: false, skipped: true, note: 'Outside configured observation window' };
  const endpoints = [];
  for (const item of config.endpoints) endpoints.push(await endpoint(item, now));
  return { observed_at: now.toISOString(), hosts, endpoints };
}
export function writeSnapshot(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), '.observed-' + randomUUID());
  try { writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); renameSync(temp, path); }
  finally { rmSync(temp, { force: true }); }
}
if (import.meta.main) {
  const { values } = parseArgs({ args: process.argv.slice(2), options: { config: { type: 'string' }, output: { type: 'string' } }, strict: true });
  const config = loadConfig(values.config), output = values.output ?? runtimePath('SNAPSHOT_FILE', 'state/observed.json');
  const snapshot = await collect(config);
  if (existsSync(output)) writeSnapshot(runtimePath('PREVIOUS_FILE', 'state/previous.json'), readSnapshot(output));
  writeSnapshot(output, snapshot);
  console.log('Collection snapshot updated');
}
