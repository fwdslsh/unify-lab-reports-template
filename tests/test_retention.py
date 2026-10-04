"""Retention fixtures never touch real reports or remote hosts."""
import importlib.util
from datetime import datetime, timezone
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from fixture_env import reset
reset()

sys.path.insert(0, str(Path(__file__).parent.parent / 'scripts'))

spec = importlib.util.spec_from_file_location('retention', Path(__file__).parent.parent / 'scripts/retain-health.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
NOW = datetime(2026, 10, 1, 18, tzinfo=timezone.utc)

class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.root = self.repo / 'reports'
        self.root.mkdir()
        r.git(self.repo, 'init', '-q')
        r.git(self.repo, 'config', 'user.email', 'fixture@example.invalid')
        r.git(self.repo, 'config', 'user.name', 'Fixture')
        r.git(self.repo, 'commit', '--allow-empty', '-m', 'fixture')

    def file(self, name, date='2026-09-30T12:00:00Z'):
        p = self.root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(f'---\ndate: {date}\n---\n# Fixture\n')
        return p

    def test_no_spots_and_two_reviews_without_an_age_cutoff(self):
        old = self.file('lab-spot-20260901000000.md', '2026-09-01T12:00:00Z')
        recent = self.file('lab-spot-20260930000000.md')
        weekly = self.file('lab-review-20260901000000.md', '2026-09-01T12:00:00Z')
        keep, delete, moves, _ = r.plan(self.root, NOW)
        self.assertEqual(set(keep), {weekly})
        self.assertEqual(set(delete), {old, recent})
        self.assertEqual(len(moves), 1)

    def test_cap_counts_snapshots_not_html_markdown_twins(self):
        for hour in range(4):
            for ext in ('md', 'html'):
                self.file(f'health/lab-review-20260930{hour:02d}0000.{ext}', f'2026-09-30T{hour:02d}:00:00Z')
        keep, delete, _, _ = r.plan(self.root, NOW)
        self.assertEqual(len(keep), 4)
        self.assertEqual(len(delete), 4)

    def test_excluded_families_and_symlinks(self):
        for name in ('incidents/lab-spot-20260101000000.md',
                     'articles/lab-review-20260101000000.md', 'health/unknown.md',
                     'model-benchmark-ledger-20260930.html'):
            self.file(name, '2026-01-01T00:00:00Z')
        (self.root / 'health/lab-spot-20260102000000.md').symlink_to(self.root / 'health/unknown.md')
        self.assertEqual(r.plan(self.root, NOW)[:3], ([], [], []))

    def test_collision_fails_before_mutation(self):
        self.file('lab-review-20260930000000.md')
        self.file('health/lab-review-20260930000000.md')
        with self.assertRaises(ValueError):
            r.plan(self.root, NOW)

    def test_checkpoint_purge_and_idempotency_preserve_unrelated_staging(self):
        old = self.file('lab-spot-20260101000000.md', '2026-01-01T00:00:00Z')
        self.file('lab-review-20260930000000.md')
        unrelated = self.repo / 'unrelated.txt'
        unrelated.write_text('keep me')
        r.git(self.repo, 'add', 'unrelated.txt')
        result = r.apply(self.root, NOW, True)
        self.assertEqual(result['deleted_files'], 1)
        self.assertFalse(old.exists())
        self.assertIn('Fixture', r.git(self.repo, 'show', 'HEAD~1:reports/' + old.name))
        self.assertEqual(r.git(self.repo, 'diff', '--cached', '--name-only'), 'unrelated.txt')
        self.assertEqual(r.apply(self.root, NOW, True)['moved_files'], 0)

    def test_modified_snapshot_not_deleted(self):
        old = self.file('health/lab-spot-20260101000000.md', '2026-01-01T00:00:00Z')
        r.git(self.repo, 'add', '.')
        r.git(self.repo, 'commit', '-m', 'snapshot')
        old.write_text(old.read_text() + 'user edit\n')
        with self.assertRaises(ValueError):
            r.apply(self.root, NOW, True)
        self.assertTrue(old.exists())

    def test_newest_two_weeklies_and_future_or_invalid_dates_are_safe(self):
        older = self.file('health/lab-review-20260901000000.md', '2026-09-01T00:00:00Z')
        first = self.file('health/lab-review-20260921000000.md', '2026-09-21T00:00:00Z')
        second = self.file('health/lab-review-20260928000000.md', '2026-09-28T00:00:00Z')
        future = self.file('health/lab-review-20261010000000.md', '2026-10-10T00:00:00Z')
        invalid = self.file('health/lab-review-20261011000000.md', 'not-a-date')
        keep, delete, _, ignored = r.plan(self.root, NOW)
        self.assertEqual(set(keep), {first, second})
        self.assertEqual(delete, [older])
        self.assertEqual(set(ignored), {str(p.relative_to(self.root)) for p in (future, invalid)})

if __name__ == '__main__':
    unittest.main()
