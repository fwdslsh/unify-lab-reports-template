"""Configuration fixtures do not modify real report sources or configuration."""
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from fixture_env import reset
reset()

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
from settings import KEYS, load


class SettingsTests(unittest.TestCase):
    def test_exact_public_defaults_and_environment_override_types(self):
        defaults = json.loads((ROOT / 'site.config.json').read_text())
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(load(), defaults)
        with patch.dict(os.environ, {'SITE_BRAND': 'Example', 'REPORTS_WEEKLY_KEEP': '3'}):
            settings = load()
            self.assertEqual(settings['SITE_BRAND'], 'Example')
            self.assertEqual(settings['REPORTS_WEEKLY_KEEP'], 3)
            self.assertNotIn('PATH', settings)

    def test_configuration_fingerprint_ignores_unrelated_environment(self):
        command = [sys.executable, str(ROOT / 'scripts/settings.py'), '--env-hash']
        def digest(env):
            return subprocess.check_output(command, env=env, text=True).strip()
        self.assertEqual(digest({}), '')
        self.assertEqual(digest({'PRIVATE_TOKEN': 'secret'}), '')
        one = digest({'SITE_BRAND': 'One'})
        self.assertEqual(len(one), 64)
        self.assertEqual(one, digest({'PRIVATE_TOKEN': 'changed', 'SITE_BRAND': 'One'}))
        self.assertNotEqual(one, digest({'SITE_BRAND': 'Two'}))

    def test_generic_prefix_timezone_and_retention_count(self):
        with patch.dict(os.environ, {'REPORTS_HEALTH_PREFIX': 'my-lab',
                                    'REPORTS_TIMEZONE': 'UTC', 'REPORTS_WEEKLY_KEEP': '3'}):
            spec = importlib.util.spec_from_file_location('generic_retention', ROOT / 'scripts/retain-health.py')
            retention = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(retention)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for day in range(1, 5):
                (root / f'my-lab-review-202609{day:02d}000000.md').write_text(
                    f'---\ndate: 2026-09-{day:02d}T00:00:00\n---\n# Review\n')
            other = root / 'lab-review-20260901000000.md'
            other.write_text('not our managed file')
            keep, delete, moves, ignored = retention.plan(root, datetime(2026, 10, 1, tzinfo=timezone.utc))
            self.assertEqual(len(keep), 3)
            self.assertEqual([p.name for p in delete], ['my-lab-review-20260901000000.md'])
            self.assertTrue(other.exists())
            self.assertEqual(ignored, [])
            self.assertEqual(len(moves), 3)

    def test_generator_and_retention_share_the_same_weekly_cap(self):
        with patch.dict(os.environ, {'REPORTS_WEEKLY_KEEP': '3'}):
            spec = importlib.util.spec_from_file_location('configured_navigation', ROOT / 'scripts/gen-index.py')
            navigation = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(navigation)
        records = [{'source': f'health/my-review-{n}.md', 'href': f'/health/my-review-{n}.html',
                    'title': f'Review {n}', 'description': 'Weekly review',
                    'date': f'2026-09-{n:02d}', 'meta': []} for n in range(1, 4)]
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            inventory = root / 'inventory.json'
            inventory.write_text(json.dumps({'schemaVersion': 1, 'pages': records}))
            navigation.generate(root, root, inventory)
            self.assertEqual((root / 'health/index.html').read_text().count('class="title"'), 3)
