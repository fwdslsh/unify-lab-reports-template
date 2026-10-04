"""Explicit, bounded observations. Does not mutate hosts, Git or authored pages."""
import argparse
import base64
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from lab import ROOT, FACT_KEYS, allowed_window, load_lab, path_setting

spec = importlib.util.spec_from_file_location('dashboard', ROOT / 'scripts/status-dashboard.py')
dashboard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dashboard)
DOCKER_KEYS = {'name', 'image', 'state', 'status', 'ports', 'project', 'service', 'id'}
CHECK_KEYS = {'health', 'restarts', 'exit_code', 'oom', 'started_at'}


def parse_host(raw):
    facts, containers, checks, monitor = {}, [], {}, {}
    for line in raw.splitlines():
        key, _, value = line.partition('=')
        if key in FACT_KEYS:
            facts.setdefault(key, []).append(value)
        elif key in ('docker', 'docker-health', 'monitor'):
            record = json.loads(value)
            if key == 'docker':
                containers.append({k: record[k] for k in DOCKER_KEYS if k in record})
            elif key == 'docker-health':
                checks[record['id']] = {k: record[k] for k in CHECK_KEYS if k in record}
            else:
                journal = record.get('journal', {})
                monitor = {k: record[k] for k in ('failed_units', 'container_checks_available') if k in record}
                monitor['journal'] = {k: journal[k] for k in ('available', 'window_minutes', 'count', 'limited', 'units') if k in journal}
                monitor['backups'] = {unit: {k: v[k] for k in ('result', 'exit_code', 'active', 'last_success', 'last_run', 'timer_active', 'timer_drift', 'evidence') if k in v} for unit, v in record.get('backups', {}).items()}
    for container in containers:
        container.update(checks.get(container.get('id'), {}))
    return {'facts': facts, 'docker': containers, 'monitor': monitor,
            'collected': bool(facts.get('host') and (facts.get('os') or facts.get('kernel')))}


def host_script(host, jobs):
    platform = host.get('platform', 'linux')
    filename = {'linux': 'linux.sh', 'macos': 'macos.sh', 'windows': 'windows.ps1'}[platform]
    script = (ROOT / 'scripts/probes' / filename).read_text()
    if platform == 'linux':
        encoded = base64.b64encode(json.dumps(jobs).encode()).decode()
        observer = (ROOT / 'scripts/status-observe.py').read_text().split("if __name__ == '__main__':", 1)[0]
        script += "\npython3 - <<'REPORTS_OBSERVER'\n" + observer
        script += f"\nprint('monitor=' + json.dumps(collect(json.loads(base64.b64decode('{encoded}')))))\nREPORTS_OBSERVER\n"
    return script


def observe_host(host, jobs):
    interpreter = ['powershell', '-NoProfile', '-NonInteractive', '-Command', '-'] if host.get('platform') == 'windows' else ['bash', '-s']
    command = interpreter
    if host.get('ssh'):
        command = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-p', str(host.get('port', 22))]
        if os.environ.get('LAB_SSH_KEY_FILE'):
            command += ['-i', os.environ['LAB_SSH_KEY_FILE'], '-o', 'IdentitiesOnly=yes']
        if os.environ.get('LAB_SSH_KNOWN_HOSTS'):
            command += ['-o', 'UserKnownHostsFile=' + os.environ['LAB_SSH_KNOWN_HOSTS']]
        command += [host['ssh'], *interpreter]
    try:
        result = subprocess.run(command, input=host_script(host, jobs), text=True,
                                capture_output=True, timeout=45)
        # Native facts may be available even if a later optional check fails.
        return parse_host(result.stdout)
    except (OSError, subprocess.TimeoutExpired, ValueError, KeyError):
        return {'collected': False, 'facts': {}, 'docker': [], 'monitor': {}}


def observe_endpoint(item, now):
    row = {**item, 'status': 'not probed', 'latency': '—'}
    if not allowed_window(item, now):
        return row
    start = time.monotonic()
    try:
        with urlopen(item['url'], timeout=12) as response:
            row['status'] = str(response.status)
    except HTTPError as error:
        row['status'] = str(error.code)
        error.close()
    except (URLError, OSError, ValueError):
        row['status'] = 'off' if item.get('optional') else '000'
    row['latency'] = f'{(time.monotonic()-start)*1000:.0f} ms'
    return row


def collect(config, now=None):
    dashboard.validate_policy(config)
    now = now or datetime.now(timezone.utc)
    hosts = {}
    for host in config.get('hosts', []):
        if not allowed_window(host, now):
            hosts[host['id']] = {'collected': False, 'skipped': True, 'note': 'Outside configured observation window'}
            continue
        jobs = [job for job in config.get('backup_jobs', []) if job['host'] == host['id']]
        hosts[host['id']] = observe_host(host, jobs)
    endpoints = [observe_endpoint(item, now) for item in config.get('endpoints', [])]
    return {'observed_at': now.isoformat(), 'hosts': hosts, 'endpoints': endpoints}


def write_snapshot(path, snapshot):
    path.parent.mkdir(parents=True, exist_ok=True)
    # Publish only a complete snapshot; never truncate the last successful one.
    handle, temporary = tempfile.mkstemp(prefix='.observed-', dir=path.parent)
    try:
        with os.fdopen(handle, 'w') as stream:
            json.dump(snapshot, stream, indent=2)
            stream.write('\n')
        os.replace(temporary, path)
    finally:
        if Path(temporary).exists():
            Path(temporary).unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        config = load_lab(args.config)
        output = args.output or path_setting('LAB_SNAPSHOT', 'state/observed.json')
        snapshot = collect(config)
        if output.exists():
            write_snapshot(path_setting('LAB_PREVIOUS', 'state/previous.json'), json.loads(output.read_text()))
        write_snapshot(output, snapshot)
        print('Collection snapshot updated', file=sys.stderr)
    except (ValueError, KeyError, OSError, TypeError) as error:
        parser.exit(1, f'Collection stopped: {error}\n')


if __name__ == '__main__':
    main()
