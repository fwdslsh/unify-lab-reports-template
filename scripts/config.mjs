// One configuration shared by generation, collection, retention and publishing.
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { environment } from './environment.mjs';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export function runtimePath(key, fallback, env = environment()) { return resolve(ROOT, env[key] || fallback); }
export const FACT_KEYS = new Set(['host', 'os', 'kernel', 'cpu', 'cores', 'board', 'memused', 'memtot', 'swapused', 'uptime', 'load', 'containers', 'rootuse', 'rootsize', 'storage', 'gpu']);
const safeID = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
function keys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`Invalid ${label}: check documented keys`);
}
function timezone(value) { if (typeof value !== 'string' || !value) throw new Error('Use an IANA timezone'); try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); } catch { throw new Error('Use an IANA timezone'); } }
export function httpURL(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use a credential-free HTTP(S) URL');
  return value;
}
export function allowedWindow(item, now = new Date()) {
  if (!item.window) return true;
  const { timezone: zone, start, end } = item.window;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const clock = ['hour', 'minute'].map(type => parts.find(p => p.type === type).value).join(':');
  return start < end ? start <= clock && clock < end : clock >= start || clock < end;
}
export function validateConfig(input) {
  keys(input, ['site', 'reports', 'hosts', 'endpoints', 'thresholds', 'backups', 'exclusions'], 'config.json');
  const siteKeys = ['brand', 'title', 'description', 'footer', 'prefix', 'badge', 'filesUrl', 'filesLabel', 'homeLabel', 'articlesDescription', 'incidentsDescription', 'healthDescription', 'healthIntro', 'reportsDescription', 'reportsIntro', 'directoryDescription', 'sitemapDescription'];
  for (const [key, allowed] of [['site', siteKeys], ['reports', ['prefix', 'timezone', 'weeklyKeep']], ['thresholds', ['memoryWarningPercent', 'diskWarningPercent', 'criticalPercent', 'loadPerCore', 'staleAfterMinutes']], ['backups', ['jobs', 'expectations']], ['exclusions', ['containers', 'endpoints', 'backups']]]) if (key in input) keys(input[key], allowed, key);
  const site = { brand: 'My lab', title: 'Lab reports', description: 'Lab reports and dashboard', footer: 'Private lab reports', prefix: '/', badge: 'Lab', filesUrl: '', filesLabel: 'Shared files', ...input.site };
  keys(site, siteKeys, 'site');
  if (Object.values(site).some(v => typeof v !== 'string')) throw new Error('Site settings must be text');
  if (site.filesUrl && !(site.filesUrl.startsWith('/') && !site.filesUrl.startsWith('//'))) httpURL(site.filesUrl);
  const reports = { prefix: 'lab', timezone: 'UTC', weeklyKeep: 2, ...input.reports };
  keys(reports, ['prefix', 'timezone', 'weeklyKeep'], 'reports');
  if (!safeID(reports.prefix) || !Number.isInteger(reports.weeklyKeep) || reports.weeklyKeep < 1 || reports.weeklyKeep > 100) throw new Error('Reports need a safe prefix and weeklyKeep from 1 to 100');
  timezone(reports.timezone);
  const thresholds = { memoryWarningPercent: 90, diskWarningPercent: 85, criticalPercent: 95, loadPerCore: 1.5, staleAfterMinutes: 90, ...input.thresholds };
  keys(thresholds, ['memoryWarningPercent', 'diskWarningPercent', 'criticalPercent', 'loadPerCore', 'staleAfterMinutes'], 'thresholds');
  if (!Object.values(thresholds).every(positive) || thresholds.criticalPercent > 100 || Math.max(thresholds.memoryWarningPercent, thresholds.diskWarningPercent) > thresholds.criticalPercent) throw new Error('Thresholds must be positive with ordered warning/critical percentages');
  const hosts = input.hosts ?? [], endpoints = input.endpoints ?? [];
  if (!Array.isArray(hosts) || !Array.isArray(endpoints)) throw new Error('Hosts and endpoints must be lists');
  for (const [items, allowed, label] of [[hosts, ['id', 'role', 'platform', 'ssh', 'port', 'optional', 'window'], 'host'], [endpoints, ['id', 'label', 'url', 'purpose', 'optional', 'window'], 'endpoint']]) {
    const ids = new Set();
    for (const item of items) {
      keys(item, allowed, label);
      if (!safeID(item.id) || ids.has(item.id)) throw new Error(`Unique safe ${label} IDs required`);
      ids.add(item.id);
      if (item.optional !== undefined && typeof item.optional !== 'boolean') throw new Error('Optional must be boolean');
      if (label === 'endpoint') httpURL(item.url);
      else {
        if (!['linux', 'macos', 'windows'].includes(item.platform ?? 'linux')) throw new Error('Host platform must be linux, macos or windows');
        if (item.ssh !== undefined && (typeof item.ssh !== 'string' || !/^(?:[A-Za-z0-9_.-]+@)?[A-Za-z0-9][A-Za-z0-9.:-]*$/.test(item.ssh))) throw new Error('SSH must be a host or user@host, not options');
        if (!Number.isInteger(item.port ?? 22) || (item.port ?? 22) < 1 || (item.port ?? 22) > 65535) throw new Error('SSH port must be 1–65535');
      }
      if (item.window) {
        keys(item.window, ['timezone', 'start', 'end'], 'window');
        timezone(item.window.timezone);
        if (!['start', 'end'].every(k => /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(item.window[k])) || item.window.start === item.window.end) throw new Error('Window needs distinct HH:MM start/end');
      }
    }
  }
  const backups = { jobs: [], expectations: [], ...input.backups };
  keys(backups, ['jobs', 'expectations'], 'backups');
  if (!Array.isArray(backups.jobs) || !Array.isArray(backups.expectations)) throw new Error('Backup jobs and expectations must be lists');
  const jobs = new Set(), targets = new Set(), names = new Set(hosts.map(h => h.id));
  for (const job of backups.jobs) {
    keys(job, ['id', 'host', 'unit', 'label', 'maxAgeHours', 'scope', 'offsite', 'receiptPath', 'completionMarker'], 'backup job');
    if (!safeID(job.id) || jobs.has(job.id) || !names.has(job.host) || !/^[A-Za-z0-9_.@-]+$/.test(job.unit ?? '') || !positive(job.maxAgeHours) || typeof job.label !== 'string' || typeof job.scope !== 'string' || typeof (job.offsite ?? false) !== 'boolean') throw new Error('Invalid or duplicate backup job');
    for (const key of ['receiptPath', 'completionMarker']) if (job[key] && (typeof job[key] !== 'string' || !job[key].startsWith('/') || job[key].split('/').includes('..') || /[\r\n\0]/.test(job[key]))) throw new Error('Backup evidence must be an explicit absolute host path');
    jobs.add(job.id);
  }
  for (const item of backups.expectations) {
    keys(item, ['target', 'jobs', 'note', 'needsOffsite'], 'backup expectation');
    if (typeof item.target !== 'string' || targets.has(item.target) || !names.has(item.target.split('/')[0]) || !Array.isArray(item.jobs) || item.jobs.some(j => !jobs.has(j)) || typeof item.note !== 'string' || typeof (item.needsOffsite ?? false) !== 'boolean') throw new Error('Invalid backup target or unknown job reference');
    targets.add(item.target);
  }
  const exclusions = { containers: {}, endpoints: {}, backups: {}, ...input.exclusions };
  keys(exclusions, ['containers', 'endpoints', 'backups'], 'exclusions');
  for (const mapping of Object.values(exclusions)) {
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) || Object.values(mapping).some(v => typeof v !== 'string' || !v.trim())) throw new Error('Exclusions map patterns to reasons');
  }
  return { site, reports, hosts, endpoints, thresholds, backups, exclusions };
}
export function loadConfig(path = runtimePath('CONFIG_FILE', 'config.json')) { return validateConfig(JSON.parse(readFileSync(path, 'utf8'))); }
export function readSnapshot(path = runtimePath('SNAPSHOT_FILE', 'state/observed.json')) {
  if (!existsSync(path)) return { observed_at: null, hosts: {}, endpoints: [] };
  const data = JSON.parse(readFileSync(path, 'utf8'));
  keys(data, ['observed_at', 'hosts', 'endpoints'], 'snapshot');
  if (data.observed_at && (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(data.observed_at) || !Number.isFinite(Date.parse(data.observed_at)))) throw new Error('Observation timestamp needs ISO timezone');
  if (!data.hosts || typeof data.hosts !== 'object' || Array.isArray(data.hosts) || !Array.isArray(data.endpoints)) throw new Error('Snapshot needs hosts and endpoints');
  for (const [name, host] of Object.entries(data.hosts)) {
    if (!safeID(name) || !host || typeof host !== 'object') throw new Error('Invalid snapshot host');
    const facts = host.facts ?? {};
    if (Object.values(facts).some(v => !Array.isArray(v) || v.some(x => typeof x !== 'string'))) throw new Error('Facts must be lists of text');
    host.facts = Object.fromEntries(Object.entries(facts).filter(([k]) => FACT_KEYS.has(k)));
    if (!Array.isArray(host.docker ?? []) || typeof (host.monitor ?? {}) !== 'object' || Array.isArray(host.monitor)) throw new Error('Invalid host observation');
  }
  for (const endpoint of data.endpoints) httpURL(endpoint.url);
  return data;
}
export function inputHash(env = environment()) {
  const entries = [];
  for (const key of ['CONFIG_FILE', 'SNAPSHOT_FILE', 'PREVIOUS_FILE']) if (env[key]) {
    const path = runtimePath(key, '', env);
    entries.push([key, path, existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null]);
  }
  return entries.length ? createHash('sha256').update(JSON.stringify(entries)).digest('hex') : '';
}
if (import.meta.main && process.argv[2] === '--hash') console.log(inputHash());
