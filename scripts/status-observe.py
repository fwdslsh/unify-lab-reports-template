#!/usr/bin/env python3
"""Bounded read-only Linux checks. Publish counts/metadata, never log messages."""
import json
import base64
import os
import re
import subprocess
import sys
import time
from datetime import datetime

DEADLINE = None


def run(args, timeout=5):
    if DEADLINE is not None:
        timeout = min(timeout, DEADLINE - time.monotonic())
        if timeout <= 0:
            return None
    try:
        return subprocess.run(args, text=True, capture_output=True, timeout=timeout,
                              env={**os.environ, 'LC_ALL': 'C'})
    except (OSError, subprocess.TimeoutExpired):
        return None


def read_receipt(path):
    result = run(['sudo', '-n', 'cat', path])
    if result and result.returncode == 0:
        try:
            return datetime.fromisoformat(result.stdout.strip()).isoformat()
        except ValueError:
            pass
    return None


def collect(jobs=None):
    global DEADLINE
    DEADLINE = time.monotonic() + 28
    result = {'journal': {'available': False, 'window_minutes': 30}, 'failed_units': None, 'backups': {}}
    ids = run(['docker', 'ps', '-aq', '--no-trunc'])
    result['container_checks_available'] = False
    if ids and ids.returncode == 0:
        # Deliberately do not read State.Health.Log, Config.Env, mounts or logs.
        template = 'docker-health={"id":{{json .Id}},"health":{{with (index .State "Health")}}{{json .Status}}{{else}}null{{end}},"restarts":{{.RestartCount}},"exit_code":{{.State.ExitCode}},"oom":{{.State.OOMKilled}},"started_at":{{json .State.StartedAt}}}'
        inspected = run(['docker', 'inspect', '--format', template, *ids.stdout.split()], timeout=8) if ids.stdout.strip() else None
        if not ids.stdout.strip() or (inspected and inspected.returncode == 0):
            result['container_checks_available'] = True
            if inspected:
                print(inspected.stdout, end='')
    journal = run(['sudo', '-n', 'journalctl', '--since', '30 minutes ago', '-p', 'err', '-n', '101', '-o', 'json', '--no-pager'], timeout=6)
    if journal and journal.returncode == 0:
        records = []
        try:
            records = [json.loads(line) for line in journal.stdout.splitlines() if line.strip()]
            journal_units = sorted({str(row.get('_SYSTEMD_UNIT', 'kernel/system')) for row in records})[:10]
            result['journal'].update(available=True, count=len(records), limited=len(records) >= 101, units=journal_units)
        except (ValueError, TypeError):
            pass
    failed = run(['systemctl', '--failed', '--no-legend', '--plain', '--no-pager'])
    if failed and failed.returncode == 0:
        result['failed_units'] = [line.split()[0] for line in failed.stdout.splitlines() if line.strip()][:30]
    for job in jobs or []:
        job = {'unit': job} if isinstance(job, str) else job
        unit = job['unit']
        if not re.fullmatch(r'[a-zA-Z0-9_.@-]+', unit):
            raise ValueError('Invalid backup unit name')
        shown = run(['systemctl', 'show', unit + '.service', '-p', 'LoadState', '-p', 'Result', '-p', 'ExecMainStatus', '-p', 'ExecMainExitTimestamp', '-p', 'ActiveState'])
        if not shown or shown.returncode != 0:
            continue
        props = dict(line.split('=', 1) for line in shown.stdout.splitlines() if '=' in line)
        if props.get('LoadState') != 'loaded':
            continue
        receipt = read_receipt(job['receipt_path']) if job.get('receipt_path') else None
        if job.get('completion_marker'):
            completed = run(['sudo', '-n', 'test', '-f', job['completion_marker']])
            if not completed or completed.returncode != 0:
                receipt = None
        exit_time = props.get('ExecMainExitTimestamp')
        converted = run(['date', '-d', exit_time, '--iso-8601=seconds']) if exit_time else None
        if not job.get('receipt_path') and not job.get('completion_marker') and props.get('Result') == 'success' and props.get('ExecMainStatus') == '0' and converted and converted.returncode == 0:
            receipt = converted.stdout.strip()
        timer = run(['systemctl', 'show', unit + '.timer', '-p', 'ActiveState', '-p', 'NeedDaemonReload'])
        timer_props = dict(line.split('=', 1) for line in timer.stdout.splitlines() if '=' in line) if timer and timer.returncode == 0 else {}
        result['backups'][unit] = {'result': props.get('Result'), 'exit_code': props.get('ExecMainStatus'),
            'active': props.get('ActiveState'), 'last_success': receipt,
            'last_run': converted.stdout.strip() if converted and converted.returncode == 0 else None,
            'timer_active': timer_props.get('ActiveState'), 'timer_drift': timer_props.get('NeedDaemonReload') == 'yes',
            'evidence': 'completed snapshot' if job.get('completion_marker') else 'success receipt' if job.get('receipt_path') else 'systemd completed run'}
    return result


if __name__ == '__main__':
    units = json.loads(base64.b64decode(sys.argv[1])) if len(sys.argv) > 1 else None
    print('monitor=' + json.dumps(collect(units), separators=(',', ':')))
