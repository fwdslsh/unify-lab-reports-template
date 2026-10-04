"""One operator-owned configuration; no network access or secret discovery."""
from datetime import datetime
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
FACT_KEYS = {'host', 'os', 'kernel', 'cpu', 'cores', 'board', 'memused', 'memtot',
             'swapused', 'uptime', 'load', 'containers', 'rootuse', 'rootsize', 'storage', 'gpu'}


def path_setting(name, default):
    path = Path(os.environ.get(name, default)).expanduser()
    return path if path.is_absolute() else ROOT / path


def allowed_window(item, now):
    window = item.get('window')
    if not window:
        return True
    local = now.astimezone(ZoneInfo(window['timezone'])).strftime('%H:%M')
    start, end = window['start'], window['end']
    return start <= local < end if start < end else local >= start or local < end


def load_lab(path=None):
    config = json.loads((path or path_setting('LAB_CONFIG', 'lab.json')).read_text())
    known = {'hosts', 'endpoints', 'thresholds', 'container_exclusions', 'endpoint_exclusions',
             'backup_jobs', 'backup_expectations', 'backup_exclusions'}
    if not isinstance(config, dict) or set(config) - known:
        raise ValueError('Unknown lab.json setting')
    ids = set()
    for host in config.get('hosts', []):
        if not isinstance(host, dict) or set(host) - {'id', 'role', 'platform', 'ssh', 'port', 'optional', 'window'}:
            raise ValueError('Unknown host setting')
        name = host['id']
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', name) or name in ids:
            raise ValueError('Host IDs must be unique safe identifiers')
        ids.add(name)
        if host.get('platform', 'linux') not in ('linux', 'macos', 'windows'):
            raise ValueError('Host platform must be linux, macos or windows')
        target = host.get('ssh')
        if target and not re.fullmatch(r'(?:[A-Za-z0-9_.-]+@)?[A-Za-z0-9][A-Za-z0-9.:-]*', target):
            raise ValueError('SSH target must be a host or user@host, not options')
        if type(host.get('port', 22)) is not int or not 1 <= host.get('port', 22) <= 65535:
            raise ValueError('SSH port must be an integer from 1 to 65535')
        if not isinstance(host.get('optional', False), bool):
            raise ValueError('Host optional must be boolean')
    endpoint_ids = set()
    for item in config.get('endpoints', []):
        if not isinstance(item, dict) or set(item) - {'id', 'label', 'url', 'purpose', 'optional', 'window'}:
            raise ValueError('Unknown endpoint setting')
        url = urlsplit(item['url'])
        if url.scheme not in ('https', 'http') or not url.netloc or url.username or url.password:
            raise ValueError('Endpoints must be credential-free HTTP(S) URLs')
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', item['id']) or item['id'] in endpoint_ids:
            raise ValueError('Endpoint IDs must be unique safe identifiers')
        endpoint_ids.add(item['id'])
        if not isinstance(item.get('optional', False), bool):
            raise ValueError('Endpoint optional must be boolean')
    for item in [*config.get('hosts', []), *config.get('endpoints', [])]:
        window = item.get('window')
        if window:
            if set(window) != {'timezone', 'start', 'end'}:
                raise ValueError('Window needs timezone, start and end')
            ZoneInfo(window['timezone'])
            for key in ('start', 'end'):
                if not re.fullmatch(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]', window[key]):
                    raise ValueError('Window times must be HH:MM')
            if window['start'] == window['end']:
                raise ValueError('Window start and end must differ')
    for job in config.get('backup_jobs', []):
        if not isinstance(job, dict) or set(job) - {'id', 'host', 'unit', 'label', 'max_age_hours', 'scope', 'offsite', 'receipt_path', 'completion_marker'}:
            raise ValueError('Unknown backup job setting')
        for key in ('receipt_path', 'completion_marker'):
            value = job.get(key)
            if value and (not Path(value).is_absolute() or '..' in Path(value).parts):
                raise ValueError('Backup evidence paths must be explicit absolute host paths')
    for item in config.get('backup_expectations', []):
        if not isinstance(item, dict) or set(item) - {'target', 'jobs', 'note', 'needs_offsite'}:
            raise ValueError('Unknown backup expectation setting')
    return config


def load_snapshot():
    path = path_setting('LAB_SNAPSHOT', 'state/observed.json')
    if not path.exists():
        return {'observed_at': None, 'hosts': {}, 'endpoints': []}
    data = json.loads(path.read_text())
    if not isinstance(data, dict) or set(data) - {'observed_at', 'hosts', 'endpoints'}:
        raise ValueError('Invalid observation snapshot')
    if data.get('observed_at'):
        stamp = datetime.fromisoformat(data['observed_at'].replace('Z', '+00:00'))
        if not stamp.tzinfo:
            raise ValueError('Observation timestamp must include timezone')
    if not isinstance(data.get('hosts'), dict) or not isinstance(data.get('endpoints'), list):
        raise ValueError('Snapshot needs hosts and endpoints')
    for name, host in data['hosts'].items():
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', name) or not isinstance(host, dict):
            raise ValueError('Invalid snapshot host')
        facts = host.get('facts', {})
        if not isinstance(facts, dict) or any(not isinstance(v, list) or any(not isinstance(x, str) for x in v) for v in facts.values()):
            raise ValueError('Host facts must be lists of text')
        host['facts'] = {key: value for key, value in facts.items() if key in FACT_KEYS}
        if not isinstance(host.get('docker', []), list) or not isinstance(host.get('monitor', {}), dict):
            raise ValueError('Invalid host observation')
    for item in data['endpoints']:
        url = urlsplit(item['url'])
        if url.scheme not in ('https', 'http') or not url.netloc or url.username or url.password:
            raise ValueError('Snapshot endpoint must be credential-free HTTP(S)')
    return data
