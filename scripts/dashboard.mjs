// Pure dashboard rendering. Only the explicit collector performs network I/O.
import { createHash } from 'node:crypto';
import { validateConfig } from './config.mjs';
import { escape as e, number, timestamp, definition, matches, exclusion } from './html.mjs';

const rank = { bad: 0, warn: 1, unknown: 2, ok: 3, off: 4 };
const fact = (host, key, fallback = 'Unavailable') => host.facts?.[key]?.[0] ?? fallback;
const badge = label => `<span class="state-label">${e(label)}</span>`;
function indicator(title, state, label, body, meta = '', id = '') {
  return `<details class="indicator" data-state="${state}" id="${e(id)}"><summary><span class="indicator-title" title="${e(title)}">${e(title)}</span>${badge(label)}${meta ? `<span class="indicator-meta">${e(meta)}</span>` : ''}</summary><div class="detail-body">${body}</div></details>`;
}
export function hostMetrics(host) {
  const used = number(fact(host, 'memused')), total = number(fact(host, 'memtot'));
  const load = fact(host, 'load'), match = /^cpu (\d+(?:\.\d+)?%)$/.exec(load);
  const count = fact(host, 'containers'), disk = fact(host, 'rootuse');
  return [['RAM', used !== null && total ? `${(used / 1024).toFixed(1)} / ${(total / 1024).toFixed(1)} GiB` : 'Unavailable'], ['Root disk', number(disk) !== null ? disk : 'Unavailable'], [match ? 'CPU' : 'Load (1m)', match?.[1] ?? (number(load.split(' ')[0]) !== null ? load.split(' ')[0] : 'Unavailable')], ['Containers', count.startsWith('none (') ? 'Not used' : number(count) !== null ? count : 'Unavailable']];
}
function machine(name, host, state, label, note) {
  const metrics = host.collected ? hostMetrics(host).map(([k, v]) => `<span><span class="metric-label">${e(k)}</span><span class="metric-value">${e(v)}</span></span>`).join('') : '';
  const items = ['os', 'kernel', 'cpu', 'cores', 'board', 'uptime', 'load', 'swapused'].filter(k => fact(host, k) !== 'Unavailable').map(k => [['os', 'cpu', 'gpu'].includes(k) ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1), fact(host, k)]);
  for (const key of ['storage', 'gpu']) for (const value of host.facts?.[key] ?? []) items.push([key === 'gpu' ? 'GPU' : 'Storage', value]);
  const used = number(fact(host, 'memused')), total = number(fact(host, 'memtot')), journal = host.monitor?.journal ?? {};
  const bar = used !== null && total ? `<span class="bar" aria-hidden="true"><i style="width:${Math.min(100, Math.floor(used * 100 / total))}%"></i></span>` : '';
  const body = (note ? `<p>${e(note)}</p>` : '') + definition(items) + bar + definition([['System journal', journal.available ? `${journal.count} errors in ${journal.window_minutes ?? 30}m` : 'Not checked'], ['Failed units', Array.isArray(host.monitor?.failed_units) ? host.monitor.failed_units.join(', ') || 'None' : 'Not checked']]);
  return `<details class="machine" data-state="${state}" id="host-${e(name)}"><summary><strong>${e(name)}</strong>${badge(label)}<span class="role">${e(host.role ?? '')}</span><span class="machine-metrics">${metrics}</span></summary><div class="detail-body">${body}</div></details>`;
}
export function containerState(c, previous, ignored) {
  if (ignored) return ['off', 'Excluded', ignored];
  if (c.state !== 'running') {
    if (['restarting', 'dead'].includes(c.state) || c.oom || c.exit_code) return ['bad', (c.state ?? 'Down').replace(/^./, x => x.toUpperCase()), `Exit ${c.exit_code ?? 'unknown'}; OOM: ${c.oom ?? 'unknown'}`];
    return ['warn', 'Stopped', 'Not running; exclude this container if it is intentionally stopped'];
  }
  if (c.oom || c.health === 'unhealthy') return ['bad', 'Unhealthy', 'Docker reports an unhealthy state or OOM kill'];
  if (c.id && c.id === previous?.id && number(c.restarts) !== null && number(previous.restarts) !== null && c.restarts > previous.restarts) return ['warn', 'Restarted', `Restarts increased ${previous.restarts} → ${c.restarts} since the previous observation`];
  if (c.health === 'starting') return ['warn', 'Starting', 'Docker healthcheck has not passed yet'];
  if (c.health === 'healthy') return ['ok', 'Healthy', 'Docker healthcheck passed; not an end-to-end acceptance test'];
  return ['unknown', 'Running', 'health' in c ? 'No Docker healthcheck' : 'Detailed container checks unavailable'];
}
export function backupState(job, host, now) {
  const status = host.monitor?.backups?.[job.unit];
  if (!status) return ['unknown', 'No evidence', null, {}];
  const last = timestamp(status.last_success), age = last ? (now - last) / 3600000 : null;
  let state = 'ok', label = 'Succeeded';
  if (![null, undefined, 'success'].includes(status.result) || ![null, undefined, 0, '0'].includes(status.exit_code)) [state, label] = ['bad', 'Failed'];
  else if (age !== null && age < -0.1) [state, label] = ['unknown', 'Clock mismatch'];
  else if (age === null) [state, label] = ['unknown', 'No success receipt'];
  else if (age > job.maxAgeHours) [state, label] = ['warn', 'Overdue'];
  else if (status.timer_drift) [state, label] = ['warn', 'Timer drift'];
  else if (![null, undefined, 'active'].includes(status.timer_active)) [state, label] = ['warn', 'Timer off'];
  else if (['activating', 'active'].includes(status.active)) [state, label] = ['unknown', 'Running'];
  return [state, label, age, status];
}
export function renderDashboard(snapshot, input, previous = {}, now = new Date(), backupGuide = null) {
  const policy = validateConfig(input), thresholds = policy.thresholds;
  const alerts = [], machines = [], endpoints = [], backups = [], groups = new Map();
  const hosts = Object.fromEntries(policy.hosts.map(item => [item.id, { ...snapshot.hosts?.[item.id], role: item.role ?? '', platform: item.platform ?? 'linux', optional: item.optional ?? false }]));
  const candidates = Object.keys(hosts).concat(Object.entries(hosts).flatMap(([name, h]) => (h.docker ?? []).map(c => name + '/' + c.name)));
  const expectations = policy.backups.expectations.flatMap(item => {
    const targets = candidates.filter(target => matches(item.target, target));
    return (targets.length ? targets : [item.target]).map(target => ({ ...item, target }));
  });
  if (new Set(expectations.map(item => item.target)).size !== expectations.length) throw new Error('Backup expectation patterns overlap; use one definition per target');
  const alert = (state, title, scope, detail, target = '') => alerts.push({ state, title, scope, detail, target });
  const observed = timestamp(snapshot.observed_at), age = observed ? (now - observed) / 60000 : null;
  if (age !== null && (age > thresholds.staleAfterMinutes || age < -5)) alert('unknown', 'Observation is stale or clock is ahead', 'Collection', 'Do not treat this snapshot as current. Check collection.');
  for (const [name, host] of Object.entries(hosts)) {
    let state = 'ok', label = 'Online', note = '';
    if (!host.collected) {
      const optional = host.optional || host.skipped;
      const sampled = Object.hasOwn(snapshot.hosts ?? {}, name);
      [state, label] = !observed || !sampled ? ['unknown', 'Not collected'] : optional ? ['off', 'Not probed'] : ['bad', 'Unreachable'];
      note = host.note || 'Facts unavailable. Container, log and backup status are unknown.';
      if (!optional && observed) alert(sampled ? 'bad' : 'unknown', sampled ? 'Host unreachable' : 'Host not collected', name, note, 'host-' + name);
    } else {
      const used = number(fact(host, 'memused')), total = number(fact(host, 'memtot'));
      const resources = [['RAM usage', used !== null && total ? used * 100 / total : null, thresholds.memoryWarningPercent], ['Root disk usage', number(fact(host, 'rootuse')), thresholds.diskWarningPercent]];
      for (const value of host.facts?.storage ?? []) {
        const match = /\((\d+)% used\)/.exec(value);
        if (match) resources.push([value.split('|')[0] + ' disk usage', Number(match[1]), thresholds.diskWarningPercent]);
      }
      for (const [resource, value, warning] of resources) if (value !== null && value >= warning) {
        const severity = value >= thresholds.criticalPercent ? 'bad' : 'warn';
        if (rank[severity] < rank[state]) [state, label] = [severity, 'Attention'];
        alert(severity, `${resource} ${value.toFixed(0)}%`, name, `Observed ${value.toFixed(1)}%; review at ${warning}%, critical at ${thresholds.criticalPercent}%.`, 'host-' + name);
      }
      const load = fact(host, 'load').split(' '), cores = number(fact(host, 'cores'));
      if (load.length === 3 && number(load[2]) !== null && cores && Number(load[2]) / cores >= thresholds.loadPerCore) {
        if (state !== 'bad') [state, label] = ['warn', 'Attention'];
        alert('warn', 'High 15-minute load', name, `Load ${load[2]} across ${cores} threads. Load is not CPU utilization.`, 'host-' + name);
      }
      const monitor = host.monitor ?? {}, journal = monitor.journal ?? {};
      if (host.platform === 'linux') {
        if (journal.available && journal.count) alert('warn', `${journal.limited ? '≥' : ''}${journal.count} recent system-log error${journal.count === 1 ? '' : 's'}`, name, `Past ${journal.window_minutes ?? 30} minutes; units: ${(journal.units ?? []).join(', ')}. Log text stays on the host; review journalctl --since "30 minutes ago" -p err. Docker stdout is not inspected.`, 'host-' + name);
        else if (!journal.available) alert('unknown', 'System logs not checked', name, 'Journal read was unavailable or timed out; absence of evidence is not a clean log check.', 'host-' + name);
        if (monitor.failed_units?.length) alert('warn', `${monitor.failed_units.length} failed system unit${monitor.failed_units.length === 1 ? '' : 's'}`, name, monitor.failed_units.join(', '), 'host-' + name);
        if ((journal.available && journal.count) || monitor.failed_units?.length) if (state !== 'bad') [state, label] = ['warn', 'Attention'];
        if (fact(host, 'containers') === 'unavailable') alert('unknown', 'Docker inventory unavailable', name, 'Check Docker and collector access; no container health claim is available.');
        else if (monitor.container_checks_available === false) alert('unknown', 'Container checks unavailable', name, 'Detailed health and restart checks failed or timed out.');
      }
    }
    machines.push(machine(name, host, state, label, note));
    const old = new Map((previous.hosts?.[name]?.docker ?? []).map(c => [c.name, c])), group = [];
    for (const c of host.docker ?? []) {
      const target = name + '/' + c.name, [severity, health, reason] = containerState(c, old.get(c.name), exclusion(policy.exclusions.containers, target));
      const id = 'container-' + target.replace(/[^A-Za-z0-9_-]/g, '-') + '-' + createHash('sha256').update(target).digest('hex').slice(0, 8);
      const expected = expectations.find(x => x.target === target);
      const coverage = exclusion(policy.exclusions.backups, target) || (expected ? expected.jobs.join(', ') || 'Coverage unverified' : 'Not assessed; add to backup expectations if stateful');
      const body = `<p>${e(reason)}</p>` + definition([['Container', c.name], ['State', c.status ?? c.state ?? 'Unknown'], ['Image', c.image ?? 'Unknown'], ['Healthcheck', c.health || 'None / unavailable'], ['Restarts (lifetime)', c.restarts ?? 'Unknown'], ['Exit code', c.exit_code ?? 'Unknown'], ['OOM killed', c.oom ?? 'Unknown'], ['Started', c.started_at ?? 'Unknown'], ['Backup scope', coverage]]);
      group.push({ state: severity, name: c.name, html: indicator(c.name, severity, health, body, '', id) });
      if (['bad', 'warn'].includes(severity)) alert(severity, c.name + ' · ' + health.toLowerCase(), name, reason, id);
    }
    groups.set(name, group.sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name)));
  }
  for (const [index, item] of policy.endpoints.entries()) {
    const row = { ...item, ...snapshot.endpoints?.find(x => x.id === item.id) }, code = String(row.status ?? 'not collected'), title = item.label ?? item.id;
    const ignored = exclusion(policy.exclusions.endpoints, item.id), latency = row.latency ?? '—';
    const [state, label] = ignored || ['off', 'not probed'].includes(code) ? ['off', 'Not monitored'] : code === 'not collected' ? ['unknown', 'Not collected'] : /^[23]/.test(code) ? ['ok', 'Responding'] : code === '000' || code.startsWith('5') ? ['bad', 'Down'] : ['warn', 'Review'];
    const body = definition([['URL', item.url], ['Purpose', item.purpose ?? ''], ['HTTP sample', code], ['Latency', latency], ['Scope', ignored || 'HTTP reachability only; not an inference or authentication acceptance test']]) + `<p><a href="${e(item.url)}">Open endpoint</a></p>`;
    const id = 'endpoint-' + index;
    endpoints.push({ state, name: title, html: indicator(title, state, label, body, state !== 'off' ? latency : '', id) });
    if (['bad', 'warn'].includes(state)) alert(state, title + ' · ' + (state === 'bad' ? 'unreachable' : `HTTP ${code}`), 'Endpoint', (item.purpose ?? '') + '. Response: ' + code + '.', id);
  }
  const jobs = new Map();
  for (const job of policy.backups.jobs) {
    const [state, label, age, status] = backupState(job, hosts[job.host] ?? {}, now), meta = age === null ? 'Last success unknown' : `Last success ${Math.max(0, age).toFixed(0)}h ago`, id = 'backup-' + job.id;
    jobs.set(job.id, state);
    const body = definition([['Last success', status.last_success || 'Unknown'], ['Latest run', status.last_run || 'Unknown'], ['Result / exit', (status.result ?? 'Unknown') + ' / ' + (status.exit_code ?? 'Unknown')], ['Timer', status.timer_active || 'Unknown'], ['Definition drift', status.timer_drift ?? 'Unknown'], ['Evidence', status.evidence ?? 'Unavailable'], ['Review after', `${job.maxAgeHours} hours`], ['Coverage', job.scope], ['Restore test', 'Not verified by this check']]);
    backups.push(indicator(job.label, state, label, body, meta, id));
    if (state !== 'ok') alert(state, job.label + ' · ' + label.toLowerCase(), 'Backup', job.scope + '. ' + meta + '.', id);
  }
  const gaps = [], covered = [], excluded = [];
  for (const item of expectations) {
    const reason = exclusion(policy.exclusions.backups, item.target), body = item.note + ' · ' + (item.jobs.join(', ') || 'No monitored job');
    if (reason) excluded.push([item.target, reason]);
    else if (!item.jobs.length) gaps.push([item.target, body]);
    else if (item.jobs.some(job => jobs.get(job) !== 'ok')) gaps.push([item.target, body + ' · Backup evidence needs review']);
    else covered.push([item.target, body]);
    if (item.needsOffsite && !reason && !policy.backups.jobs.some(job => job.offsite && item.jobs.includes(job.id))) gaps.push([item.target + ' · off-host', item.note]);
  }
  excluded.push(...Object.entries(policy.exclusions.backups));
  let coverage = gaps.length ? '<h3>Needs review</h3>' + definition(gaps) : '<p>No configured coverage gaps.</p>';
  coverage += '<h3>Configured coverage</h3>' + definition(covered) + '<h3>Excluded</h3>' + definition(excluded) + (backupGuide ? `<p><a href="${e(backupGuide)}">Backup scope and recovery</a></p>` : '');
  backups.push(indicator('Coverage', gaps.length ? 'warn' : expectations.length ? 'ok' : 'unknown', gaps.length ? `${gaps.length} gaps` : expectations.length ? 'Configured' : 'Not assessed', coverage, `${covered.length} targets configured`, 'backup-coverage'));
  if (gaps.length) alert('warn', `${gaps.length} backup coverage gaps`, 'Coverage', gaps.map(([target, note]) => target + ': ' + note).join('; '), 'backup-coverage');
  alerts.sort((a, b) => rank[a.state] - rank[b.state] || a.scope.localeCompare(b.scope) || a.title.localeCompare(b.title));
  const alertHTML = row => `<details class="alert-item" data-state="${row.state}"><summary><strong class="alert-title">${e(row.title)}</strong><span class="alert-scope">${e(row.scope)}</span>${badge(row.state === 'bad' ? 'Issue' : row.state === 'warn' ? 'Review' : 'Unknown')}</summary><div class="detail-body"><p>${e(row.detail)}</p>${row.target ? `<p><a href="#${e(row.target)}">View indicator</a></p>` : ''}</div></details>`;
  const hasObservations = observed && (Object.keys(hosts).length || policy.endpoints.length);
  let attention = alerts.slice(0, 6).map(alertHTML).join('') || `<p class="empty-state">${hasObservations ? 'No issues in checked signals.' : 'No observations yet. Configure collection to see lab health.'}</p>`;
  if (alerts.length > 6) attention += `<details class="more-alerts"><summary>${alerts.length - 6} more items</summary><div class="alert-list detail-body">${alerts.slice(6).map(alertHTML).join('')}</div></details>`;
  const hostValues = Object.values(hosts), allContainers = hostValues.flatMap(h => h.docker ?? []);
  const overview = [['Needs attention', alerts.length, 'attention'], ['Hosts online', `${hostValues.filter(h => h.collected).length}/${hostValues.filter(h => !(h.skipped || h.optional && !h.collected)).length}`, 'hosts'], ['Endpoints responding', `${endpoints.filter(r => r.state === 'ok').length}/${endpoints.filter(r => r.state !== 'off').length}`, 'endpoints'], ['Containers running', allContainers.filter(c => c.state === 'running').length, 'containers'], ['Backup jobs passing', `${[...jobs.values()].filter(s => s === 'ok').length}/${jobs.size}`, 'backups']];
  const attentionState = alerts[0]?.state ?? (hasObservations ? 'ok' : 'unknown');
  const section = (id, title, content, count = '') => `<section class="dashboard-section" id="${id}"><div class="section-heading"><h2>${title}</h2><small>${e(count)}</small></div>${content}</section>`;
  let body = `<div class="status dashboard"><header class="dashboard-head"><h1>Lab dashboard</h1><time class="snapshot-time" id="snapshot-time" datetime="${observed?.toISOString() ?? ''}" data-stale-minutes="${thresholds.staleAfterMinutes}">${e(snapshot.observed_at || 'Not collected')}</time></header><p id="snapshot-stale" class="snapshot-warning" hidden>Snapshot is stale. Check collection.</p>`;
  body += '<div class="overview-strip">' + overview.map(([label, value, id]) => `<a class="overview-item" href="#${id}"${id === 'attention' ? ` data-state="${attentionState}"` : ''}><span class="overview-value">${e(value)}</span><span class="overview-label">${e(label)}</span></a>`).join('') + '</div>';
  body += section('attention', 'Needs attention', '<div class="alert-list">' + attention + '</div>', `${alerts.length} items`);
  body += section('hosts', 'Hosts', '<div class="grid">' + machines.join('') + '</div>');
  body += section('endpoints', 'Endpoints', '<div class="indicator-grid">' + endpoints.sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name)).map(r => r.html).join('') + '</div>');
  const containerGroups = Object.entries(hosts).map(([name, host]) => {
    const group = groups.get(name), active = group.filter(row => row.state !== 'off'), off = group.filter(row => row.state === 'off');
    let content = active.length ? '<div class="indicator-grid">' + active.map(r => r.html).join('') + '</div>' : '';
    if (off.length) content += `<details class="excluded-containers"><summary>Excluded containers (${off.length})</summary><div class="indicator-grid">${off.map(r => r.html).join('')}</div></details>`;
    if (!group.length) content = `<p class="empty-state">${host.skipped ? 'Not probed' : !host.collected || fact(host, 'containers') === 'unavailable' ? 'Docker inventory unavailable' : 'No Docker containers'}</p>`;
    return `<div class="container-group"><h3 class="group-heading">${e(name)} <small>${group.length} containers</small></h3>${content}</div>`;
  }).join('');
  body += section('containers', 'Containers', containerGroups, 'Running ≠ healthy');
  body += section('backups', 'Backups', '<div class="indicator-grid">' + backups.join('') + '</div>', 'Success ≠ verified restore');
  return body + '<div class="dashboard-links"><a href="/docs/inventory/observed.html">Full inventory</a>' + (backupGuide ? `<a href="${e(backupGuide)}">Backup guide</a>` : '') + '<a href="/docs/">Lab guide</a></div><script type="module" src="/assets/status.js"></script></div>';
}
