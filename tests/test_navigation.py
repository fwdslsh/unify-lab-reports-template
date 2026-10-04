"""Renderer unit tests and end-to-end tests of the real locked Unify CLI."""
from html.parser import HTMLParser
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from fixture_env import reset
reset()

ROOT = Path(__file__).parent.parent
SCRIPTS = ROOT / 'scripts'
SITE = ROOT / 'site'
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location('navigation', SCRIPTS / 'gen-index.py')
navigation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(navigation)


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links, self.rows = [], 0

    def handle_starttag(self, tag, attrs):
        fields = dict(attrs)
        if tag == 'a':
            self.links.append(fields.get('href'))
        if tag == 'li' and 'data-page' in fields:
            self.rows += 1


def record(source, title, description='Recorded fixture.', date='', **metadata):
    return {'source': source, 'href': '/' + str(Path(source).with_suffix('.html')),
            'title': title, 'description': description, 'date': date,
            'meta': [{'name': name, 'content': value} for name, values in metadata.items()
                     for value in (values if isinstance(values, list) else [values])], 'links': []}


class RendererTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.source = Path(self.temp.name) / 'source'
        self.output = Path(self.temp.name) / 'output'
        self.source.mkdir()
        self.output.mkdir()
        self.inventory = Path(self.temp.name) / 'source-pages.json'
        self.records = [
            record('index.html', 'Lab dashboard'),
            record('status.html', 'Dashboard moved', role='bookmark'),
            record('docs/index.html', 'Lab guide'),
            record('docs/inventory/observed.html', 'Observed inventory'),
            record('docs/services/network.html', 'DNS & HTTPS', 'Private name resolution'),
            record('articles/z-first.md', 'First article', series='Benchmarks', part='1'),
            record('articles/a-second.md', 'Second article', series='Benchmarks', part='2'),
            record('articles/ledger.html', 'Benchmark ledger', date='2026-09-30'),
            record('ledger.html', 'Ledger moved', role='bookmark'),
            record('undated.html', 'Undated report', role='history'),
            record('health/lab-review-20260928060000.md', 'Weekly review', date='2026-09-28'),
            record('health/lab-review-20260921060000.md', 'Previous weekly review', date='2026-09-21', role='history'),
        ]
        self.report = {'schemaVersion': 1, 'pages': self.records}

    def tearDown(self):
        self.temp.cleanup()

    def build(self):
        self.inventory.write_text(json.dumps(self.report))
        navigation.generate(self.source, self.output, self.inventory)
        text = (self.output / 'sitemap.html').read_text()
        links = Links()
        links.feed(text)
        return text, links

    def test_full_inventory_including_noindex_bookmarks_and_indexes(self):
        _, links = self.build()
        expected = {entry['href'] for entry in self.records} | {'/' + name for name, _, _ in navigation.GENERATED}
        self.assertEqual({h for h in links.links if not h.startswith('#')}, expected)
        self.assertEqual(links.rows, len(expected))

    def test_article_order_and_bookmark_not_in_collections(self):
        self.build()
        text = (self.output / 'articles/index.html').read_text()
        self.assertLess(text.index('/articles/z-first.html'), text.index('/articles/a-second.html'))
        self.assertIn('Part 1', text)  # Labels do not need an invented date.
        self.assertIn('href="/articles/ledger.html"', text)
        self.assertNotIn('href="/ledger.html"', (self.output / 'reports/index.html').read_text())

    def test_search_escaping_description_and_no_javascript_fallback(self):
        text, _ = self.build()
        self.assertIn('data-search="dns &amp; https /docs/services/network.html private name resolution"', text)
        self.assertIn('aria-controls="page-list"', text)
        self.assertIn('aria-live="polite"', text)
        self.assertNotIn('<li hidden', text)
        self.assertIn('/assets/navigation.js', text)
        self.assertIn('data-page-path="/docs/services/network.html"', text)

    def test_undated_reports_have_no_invented_time(self):
        self.build()
        entry = next(p for p in navigation.read_pages(self.inventory) if p['href'] == '/undated.html')
        self.assertNotIn('<time', navigation.rows([entry]))
        self.assertIn('/undated.html', (self.output / 'sitemap.html').read_text())

    def test_reports_lists_old_and_new_reports_without_hiding_history(self):
        for day in range(1, 8):
            self.records.append(record(f'incidents/event-{day}.md', f'Event {day}', date=f'2026-10-{day:02}'))
        self.build()
        reports = (self.output / 'reports/index.html').read_text()
        self.assertIn('/undated.html', reports)
        self.assertIn('/incidents/event-1.html', reports)
        self.assertIn('/incidents/event-7.html', reports)
        self.assertIn('/health/lab-review-20260928060000.html', reports)
        self.assertNotIn('<details', reports)
        self.assertNotIn('<input', reports)
        self.assertNotIn('/ledger.html', reports)
        self.assertNotIn('/articles/', reports)
        self.assertFalse((self.output / 'index.html').exists())  # Home belongs to the collector, not navigation.

    def test_established_theme_and_header_are_preserved(self):
        css = (SITE / 'styles.css').read_text()
        for value in ('--bg: #0a0e0a;', '--primary: #3fb950;', '--bright: #00ff41;',
                      '--bg: #f6f8fa;', '--primary: #238636;', 'h1 { font-size: 1.6rem;',
                      'h2::before { content: "// ";'):
            self.assertIn(value, css)
        self.assertNotIn('.collection {', css)
        layout = (SITE / '_layout.html').read_text()
        self.assertIn('/_generated/brand.html', layout)
        settings = json.loads((ROOT / 'site.config.json').read_text())
        self.assertEqual(settings['SITE_BADGE'], 'Lab')
        self.assertEqual(settings['SITE_HOME_LABEL'], 'Lab dashboard home')

    def test_generator_reads_only_the_inventory_not_private_source_files(self):
        (self.source / '.private').mkdir()
        (self.source / '.private/private.md').write_text('PRIVATE MATERIAL')
        (self.source / 'outside.html').symlink_to(self.source / '.private/private.md')
        text, _ = self.build()
        self.assertNotIn('PRIVATE MATERIAL', text)
        self.assertNotIn('/outside.html', text)

    def test_rejects_duplicate_paths_and_unsupported_schema(self):
        self.report['pages'].append(self.records[0])
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            self.build()
        self.report['schemaVersion'] = 2
        with self.assertRaisesRegex(ValueError, 'Unsupported'):
            self.build()

    def test_missing_inventory_and_generated_collision_fail_closed(self):
        with self.assertRaises(FileNotFoundError):
            navigation.generate(self.source, self.output, self.inventory)
        self.records.append(record('reports/index.html', 'Colliding reports index'))
        with self.assertRaisesRegex(ValueError, 'collides'):
            self.build()

    def test_repeatable_output_and_unknown_historical_date(self):
        self.records.append(record('unknown-date.md', 'Unknown date', date=None, role='history'))
        self.build()
        self.assertIn('Unknown date', (self.output / 'sitemap.html').read_text())
        self.assertEqual(len(list(self.output.rglob('*.html'))), 5)
        before = {p.relative_to(self.output): p.read_bytes() for p in self.output.rglob('*.html')}
        self.build()
        self.assertEqual(before, {p.relative_to(self.output): p.read_bytes() for p in self.output.rglob('*.html')})

    def test_authoring_contract_and_history_are_explicit(self):
        for entry, message in (
            (record('articles/no-title.md', None), 'title'),
            (record('articles/no-description.md', 'Title', description=None), 'description'),
            (record('unclassified.md', 'Title'), 'new reports belong'),
            (record('health/no-date.md', 'Title'), 'observation date'),
            (record('incidents/invalid-date.md', 'Title', date='yesterday'), 'ISO 8601'),
        ):
            with self.subTest(entry=entry['source']):
                self.records.append(entry)
                with self.assertRaisesRegex(ValueError, message):
                    self.build()
                self.records.pop()
        self.build()
        self.assertIn('/undated.html', (self.output / 'sitemap.html').read_text())
        self.assertIn('Other pages and bookmarks', (self.output / 'sitemap.html').read_text())

    def test_current_health_and_collapsed_history_are_not_mixed(self):
        text, _ = self.build()
        health = (self.output / 'health/index.html').read_text()
        self.assertIn('<h1>Weekly reviews</h1>', health)
        self.assertEqual(health.count('class="title"'), 2)
        for date in ('Sep 28, 2026', 'Sep 21, 2026'):
            self.assertIn(f'aria-label="Weekly review — {date}"', health)
            self.assertIn(f'aria-label="Weekly review — {date}"', (self.output / 'reports/index.html').read_text())
        self.assertLess(health.index('20260928060000'), health.index('20260921060000'))
        self.assertIn('/status.html', health)
        primary, secondary = text.split('<details data-page-group')
        self.assertIn('/health/lab-review-20260921060000.html', primary)
        self.assertIn('/undated.html', primary)
        self.assertNotIn('href="/ledger.html"', primary)
        self.assertNotIn('/undated.html', secondary)
        self.assertIn('/ledger.html', secondary)
        self.assertNotIn('<details data-page-group open', text)
        self.assertNotIn('Health snapshots', text)
        self.assertNotIn('>Start here<', text)

    def test_health_overflow_and_spot_publication_fail_closed(self):
        for entry in (
            record('health/third.md', 'Third weekly', date='2026-09-14'),
            record('health/lab-spot-20261001000000.md', 'Spot', date='2026-10-01'),
        ):
            with self.subTest(entry=entry['source']):
                self.records.append(entry)
                with self.assertRaisesRegex(ValueError, 'weekly reviews'):
                    self.build()
                self.records.pop()

    def test_direct_navigation_uses_existing_destinations(self):
        nav = (ROOT / 'includes/base/nav.html').read_text()
        links = Links()
        links.feed(nav)
        self.assertEqual(links.links, ['/reports/', '/docs/', '/articles/', '/sitemap.html'])
        self.assertIn('aria-current', (SITE / '_layout.html').read_text())

    def test_four_modern_navigation_links_are_visible_and_labeled(self):
        nav = (ROOT / 'includes/base/nav.html').read_text()
        for label in ('Reports', 'Guides', 'Articles', 'All pages'):
            self.assertIn(f'<span>{label}</span>', nav)
        self.assertEqual(nav.count('<svg aria-hidden="true"'), 4)
        self.assertNotIn('<button', nav)
        self.assertIn('aria-label="Main navigation"', nav)

    def test_mobile_bottom_navigation_is_direct_safe_area_aware_and_content_clear(self):
        nav = (ROOT / 'includes/base/nav.html').read_text()
        layout = (SITE / '_layout.html').read_text()
        css = (SITE / 'styles.css').read_text()
        self.assertNotIn('<details', nav)
        self.assertNotIn('fitMenu', layout)
        self.assertIn('viewport-fit=cover', layout)
        self.assertIn('position: fixed; inset: auto 0 0', css)
        self.assertIn('repeat(4, minmax(0, 1fr))', css)
        self.assertIn('min-height: 56px', css)
        self.assertIn('scroll-padding-bottom: calc(88px + env(safe-area-inset-bottom, 0px))', css)
        self.assertIn('padding-bottom: calc(80px + env(safe-area-inset-bottom, 0px))', css)

    def test_series_parts_roles_and_repeated_tags_come_only_from_metadata(self):
        self.records.extend([
            record('articles/99-first.md', 'Earlier series', series='A & B', part='0', tags=['networking', '<safe>']),
            record('articles/reference.md', 'Reference', series='Benchmarks', part='Metrics reference'),
            record('articles/bookmark.md', 'Article bookmark', role='bookmark'),
            record('articles/00-no-metadata.md', 'No guessed part'),
        ])
        text, _ = self.build()
        articles = (self.output / 'articles/index.html').read_text()
        self.assertLess(articles.index('/articles/99-first.html'), articles.index('/articles/z-first.html'))
        self.assertLess(articles.index('/articles/a-second.html'), articles.index('/articles/reference.html'))
        self.assertIn('Metrics reference', articles)
        self.assertNotIn('/articles/bookmark.html', articles)
        self.assertIn('/articles/bookmark.html', text)
        self.assertIn('a &amp; b networking &lt;safe&gt;', text)
        row = articles.split('href="/articles/00-no-metadata.html"')[1].split('</li>')[0]
        self.assertNotIn('Part 0', row)

    def test_old_inventory_without_metadata_is_rejected(self):
        del self.records[0]['meta']
        with self.assertRaisesRegex(ValueError, '0.9.4'):
            self.build()


class UnifyIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source, self.output = self.root / 'site', self.root / 'dist'
        self.source.mkdir()
        shutil.copytree(SCRIPTS, self.root / 'scripts', ignore=shutil.ignore_patterns('__pycache__'))
        shutil.copytree(ROOT / 'includes', self.root / 'includes')
        shutil.copytree(SITE / 'assets', self.source / 'assets')
        shutil.copyfile(ROOT / 'unify.yaml', self.root / 'unify.yaml')
        shutil.copyfile(ROOT / 'site.config.json', self.root / 'site.config.json')
        shutil.copyfile(ROOT / 'lab.json', self.root / 'lab.json')
        self.write('_layout.html', '<!doctype html><html lang="en"><head><title>— Site</title><meta name="robots" content="noindex"></head><body><include src="/includes/base/nav.html"></include><main><slot></slot></main></body></html>')
        self.write('docs/index.md', '---\ntitle: Lab guide\ndescription: Current guide\n---\n# Lab guide')
        self.write('docs/inventory/observed.md', '---\ntitle: Observed inventory\ndescription: Observations\n---\n# Observed inventory')
        self.write('index.md', '---\ntitle: Dashboard\ndescription: Current lab indicators\n---\n# Dashboard\n\n<div class="dashboard">Current metrics</div>')
        self.write('status.html', '<html><head><title>Dashboard moved</title><meta name="description" content="Dashboard bookmark"><meta name="role" content="bookmark"><meta http-equiv="refresh" content="0; url=/"></head><body><h1>Dashboard moved</h1><a href="/">Dashboard</a></body></html>')
        self.write('articles/quoted.md', '---\ntitle: "DNS: names & HTTPS"\ndescription: "Private resolution: not ad blocking"\ndate: 2026-10-01\nseries: Network notes\npart: 1\ntags: [resolver, wifi]\n---\n# DNS: names & HTTPS\n\nCorpus-only needle: rambutan')
        self.write('articles/ledger.html', '<html><head><title>Ledger</title><meta name="description" content="Measurements"><link rel="canonical" href="https://example.test/lab/articles/ledger/"></head><body><h1>Ledger</h1></body></html>')
        self.write('old.html', '<html><head><title>Ledger moved</title><meta name="description" content="Old bookmark"><meta name="role" content="bookmark"><meta http-equiv="refresh" content="0; url=/articles/ledger.html"></head><body><h1>Ledger moved</h1><a href="/articles/ledger.html">Open ledger</a></body></html>')
        self.write('_archive/private.md', '# PRIVATE')
        self.write('.env', 'DO_NOT_PUBLISH=private')
        self.args = ['bun', str(ROOT / 'node_modules/@fwdslsh/unify/src/cli.js'), '-s', str(self.source), '-o', str(self.output),
                     '--base-url', 'https://example.test/lab/', '--pretty-urls']

    def tearDown(self):
        self.temp.cleanup()

    def write(self, name, text):
        path = self.source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def run_unify(self, *flags, success=True):
        run = subprocess.run(self.args + list(flags), cwd=self.root, text=True, capture_output=True)
        if success:
            self.assertEqual(run.returncode, 0, run.stderr + run.stdout)
        return run

    def build(self):
        self.run_unify('build', '--audit', '--strict')

    def test_real_cli_inventory_metadata_overlay_urls_and_noindex(self):
        self.build()
        paths = {'/lab/', '/lab/reports/', '/lab/sitemap/', '/lab/status/', '/lab/articles/', '/lab/health/',
                 '/lab/incidents/', '/lab/docs/', '/lab/docs/inventory/observed/',
                 '/lab/articles/quoted/', '/lab/articles/ledger/', '/lab/old/'}
        text = (self.output / 'sitemap/index.html').read_text()
        links = Links()
        links.feed(text)
        self.assertEqual({h for h in links.links if not h.startswith('#')}, paths)
        self.assertIn('/lab/articles/quoted/', paths)
        self.assertIn('DNS: names &amp; HTTPS', text)
        self.assertIn('network notes resolver wifi', text)
        self.assertIn('/lab/assets/navigation.js', text)
        self.assertIn('content="noindex"', text)
        self.assertFalse((self.output / '_data').exists())
        self.assertFalse((self.output / '_scripts').exists())
        self.assertFalse((self.output / '.env').exists())
        self.assertFalse((self.output / '_archive').exists())
        self.assertFalse((self.output / 'unify.yaml').exists())
        self.assertFalse((self.output / 'scripts').exists())
        self.assertFalse((self.output / 'includes').exists())
        self.assertFalse((self.output / 'tests').exists())
        corpus = json.loads((self.output / 'assets/unify/search-corpus.json').read_text())
        self.assertEqual(corpus['schemaVersion'], 1)
        bodies = {p['path']: p['text'] for p in corpus['pages']}
        self.assertIn('rambutan', bodies['/lab/articles/quoted/'])
        self.assertFalse(any('PRIVATE' in text or 'DO_NOT_PUBLISH' in text for text in bodies.values()))
        self.assertIn('/lab/old/', paths)  # Full directory preserves the bookmark.
        home = (self.output / 'index.html').read_text()
        self.assertIn('class="dashboard"', home)
        self.assertNotIn('type="search"', home)
        article = (self.output / 'articles/index.html').read_text()
        self.assertIn('href="/lab/articles/ledger/"', article)
        self.assertIn('Part 1', article)
        self.assertNotIn('href="/lab/old/"', (self.output / 'index.html').read_text())
        self.assertIn('/lab/articles/ledger/', (self.output / 'old/index.html').read_text())

    def test_project_root_defaults_inventory_and_canonical_completion(self):
        # Use the actual root config without CLI source/inventory/canonical flags.
        # This catches the 0.10 change to config-relative generator paths.
        self.args = self.args[:2] + self.args[4:]
        self.build()
        sitemap = (self.output / 'sitemap/index.html').read_text()
        self.assertIn('/lab/articles/quoted/', sitemap)
        self.assertIn('network notes resolver wifi', sitemap)
        quoted = (self.output / 'articles/quoted/index.html').read_text()
        self.assertNotIn('rel="canonical"', quoted)  # Respect the lab's noindex policy.
        layout = self.source / '_layout.html'
        layout.write_text(layout.read_text().replace('<meta name="robots" content="noindex">', ''))
        self.build()  # Canonical completion applies only to indexable pages.
        quoted = (self.output / 'articles/quoted/index.html').read_text()
        self.assertIn('rel="canonical" href="https://example.test/lab/articles/quoted/"', quoted)
        ledger = (self.output / 'articles/ledger/index.html').read_text()
        self.assertEqual(ledger.count('rel="canonical"'), 1)
        self.assertIn('href="https://example.test/lab/articles/ledger/"', ledger)

    def test_env_driven_identity_escaping_and_publication_boundaries(self):
        # Exercise the actual shared layout, not only the fixture layout.
        shutil.copyfile(SITE / '_layout.html', self.source / '_layout.html')
        shutil.copyfile(SITE / 'styles.css', self.source / 'styles.css')
        (self.root / '.env').write_text(
            'SITE_BRAND="Other & <lab>"\nSITE_BADGE="Test # lab"\n'
            'SITE_TITLE="Other reports"\nSITE_HOME_LABEL="Other dashboard home"\n'
            'SITE_FOOTER_TEXT="Private test lab"\nSITE_FILES_URL=""\n'
            'SITE_REPORTS_INTRO="Our investigations"\n'
            'UNRELATED_PRIVATE_KEY="do-not-render-this"\n')
        self.build()
        home = (self.output / 'index.html').read_text()
        self.assertIn('Other &amp; &lt;lab&gt;', home)
        self.assertIn('<p class="tag">Test # lab</p>', home)
        self.assertIn('Dashboard — Other reports', home)
        self.assertIn('Other dashboard home', home)
        self.assertIn('Private test lab', home)
        self.assertNotIn('Shared files', home)
        self.assertNotIn('fwdslsh', home)
        self.assertIn('Our investigations', (self.output / 'reports/index.html').read_text())
        for path in self.output.rglob('*'):
            if path.is_file():
                self.assertNotIn(b'do-not-render-this', path.read_bytes())
        for name in ('.env', 'site.config.json', '_generated', 'DEPLOY.md'):
            self.assertFalse((self.output / name).exists())
        # Explicit process environment beats the project .env.
        env = {**os.environ, 'SITE_BRAND': 'Inherited brand'}
        run = subprocess.run(self.args + ['build', '--strict'], cwd=self.root,
                             env=env, text=True, capture_output=True)
        self.assertEqual(run.returncode, 0, run.stderr + run.stdout)
        self.assertIn('Inherited brand', (self.output / 'index.html').read_text())

    def test_invalid_env_settings_preserve_existing_build(self):
        self.build()
        before = (self.output / 'index.html').read_bytes()
        for value in ('REPORTS_TIMEZONE=Not/AZone', 'REPORTS_WEEKLY_KEEP=-1',
                      'REPORTS_HEALTH_PREFIX=../escape', 'SITE_FILES_URL=javascript:alert(1)'):
            with self.subTest(value=value):
                (self.root / '.env').write_text(value + '\n')
                run = self.run_unify('build', '--strict', success=False)
                self.assertNotEqual(run.returncode, 0)
                self.assertEqual(before, (self.output / 'index.html').read_bytes())

    def test_failed_generator_preserves_previous_build(self):
        self.build()
        before = {p.relative_to(self.output): p.read_bytes() for p in self.output.rglob('*') if p.is_file()}
        (self.root / 'scripts/gen.mjs').write_text('throw new Error("generator failed")')
        self.assertNotEqual(self.run_unify('build', '--audit', '--strict', success=False).returncode, 0)
        self.assertEqual(before, {p.relative_to(self.output): p.read_bytes() for p in self.output.rglob('*') if p.is_file()})

    def test_audit_gate_runs_generator_once_and_preserves_output_on_findings(self):
        self.build()
        before = {p.relative_to(self.output): p.read_bytes() for p in self.output.rglob('*') if p.is_file()}
        (self.root / 'scripts/gen.mjs').write_text('''import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
appendFileSync(join(process.argv[2], '_generator-runs'), 'run\\n');
''')
        self.write('incomplete.html', '<html><head><title>Incomplete</title></head><body><h1>Incomplete</h1></body></html>')
        result = self.run_unify('build', '--audit', '--strict', success=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('description-missing', result.stdout + result.stderr)
        self.assertEqual((self.source / '_generator-runs').read_text(), 'run\n')
        self.assertEqual(before, {p.relative_to(self.output): p.read_bytes() for p in self.output.rglob('*') if p.is_file()})

    def test_content_outside_html_is_a_located_error_not_silent_loss(self):
        self.build()
        before = {p.relative_to(self.output): p.read_bytes() for p in self.output.rglob('*') if p.is_file()}
        self.write('stray.html', '<html><head><title>Stray</title><meta name="description" content="Stray test"><meta name="role" content="history"></head><body><h1>Stray</h1></body></html>\n<script>console.log("must not disappear")</script>')
        result = self.run_unify('build', '--audit', '--strict', success=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('stray.html', result.stderr)
        self.assertIn('stray.html:2:', result.stderr)
        self.assertIn('would be dropped', result.stderr)
        self.assertEqual(before, {p.relative_to(self.output): p.read_bytes() for p in self.output.rglob('*') if p.is_file()})

    def test_add_edit_delete_and_missing_metadata_in_one_pass(self):
        self.build()
        self.write('articles/new file.md', '---\ntitle: "New & useful"\ndescription: >-\n  A multiline\n  description\ndate: 2026-10-02\n---\n# New & useful')
        self.build()
        text = (self.output / 'articles/index.html').read_text()
        self.assertIn('New &amp; useful', text)
        self.assertIn('A multiline description', text)
        self.assertIn('/lab/articles/new%20file/', text)
        self.write('articles/new file.md', '---\ntitle: Revised\ndescription: Revised description\n---\n# Revised')
        self.build()
        self.assertIn('Revised description', (self.output / 'articles/index.html').read_text())
        (self.source / 'articles/new file.md').unlink()
        self.build()
        self.assertNotIn('Revised description', (self.output / 'articles/index.html').read_text())
        before = {p.relative_to(self.output): p.read_bytes() for p in self.output.rglob('*') if p.is_file()}
        self.write('broken.md', '---\ntitle: [unterminated\n---\n# Broken')
        self.assertNotEqual(self.run_unify('build', '--audit', '--strict', success=False).returncode, 0)
        self.assertEqual(before, {p.relative_to(self.output): p.read_bytes() for p in self.output.rglob('*') if p.is_file()})


if __name__ == '__main__':
    unittest.main()
