"""Fixture-only collector tests. No private lab host is contacted."""
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from fixture_env import reset
reset()

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
from lab import load_lab, load_snapshot, allowed_window

def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / 'scripts' / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

c = module('collect')
d = module('status-dashboard')
o = module('status-observe')
NOW = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)


class CollectionTests(unittest.TestCase):
    def test_empty_configuration_never_claims_health_or_backup_coverage(self):
        html = d.render({'observed_at': None, 'hosts': {}, 'endpoints': []}, {})
        self.assertIn('No observations yet', html)
        self.assertIn('Not assessed', html)
        self.assertNotIn('No issues in checked signals', html)
        self.assertNotIn('<input', html)

    def test_overnight_windows_and_no_connections_outside_window(self):
        item = {'window': {'timezone': 'UTC', 'start': '22:00', 'end': '06:00'}}
        self.assertTrue(allowed_window(item, NOW.replace(hour=23)))
        self.assertTrue(allowed_window(item, NOW.replace(hour=2)))
        self.assertFalse(allowed_window(item, NOW))
        host = {**item, 'id': 'optional', 'ssh': 'observer@example.test'}
        with patch.object(c, 'observe_host', side_effect=AssertionError('must not connect')):
            data = c.collect({'hosts': [host]}, NOW)
        self.assertTrue(data['hosts']['optional']['skipped'])
        with patch.object(c, 'urlopen', side_effect=AssertionError('must not connect')):
            self.assertEqual(c.observe_endpoint({**item, 'id': 'test', 'url': 'https://example.test'}, NOW)['status'], 'not probed')

    def test_configuration_rejects_unknown_keys_options_urls_and_unsafe_evidence(self):
        cases = [
            {'hostz': []}, {'hosts': [{'id': 'bad', 'ssh': '-oProxyCommand=bad'}]},
            {'hosts': [{'id': '../bad'}]}, {'hosts': [{'id': 'x'}, {'id': 'x'}]},
            {'endpoints': [{'id': 'x', 'url': 'javascript:alert(1)'}]},
            {'endpoints': [{'id': 'x', 'url': 'https://name:password@example.test'}]},
            {'hosts': [{'id': 'x', 'window': {'timezone': 'UTC', 'start': '25:00', 'end': '08:00'}}]},
            {'backup_jobs': [{'receipt_path': '../../secrets'}]},
        ]
        with tempfile.TemporaryDirectory() as temp:
            config = Path(temp) / 'lab.json'
            for value in cases:
                with self.subTest(value=value), self.assertRaises((ValueError, KeyError)):
                    config.write_text(json.dumps(value))
                    load_lab(config)

    def test_ssh_uses_native_strict_auth_and_argument_arrays(self):
        def run(args, **kwargs):
            self.assertEqual(args[:3], ['ssh', '-o', 'BatchMode=yes'])
            self.assertIn('StrictHostKeyChecking=yes', args)
            self.assertIn('observer@example.test', args)
            self.assertEqual(kwargs['timeout'], 45)
            self.assertNotIn('shell', kwargs)
            self.assertNotIn('private password', kwargs['input'])
            return SimpleNamespace(stdout='host=example\nos=Linux\n', returncode=0)
        with patch.object(c.subprocess, 'run', side_effect=run):
            self.assertTrue(c.observe_host({'id': 'test', 'ssh': 'observer@example.test'}, [])['collected'])

    def test_timeout_is_unknown_and_not_a_success(self):
        with patch.object(c.subprocess, 'run', side_effect=OSError('SSH unavailable')):
            self.assertFalse(c.observe_host({'id': 'test'}, [])['collected'])

    def test_private_monitor_fields_and_unrelated_facts_are_dropped(self):
        raw = 'PRIVATE_TOKEN=secret\nhost=test\nos=Linux\nmonitor=' + json.dumps({
            'journal': {'available': True, 'count': 1, 'MESSAGE': 'secret'},
            'backups': {'backup': {'last_success': NOW.isoformat(), 'private': 'secret'}}})
        self.assertNotIn('secret', json.dumps(c.parse_host(raw)))

    def test_atomic_snapshot_failure_preserves_previous_file(self):
        with tempfile.TemporaryDirectory() as temp:
            file = Path(temp) / 'observed.json'
            c.write_snapshot(file, {'old': True})
            with patch.object(c.os, 'replace', side_effect=OSError('fixture failure')):
                with self.assertRaises(OSError):
                    c.write_snapshot(file, {'new': True})
            self.assertEqual(json.loads(file.read_text()), {'old': True})
            self.assertEqual(len(list(Path(temp).iterdir())), 1)

    def test_missing_explicit_receipt_does_not_fall_back_to_systemd_success(self):
        def run(args, **kwargs):
            if args[:2] == ['systemctl', 'show']:
                return SimpleNamespace(returncode=0, stdout='LoadState=loaded\nResult=success\nExecMainStatus=0\nExecMainExitTimestamp=now\n', stderr='')
            if args[0] == 'date':
                return SimpleNamespace(returncode=0, stdout=NOW.isoformat(), stderr='')
            return None
        with patch.object(o, 'run', side_effect=run):
            data = o.collect([{'unit': 'backup', 'receipt_path': '/var/lib/backup/last-success'}])
        self.assertIsNone(data['backups']['backup']['last_success'])

    def test_invalid_snapshot_links_are_rejected_and_unknown_facts_not_published(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'observed.json'
            data = {'observed_at': NOW.isoformat(), 'hosts': {'test': {'facts': {'PRIVATE_TOKEN': ['secret'], 'os': ['Linux']}}}, 'endpoints': []}
            path.write_text(json.dumps(data))
            with patch.dict(os.environ, {'LAB_SNAPSHOT': str(path)}):
                self.assertNotIn('secret', json.dumps(load_snapshot()))
                data['endpoints'] = [{'id': 'bad', 'url': 'javascript:alert(1)'}]
                path.write_text(json.dumps(data))
                with self.assertRaises(ValueError):
                    load_snapshot()
