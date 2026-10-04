"""Dashboard policy, state classification and safe rendering regression tests."""
import copy
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch
from types import SimpleNamespace
from fixture_env import reset
reset()

ROOT = Path(__file__).resolve().parent.parent / 'scripts'
import sys
sys.path.insert(0, str(ROOT))
def module(name):
    path = ROOT / (name + '.py')
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

dashboard = module('status-dashboard')
observe = module('status-observe')
collector = module('collect')
NOW = datetime(2026, 10, 4, 6, tzinfo=timezone.utc)


class DashboardTests(unittest.TestCase):
    def setUp(self):
        self.policy = {'hosts': [{'id': 'server'}], 'backup_jobs': [{'id': 'local', 'host': 'server', 'unit': 'backup', 'label': 'Local', 'max_age_hours': 36, 'scope': 'Local copy'}],
            'backup_expectations': [{'target': 'server', 'jobs': ['local'], 'note': 'Configured scope'}]}
        self.host = {'collected': True, 'facts': {'memused': ['500'], 'memtot': ['1000'], 'rootuse': ['40%'], 'load': ['1 1 1'], 'cores': ['4'], 'containers': ['1']}, 'docker': [{'id':'a', 'name':'web', 'state':'running', 'health':'healthy', 'restarts':0}],
            'monitor': {'journal': {'available': True, 'count': 0}, 'failed_units': [], 'backups': {'backup': {'last_success': NOW.isoformat(), 'result':'success', 'exit_code':'0'}}}}
        self.snapshot = {'observed_at':'2026-10-04T06:00:00Z', 'hosts': {'server': self.host}, 'endpoints': [{'id':'web', 'label':'Web', 'url':'https://web.example.test/health', 'purpose':'Web route', 'status':'200', 'latency':'10 ms'}]}

    def render(self):
        return dashboard.render(self.snapshot, self.policy, now=NOW)

    def test_dashboard_is_visual_native_details_not_endpoint_tables(self):
        html = self.render()
        self.assertNotIn('<table', html)
        self.assertNotIn('<details open', html)
        for section in ('attention', 'hosts', 'endpoints', 'containers', 'backups'):
            self.assertIn(f'id="{section}"', html)
        self.assertIn('No issues in checked signals', html)
        self.assertIn('class="indicator"', html)
        self.assertIn('HTTP reachability only', html)

    def test_render_is_pure_and_repeatable(self):
        before = copy.deepcopy(self.snapshot)
        self.assertEqual(self.render(), self.render())
        self.assertEqual(before, self.snapshot)

    def test_critical_resource_and_endpoint_alerts_sort_first(self):
        self.host['facts']['rootuse'] = ['99%']
        self.snapshot['endpoints'][0]['status'] = '000'
        html = self.render()
        self.assertIn('Root disk usage 99%', html)
        self.assertIn('Web · unreachable', html)
        self.assertIn('data-state="bad"', html)

    def test_load_warning_cannot_downgrade_critical_disk_indicator(self):
        self.host['facts']['rootuse'] = ['99%']
        self.host['facts']['load'] = ['8 8 8']
        self.assertIn('data-state="bad" id="host-server"', self.render())

    def test_running_without_healthcheck_is_not_healthy(self):
        self.host['docker'][0]['health'] = None
        html = self.render()
        self.assertIn('No Docker healthcheck', html)
        self.assertIn('>Running</span>', html)
        self.assertNotIn('>Healthy</span>', html)

    def test_restarts_require_matching_id_and_previous_count(self):
        c = {'id':'same', 'state':'running', 'health':'healthy', 'restarts': 4}
        self.assertEqual(dashboard.container_state(c, {'id':'same', 'restarts':2}, None)[0], 'warn')
        self.assertEqual(dashboard.container_state(c, {'id':'old', 'restarts':2}, None)[0], 'ok')
        self.assertEqual(dashboard.container_state(c, None, None)[0], 'ok')

    def test_clean_stop_needs_review_unless_explicitly_excluded(self):
        c = {'state':'exited', 'exit_code':0, 'health':'healthy'}
        self.assertEqual(dashboard.container_state(c, None, None)[0], 'warn')
        self.assertEqual(dashboard.container_state(c, None, 'Rollback')[0], 'off')

    def test_backup_patterns_follow_container_names_without_overlapping(self):
        self.policy['backup_expectations'] = [{'target':'server/w*', 'jobs':[], 'note':'Agent state'}]
        self.assertIn('server/web', self.render())
        self.policy['backup_expectations'].append({'target':'server/web', 'jobs':[], 'note':'Duplicate'})
        with self.assertRaisesRegex(ValueError, 'overlap'):
            self.render()

    def test_exclusions_remain_visible_without_false_outages(self):
        self.host['docker'][0]['state'] = 'exited'
        self.host['docker'][0]['exit_code'] = 137
        self.policy['container_exclusions'] = {'server/web': 'Retained rollback'}
        self.snapshot['endpoints'][0]['status'] = '500'
        self.policy['endpoint_exclusions'] = {'web':'Intentionally inactive'}
        html = self.render()
        self.assertIn('Excluded', html)
        self.assertIn('Intentionally inactive', html)
        self.assertNotIn('Web · unreachable', html)
        self.assertNotIn('web · exited', html)
        self.assertIn('Excluded containers (1)', html)
        self.assertIn('<dt>Container</dt><dd>web</dd>', html)

    def test_successful_but_old_backup_is_overdue(self):
        self.host['monitor']['backups']['backup']['last_success'] = (NOW-timedelta(days=4)).isoformat()
        self.assertIn('Overdue', self.render())

    def test_no_receipt_failed_and_future_backups_never_pass(self):
        status = self.host['monitor']['backups']['backup']
        for changes, expected in (({'last_success':None}, 'unknown'), ({'result':'exit-code', 'exit_code':'1'}, 'bad'), ({'last_success':(NOW+timedelta(days=1)).isoformat()}, 'unknown'), ({'timer_drift':True}, 'warn'), ({'timer_active':'inactive'}, 'warn')):
            with self.subTest(changes=changes):
                h = copy.deepcopy(self.host)
                h['monitor']['backups']['backup'].update(changes)
                self.assertEqual(dashboard.backup_state(self.policy['backup_jobs'][0], h, NOW)[0], expected)

    def test_local_only_backup_is_not_offsite_coverage(self):
        self.policy['backup_expectations'][0]['needs_offsite'] = True
        html = self.render()
        self.assertIn('server · off-host', html)
        self.assertIn('1 backup coverage gaps', html)

    def test_backup_exclusions_suppress_only_selected_gap(self):
        self.policy['backup_expectations'][0]['jobs'] = []
        self.assertIn('1 backup coverage gaps', self.render())
        self.policy['backup_exclusions'] = {'server':'Owner-managed backup'}
        self.assertNotIn('backup coverage gaps', self.render())
        self.assertIn('Owner-managed backup', self.render())

    def test_unknown_logs_are_not_clean_and_raw_text_never_rendered(self):
        self.host['monitor']['journal'] = {'available':False, 'MESSAGE':'secret-token=private'}
        html = self.render()
        self.assertIn('System logs not checked', html)
        self.assertNotIn('secret-token', html)

    def test_log_errors_have_drilldown_commands_but_no_messages(self):
        self.host['monitor']['journal'] = {'available':True, 'count':101, 'limited':True, 'units':['docker.service']}
        html = self.render()
        self.assertIn('≥101 recent system-log errors', html)
        self.assertIn('journalctl --since', html)
        self.assertIn('docker.service', html)

    def test_skipped_optional_host_and_endpoint_are_not_outages(self):
        self.policy['hosts'].append({'id':'optional-node', 'optional': True})
        self.snapshot['hosts']['optional-node'] = {'collected':False, 'skipped': True}
        self.snapshot['endpoints'].append({'id':'optional', 'url':'https://optional.example.test/health', 'purpose':'Optional', 'status':'not probed', 'latency':'—'})
        html = self.render()
        self.assertIn('Not probed', html)
        self.assertIn('Not monitored', html)
        self.assertNotIn('Host unreachable', html)

    def test_stale_and_future_snapshots_are_flagged(self):
        for observed in ('2026-10-03T01:00:00Z', '2026-10-05T01:00:00Z'):
            self.snapshot['observed_at'] = observed
            self.assertIn('Observation is stale', self.render())

    def test_external_fact_text_is_escaped_and_links_have_unique_ids(self):
        self.host['docker'][0]['name'] = '<script>alert(1)</script>'
        self.host['facts']['cpu'] = ['<img onerror="x">']
        html = self.render()
        self.assertNotIn('<script>alert', html)
        self.assertNotIn('<img onerror', html)
        self.assertIn('&lt;img', html)

    def test_sanitized_container_names_do_not_collide(self):
        self.host['docker'] = [{**self.host['docker'][0], 'name': name} for name in ('web.one', 'web-one')]
        html = self.render()
        import re
        ids = re.findall(r'id="(container-[^"]+)"', html)
        self.assertEqual(len(ids), 2)
        self.assertEqual(len(set(ids)), 2)

    def test_host_logs_and_single_failed_unit_mark_attention(self):
        self.host['monitor']['failed_units'] = ['broken.service']
        html = self.render()
        self.assertIn('1 failed system unit</strong>', html)
        self.assertIn('data-state="warn" id="host-server"', html)
        self.assertIn('href="#attention" data-state="warn"', html)

    def test_invalid_policy_fails_instead_of_silencing_alerts(self):
        for change in ({'thresholds':{'critical_percent':50}}, {'thresholds':{'disk_warning_percent':'never'}}, {'thresholds':{'disk_warnng_percent':85}}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                dashboard.validate_policy({**self.policy, **change})
        self.policy['backup_expectations'][0]['jobs'] = ['undefined']
        with self.assertRaises(ValueError):
            self.render()


class ObserverTests(unittest.TestCase):
    def test_observer_is_bounded_and_never_publishes_log_text(self):
        def result(args, **kw):
            if 'journalctl' in args:
                output = json.dumps({'_SYSTEMD_UNIT':'docker.service','MESSAGE':'private password=value'})
            elif '--failed' in args:
                output = 'broken.service loaded failed failed Description\n'
            else:
                output = ''
            return SimpleNamespace(returncode=0, stdout=output, stderr='')
        with patch.object(observe, 'run', side_effect=result):
            data = observe.collect([])
        self.assertEqual(data['journal']['count'], 1)
        self.assertEqual(data['failed_units'], ['broken.service'])
        self.assertNotIn('password', json.dumps(data))

    def test_no_privileged_journal_access_is_unknown(self):
        with patch.object(observe, 'run', return_value=None):
            data = observe.collect([])
        self.assertFalse(data['journal']['available'])
        self.assertIsNone(data['failed_units'])
        self.assertFalse(data['container_checks_available'])

    def test_unit_arguments_are_not_shell_commands(self):
        with patch.object(observe, 'run', return_value=None), self.assertRaises(ValueError):
            observe.collect(['backup;touch /tmp/no'])

    def test_journal_units_do_not_replace_backup_unit_inputs(self):
        calls = []
        def result(args, **kw):
            calls.append(args)
            if 'journalctl' in args:
                output = json.dumps({'_SYSTEMD_UNIT':'docker.service', 'MESSAGE':'private'})
            elif 'show' in args:
                output = 'LoadState=loaded\nResult=success\nExecMainStatus=0\nActiveState=active\n'
            else:
                output = ''
            return SimpleNamespace(returncode=0, stdout=output, stderr='')
        with patch.object(observe, 'run', side_effect=result):
            data = observe.collect(['custom-backup'])
        self.assertIn('custom-backup', data['backups'])
        self.assertIn(['systemctl', 'show', 'custom-backup.timer', '-p', 'ActiveState', '-p', 'NeedDaemonReload'], calls)
        self.assertFalse(any('docker.service.service' in call for call in calls))


class InventoryTests(unittest.TestCase):
    def test_only_matching_container_ids_receive_allowlisted_checks(self):
        container = {'id':'same', 'name':'web', 'image':'test', 'state':'running', 'status':'Up', 'ports':'', 'project':'', 'service':'', 'Env':['secret']}
        checks = {'id':'same', 'health':'healthy', 'restarts':2, 'exit_code':0, 'oom':False, 'started_at':'now', 'Log':['secret']}
        raw = 'docker=' + json.dumps(container) + '\ndocker-health=' + json.dumps(checks)
        data = collector.parse_host(raw)
        self.assertEqual(data['docker'][0]['health'], 'healthy')
        self.assertNotIn('secret', json.dumps(data))
        checks['id'] = 'different'
        data = collector.parse_host('docker=' + json.dumps(container) + '\ndocker-health=' + json.dumps(checks))
        self.assertNotIn('health', data['docker'][0])


if __name__ == '__main__':
    unittest.main()
