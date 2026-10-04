#!/usr/bin/env python3
"""Render a static, drill-down lab dashboard from the collector's safe inventory."""
import argparse
import base64
from datetime import datetime, timezone
from fnmatch import fnmatchcase
from html import escape
import json
import hashlib
import math
from pathlib import Path
import re

RANK = {'bad': 0, 'warn': 1, 'unknown': 2, 'ok': 3, 'off': 4}


def e(value):
    return escape(str(value), quote=True)


def number(value):
    try:
        result = float(str(value).removesuffix('%'))
        return result if math.isfinite(result) and result >= 0 else None
    except (ValueError, TypeError):
        return None


def timestamp(value):
    try:
        dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return dt if dt.tzinfo else None
    except ValueError:
        return None


def fact(host, key, default='Unavailable'):
    values = host.get('facts', {}).get(key, [])
    return values[0] if values else default


def definition(items):
    return '<dl>' + ''.join(f'<dt>{e(k)}</dt><dd>{e(v)}</dd>' for k, v in items) + '</dl>'


def badge(state, label):
    return f'<span class="state-label">{e(label)}</span>'


def indicator(title, state, label, body, meta='', identifier=''):
    return f'<details class="indicator" data-state="{state}" id="{e(identifier)}"><summary><span class="indicator-title" title="{e(title)}">{e(title)}</span>{badge(state, label)}' + (f'<span class="indicator-meta">{e(meta)}</span>' if meta else '') + f'</summary><div class="detail-body">{body}</div></details>'


def exclusion(mapping, target):
    return next((reason for pattern, reason in mapping.items() if fnmatchcase(target, pattern)), None)


def host_metrics(host):
    used, total = number(fact(host, 'memused')), number(fact(host, 'memtot'))
    ram = f'{used/1024:.1f} / {total/1024:.1f} GiB' if used is not None and total else 'Unavailable'
    load = fact(host, 'load')
    match = re.fullmatch(r'cpu (\d+(?:\.\d+)?%)', load)
    label = 'CPU' if match else 'Load (1m)'
    parts = load.split()
    activity = match[1] if match else parts[0] if parts and number(parts[0]) is not None else 'Unavailable'
    count = fact(host, 'containers')
    if count.startswith('none ('):
        count = 'Not used'
    elif number(count) is None:
        count = 'Unavailable'
    disk = fact(host, 'rootuse')
    return [('RAM', ram), ('Root disk', disk if number(disk) is not None else 'Unavailable'), (label, activity), ('Containers', count)]


def machine(name, host, state, label, note=''):
    metrics = ''.join(f'<span><span class="metric-label">{e(k)}</span><span class="metric-value">{e(v)}</span></span>' for k, v in host_metrics(host)) if host.get('collected') else ''
    items = [(k.upper() if k in ('os', 'cpu', 'gpu') else k.title(), fact(host, k)) for k in ('os', 'kernel', 'cpu', 'cores', 'board', 'uptime', 'load', 'swapused') if fact(host, k) != 'Unavailable']
    items += [(key.title(), value) for key in ('storage', 'gpu') for value in host.get('facts', {}).get(key, [])]
    used, total = number(fact(host, 'memused')), number(fact(host, 'memtot'))
    bar = f'<span class="bar" aria-hidden="true"><i style="width:{min(100, int(used*100/total))}%"></i></span>' if used is not None and total else ''
    body = (f'<p>{e(note)}</p>' if note else '') + definition(items) + bar
    monitor = host.get('monitor', {})
    journal = monitor.get('journal', {})
    body += definition([('System journal', f'{journal.get("count")} errors in {journal.get("window_minutes", 30)}m' if journal.get('available') else 'Not checked'), ('Failed units', ', '.join(monitor['failed_units']) or 'None' if monitor.get('failed_units') is not None else 'Not checked')])
    return f'<details class="machine" data-state="{state}" id="host-{e(name)}"><summary><strong>{e(name)}</strong>{badge(state, label)}<span class="role">{e(host.get("role", ""))}</span><span class="machine-metrics">{metrics}</span></summary><div class="detail-body">{body}</div></details>'


def container_state(c, previous, ignored):
    if ignored:
        return 'off', 'Excluded', ignored
    if c.get('state') != 'running':
        if c.get('state') in ('restarting', 'dead') or c.get('oom') or c.get('exit_code', 0):
            return 'bad', c.get('state', 'Down').title(), f'Exit {c.get("exit_code", "unknown")}; OOM: {c.get("oom", "unknown")}'
        return 'warn', 'Stopped', 'Not running; exclude this container if it is intentionally stopped'
    if c.get('oom') or c.get('health') == 'unhealthy':
        return 'bad', 'Unhealthy', 'Docker reports an unhealthy state or OOM kill'
    if c.get('id') and previous and c.get('id') == previous.get('id') and number(c.get('restarts')) is not None and number(previous.get('restarts')) is not None and c['restarts'] > previous['restarts']:
        return 'warn', 'Restarted', f'Restarts increased {previous["restarts"]} → {c["restarts"]} since the previous observation'
    if c.get('health') == 'starting':
        return 'warn', 'Starting', 'Docker healthcheck has not passed yet'
    if c.get('health') == 'healthy':
        return 'ok', 'Healthy', 'Docker healthcheck passed; not an end-to-end acceptance test'
    return 'unknown', 'Running', 'No Docker healthcheck' if 'health' in c else 'Detailed container checks unavailable'


def backup_state(job, host, now):
    status = host.get('monitor', {}).get('backups', {}).get(job['unit'])
    if not status:
        return 'unknown', 'No evidence', None, {}
    last = timestamp(status.get('last_success'))
    age = (now - last).total_seconds() / 3600 if last else None
    if status.get('result') not in (None, 'success') or status.get('exit_code') not in (None, '0', 0):
        return 'bad', 'Failed', age, status
    if age is not None and age < -0.1:
        return 'unknown', 'Clock mismatch', age, status
    if age is None:
        return 'unknown', 'No success receipt', None, status
    if age > job['max_age_hours']:
        return 'warn', 'Overdue', age, status
    if status.get('timer_drift'):
        return 'warn', 'Timer drift', age, status
    if status.get('timer_active') not in (None, 'active'):
        return 'warn', 'Timer off', age, status
    if status.get('active') in ('activating', 'active'):
        return 'unknown', 'Running', age, status
    return 'ok', 'Succeeded', age, status


def validate_policy(policy):
    names = {host['id'] for host in policy.get('hosts', [])}
    defaults = {'memory_warning_percent': 90, 'disk_warning_percent': 85, 'critical_percent': 95, 'load_per_core': 1.5, 'stale_after_minutes': 90}
    thresholds = {**defaults, **policy.get('thresholds', {})}
    if set(thresholds) != set(defaults) or any(not isinstance(v, (int, float)) or isinstance(v, bool) or number(v) is None or float(v) <= 0 for v in thresholds.values()):
        raise ValueError('Dashboard thresholds must be positive numbers')
    if not (thresholds['memory_warning_percent'] <= thresholds['critical_percent'] <= 100 and thresholds['disk_warning_percent'] <= thresholds['critical_percent']):
        raise ValueError('Warning/critical thresholds must be ordered percentages')
    ids = set()
    for job in policy.get('backup_jobs', []):
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', job['id']) or job['id'] in ids or job['host'] not in names or not re.fullmatch(r'[a-zA-Z0-9_.@-]+', job['unit']) or not isinstance(job['max_age_hours'], (int, float)) or not number(job['max_age_hours']) or not isinstance(job.get('offsite', False), bool):
            raise ValueError('Invalid or duplicate backup job')
        ids.add(job['id'])
    targets = set()
    for item in policy.get('backup_expectations', []):
        if item['target'] in targets or item['target'].split('/')[0] not in names or not isinstance(item['jobs'], list) or any(job not in ids for job in item['jobs']) or not isinstance(item.get('needs_offsite', False), bool):
            raise ValueError('Duplicate backup target or unknown job reference')
        targets.add(item['target'])
    for key in ('container_exclusions', 'endpoint_exclusions', 'backup_exclusions'):
        if not isinstance(policy.get(key, {}), dict):
            raise ValueError(f'{key} must map a target/pattern to a reason')
    return thresholds


def render(snapshot, policy, previous=None, now=None):
    thresholds = validate_policy(policy)
    now = now or datetime.now(timezone.utc)
    previous = previous or {}
    alerts, machines, containers, endpoints, backups = [], [], [], [], []
    groups = {}
    hosts = {item['id']: {**snapshot.get('hosts', {}).get(item['id'], {}),
                         'role': item.get('role', ''), 'platform': item.get('platform', 'linux'),
                         'optional': item.get('optional', False)} for item in policy.get('hosts', [])}
    candidates = list(hosts) + [name + '/' + c['name'] for name, host in hosts.items() for c in host.get('docker', [])]
    expectations = []
    for item in policy.get('backup_expectations', []):
        matched = [target for target in candidates if fnmatchcase(target, item['target'])]
        expectations.extend({**item, 'target': target} for target in matched or [item['target']])
    if len({item['target'] for item in expectations}) != len(expectations):
        raise ValueError('Backup expectation patterns overlap; use one definition per target')
    def alert(state, title, scope, detail, target=''):
        alerts.append((state, title, scope, detail, target))
    observed = timestamp(snapshot.get('observed_at'))
    age_minutes = (now-observed).total_seconds()/60 if observed else None
    if age_minutes is not None and (age_minutes > thresholds['stale_after_minutes'] or age_minutes < -5):
        alert('unknown', 'Observation is stale or clock is ahead', 'Collection', 'Do not treat this snapshot as current. Check the scheduled reports-source refresh.')
    for name, host in hosts.items():
        state, label, note = 'ok', 'Online', ''
        if not host.get('collected'):
            optional = host.get('optional') or host.get('skipped')
            state, label = ('unknown', 'Not collected') if not observed else ('off', 'Not probed') if optional else ('bad', 'Unreachable')
            note = host.get('note', '') or 'Facts unavailable. Container, log and backup status are unknown.'
            if not optional and observed:
                alert('bad', 'Host unreachable', name, note, 'host-' + name)
        else:
            used, total = number(fact(host, 'memused')), number(fact(host, 'memtot'))
            disk = number(fact(host, 'rootuse'))
            resources = [('RAM usage', used*100/total if used is not None and total else None, thresholds['memory_warning_percent'])]
            resources += [('Root disk usage', disk, thresholds['disk_warning_percent'])]
            for value in host.get('facts', {}).get('storage', []):
                match = re.search(r'\((\d+)% used\)', value)
                if match:
                    resources.append((value.split('|')[0] + ' disk usage', float(match[1]), thresholds['disk_warning_percent']))
            for resource, value, warning in resources:
                if value is not None and value >= warning:
                    severity = 'bad' if value >= thresholds['critical_percent'] else 'warn'
                    if RANK[severity] < RANK[state]: state, label = severity, 'Attention'
                    alert(severity, f'{resource} {value:.0f}%', name, f'Observed {value:.1f}%; review at {warning}%, critical at {thresholds["critical_percent"]}%.', 'host-' + name)
            load, cores = fact(host, 'load').split(), number(fact(host, 'cores'))
            if len(load) == 3 and number(load[2]) is not None and cores and float(load[2])/cores >= thresholds['load_per_core']:
                if state != 'bad': state, label = 'warn', 'Attention'
                alert('warn', 'High 15-minute load', name, f'Load {load[2]} across {cores:g} threads. Load is not CPU utilization.', 'host-' + name)
            monitor = host.get('monitor', {})
            if host.get('platform') == 'linux':
                journal = monitor.get('journal', {})
                if journal.get('available') and journal.get('count', 0):
                    count = f'≥{journal["count"]}' if journal.get('limited') else str(journal['count'])
                    alert('warn', f'{count} recent system-log error' + ('s' if journal['count'] != 1 else ''), name, f'Past {journal.get("window_minutes",30)} minutes; units: {", ".join(journal.get("units", []))}. Log text is kept on the host; review journalctl --since "30 minutes ago" -p err. Docker stdout is not inspected by this check.', 'host-' + name)
                elif not journal.get('available'):
                    alert('unknown', 'System logs not checked', name, 'Journal read was unavailable or timed out; absence of evidence is not a clean log check.', 'host-' + name)
                if monitor.get('failed_units'):
                    count = len(monitor['failed_units'])
                    alert('warn', f'{count} failed system unit' + ('s' if count != 1 else ''), name, ', '.join(monitor['failed_units']), 'host-' + name)
                if (journal.get('available') and journal.get('count', 0)) or monitor.get('failed_units'):
                    if state != 'bad': state, label = 'warn', 'Attention'
                if fact(host, 'containers') == 'unavailable':
                    alert('unknown', 'Docker inventory unavailable', name, 'Check Docker and collector access; no container health claim is available.')
                elif monitor.get('container_checks_available') is False:
                    alert('unknown', 'Container checks unavailable', name, 'Docker inventory was read, but detailed health and restart checks failed or timed out.')
        machines.append(machine(name, host, state, label, note))
        old = {c['name']: c for c in previous.get('hosts', {}).get(name, {}).get('docker', [])}
        group = []
        for c in host.get('docker', []):
            target = name + '/' + c['name']
            ignored = exclusion(policy.get('container_exclusions', {}), target)
            severity, health, reason = container_state(c, old.get(c['name']), ignored)
            identifier = 'container-' + re.sub(r'[^a-zA-Z0-9_-]', '-', target) + '-' + hashlib.sha256(target.encode()).hexdigest()[:8]
            expected = next((x for x in expectations if x['target'] == target), None)
            coverage = exclusion(policy.get('backup_exclusions', {}), target) or (', '.join(expected['jobs']) or 'Coverage unverified' if expected else 'Not assessed; add to backup expectations if stateful')
            body = f'<p>{e(reason)}</p>' + definition([('Container', c['name']), ('State', c.get('status', c.get('state', 'Unknown'))), ('Image', c.get('image', 'Unknown')), ('Healthcheck', c.get('health') or 'None / unavailable'), ('Restarts (lifetime)', c.get('restarts', 'Unknown')), ('Exit code', c.get('exit_code', 'Unknown')), ('OOM killed', c.get('oom', 'Unknown')), ('Started', c.get('started_at', 'Unknown')), ('Backup scope', coverage)])
            group.append((severity, c['name'], indicator(c['name'], severity, health, body, identifier=identifier)))
            if severity in ('bad', 'warn'):
                alert(severity, c['name'] + ' · ' + health.lower(), name, reason, identifier)
        group.sort(key=lambda row: (RANK[row[0]], row[1]))
        containers += group
        groups[name] = group
    for index, row in enumerate(snapshot.get('endpoints', [])):
        target, purpose, code, latency = row['id'], row.get('purpose', ''), str(row['status']), row.get('latency', '—')
        ignored = exclusion(policy.get('endpoint_exclusions', {}), target)
        if ignored or code in ('off', 'not probed'):
            state, label = 'off', 'Not monitored'
        elif code.startswith(('2', '3')):
            state, label = 'ok', 'Responding'
        elif code == '000' or code.startswith('5'):
            state, label = 'bad', 'Down'
        else:
            state, label = 'warn', 'Review'
        title, url = row.get('label', target), row['url']
        body = definition([('URL', url), ('Purpose', purpose), ('HTTP sample', code), ('Latency', latency), ('Scope', ignored or 'HTTP reachability only; not an inference or authentication acceptance test')])
        body += f'<p><a href="{e(url)}">Open endpoint</a></p>'
        identifier = f'endpoint-{index}'
        endpoints.append((state, title, indicator(title, state, label, body, latency if state != 'off' else '', identifier)))
        if state in ('bad', 'warn'):
            alert(state, title + ' · ' + ('unreachable' if state == 'bad' else f'HTTP {code}'), 'Endpoint', purpose + '. Response: ' + code + '.', identifier)
    jobs = {}
    for job in policy.get('backup_jobs', []):
        state, label, age, status = backup_state(job, hosts.get(job['host'], {}), now)
        jobs[job['id']] = state
        meta = 'Last success unknown' if age is None else f'Last success {max(0, age):.0f}h ago'
        identifier = 'backup-' + job['id']
        body = definition([('Last success', status.get('last_success') or 'Unknown'), ('Latest run', status.get('last_run') or 'Unknown'), ('Result / exit', str(status.get('result', 'Unknown')) + ' / ' + str(status.get('exit_code', 'Unknown'))), ('Timer', status.get('timer_active') or 'Unknown'), ('Definition drift', status.get('timer_drift', 'Unknown')), ('Evidence', status.get('evidence', 'Unavailable')), ('Review after', f'{job["max_age_hours"]} hours'), ('Coverage', job['scope']), ('Restore test', 'Not verified by this check')])
        backups.append(indicator(job['label'], state, label, body, meta, identifier))
        if state not in ('ok',):
            alert(state, job['label'] + ' · ' + label.lower(), 'Backup', job['scope'] + '. ' + meta + '.', identifier)
    gaps, covered, excluded = [], [], []
    for item in expectations:
        reason = exclusion(policy.get('backup_exclusions', {}), item['target'])
        body = item['note'] + ' · ' + (', '.join(item['jobs']) or 'No monitored job')
        if reason:
            excluded.append((item['target'], reason))
        elif not item['jobs']:
            gaps.append((item['target'], body))
        elif any(jobs.get(job) != 'ok' for job in item['jobs']):
            gaps.append((item['target'], body + ' · Backup evidence needs review'))
        else:
            covered.append((item['target'], body))
    # Configured local-only protection is explicitly not off-host coverage.
    for item in expectations:
        if item.get('needs_offsite') and not exclusion(policy.get('backup_exclusions', {}), item['target']):
            if not any(job.get('offsite') and job['id'] in item['jobs'] for job in policy.get('backup_jobs', [])):
                gaps.append((item['target'] + ' · off-host', item['note']))
    excluded += list(policy.get('backup_exclusions', {}).items())
    coverage_body = '<h3>Needs review</h3>' + definition(gaps) if gaps else '<p>No configured coverage gaps.</p>'
    coverage_body += '<h3>Configured coverage</h3>' + definition(covered) + '<h3>Excluded</h3>' + definition(excluded) + '<p><a href="/docs/services/backups.html">Backup scope and recovery</a></p>'
    backups.append(indicator('Coverage', 'warn' if gaps else 'ok' if expectations else 'unknown', f'{len(gaps)} gaps' if gaps else 'Configured' if expectations else 'Not assessed', coverage_body, f'{len(covered)} targets configured', 'backup-coverage'))
    if gaps:
        alert('warn', f'{len(gaps)} backup coverage gaps', 'Coverage', '; '.join(target + ': ' + note for target, note in gaps), 'backup-coverage')
    alerts.sort(key=lambda row: (RANK[row[0]], row[2], row[1]))
    def alert_html(row):
        state, title, scope, detail, target = row
        link = f'<p><a href="#{e(target)}">View indicator</a></p>' if target else ''
        return f'<details class="alert-item" data-state="{state}"><summary><strong class="alert-title">{e(title)}</strong><span class="alert-scope">{e(scope)}</span>{badge(state, "Issue" if state == "bad" else "Review" if state == "warn" else "Unknown")}</summary><div class="detail-body"><p>{e(detail)}</p>{link}</div></details>'
    alert_content = ''.join(alert_html(row) for row in alerts[:6]) or ('<p class="empty-state">No issues in checked signals.</p>' if observed and (hosts or snapshot.get('endpoints')) else '<p class="empty-state">No observations yet. Configure collection to see lab health.</p>')
    if len(alerts) > 6:
        alert_content += f'<details class="more-alerts"><summary>{len(alerts)-6} more items</summary><div class="alert-list detail-body">' + ''.join(alert_html(row) for row in alerts[6:]) + '</div></details>'
    online = sum(h.get('collected', False) for h in hosts.values())
    host_total = sum(not (host.get('skipped') or host.get('optional') and not host.get('collected')) for host in hosts.values())
    endpoint_ok = sum(row[0] == 'ok' for row in endpoints)
    endpoint_total = sum(row[0] != 'off' for row in endpoints)
    running = sum(c.get('state') == 'running' for host in hosts.values() for c in host.get('docker', []))
    observed_iso = observed.isoformat() if observed else ''
    overview = [('Needs attention', str(len(alerts))), ('Hosts online', f'{online}/{host_total}'), ('Endpoints responding', f'{endpoint_ok}/{endpoint_total}'), ('Containers running', str(running)), ('Backup jobs passing', f'{sum(s=="ok" for s in jobs.values())}/{len(jobs)}')]
    body = f'<div class="status dashboard"><header class="dashboard-head"><h1>Lab dashboard</h1><time class="snapshot-time" id="snapshot-time" datetime="{observed_iso}" data-stale-minutes="{thresholds["stale_after_minutes"]}">{e(snapshot.get("observed_at") or "Not collected")}</time></header><p id="snapshot-stale" class="snapshot-warning" hidden>Snapshot is stale. Check collection.</p>'
    attention_state = alerts[0][0] if alerts else 'ok' if observed and (hosts or snapshot.get('endpoints')) else 'unknown'
    body += '<div class="overview-strip">' + ''.join(f'<a class="overview-item" href="#{key}"' + (f' data-state="{attention_state}"' if key == 'attention' else '') + f'><span class="overview-value">{e(value)}</span><span class="overview-label">{e(label)}</span></a>' for (label, value), key in zip(overview, ('attention','hosts','endpoints','containers','backups'))) + '</div>'
    def section(identifier, title, content, count=''):
        return f'<section class="dashboard-section" id="{identifier}"><div class="section-heading"><h2>{title}</h2><small>{e(count)}</small></div>{content}</section>'
    body += section('attention', 'Needs attention', '<div class="alert-list">' + alert_content + '</div>', f'{len(alerts)} items')
    body += section('hosts', 'Hosts', '<div class="grid">' + ''.join(machines) + '</div>')
    body += section('endpoints', 'Endpoints', '<div class="indicator-grid">' + ''.join(row[2] for row in sorted(endpoints, key=lambda row: (RANK[row[0]], row[1]))) + '</div>')
    container_groups = ''
    for name, host in hosts.items():
        group = groups.get(name, [])
        empty = 'Not probed' if host.get('skipped') else 'Docker inventory unavailable' if not host.get('collected') or fact(host, 'containers') == 'unavailable' else 'No Docker containers'
        active = [row for row in group if row[0] != 'off']
        excluded_group = [row for row in group if row[0] == 'off']
        content = '<div class="indicator-grid">' + ''.join(row[2] for row in active) + '</div>' if active else ''
        if excluded_group:
            content += f'<details class="excluded-containers"><summary>Excluded containers ({len(excluded_group)})</summary><div class="indicator-grid">' + ''.join(row[2] for row in excluded_group) + '</div></details>'
        container_groups += f'<div class="container-group"><h3 class="group-heading">{e(name)} <small>{len(group)} containers</small></h3>' + (content if group else f'<p class="empty-state">{empty}</p>') + '</div>'
    body += section('containers', 'Containers', container_groups, 'Running ≠ healthy')
    body += section('backups', 'Backups', '<div class="indicator-grid">' + ''.join(backups) + '</div>', 'Success ≠ verified restore')
    body += '<div class="dashboard-links"><a href="/docs/inventory/observed.html">Full inventory</a><a href="/docs/services/backups.html">Backup guide</a><a href="/docs/">Lab guide</a></div><script type="module" src="/assets/status.js"></script></div>'
    return '<!doctype html><html lang="en"><head><title>Lab dashboard</title><meta name="description" content="At-a-glance lab health, actionable alerts, hosts, endpoints, containers and backup evidence."></head><body class="wide">' + body + '</body></html>\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', type=Path)
    parser.add_argument('--policy', type=Path, required=True)
    parser.add_argument('--previous', type=Path)
    parser.add_argument('--backup-units', action='store_true')
    args = parser.parse_args()
    policy = json.loads(args.policy.read_text())
    validate_policy(policy)
    if args.backup_units:
        print(base64.b64encode(json.dumps(sorted({job['unit'] for job in policy.get('backup_jobs', [])})).encode()).decode())
        return
    if args.inventory is None:
        parser.error('--inventory is required for rendering')
    previous = json.loads(args.previous.read_text()) if args.previous and args.previous.exists() else {}
    print(render(json.loads(args.inventory.read_text()), policy, previous), end='')


if __name__ == '__main__':
    main()
