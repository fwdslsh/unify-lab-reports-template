"""Render navigation from Unify's authored source inventory, not composed pages."""
from html import escape
from datetime import datetime
import json
import os
from pathlib import Path
import sys
import importlib.util

from sitemap import build_sitemap
from settings import load
from lab import load_lab, load_snapshot

CONFIG = load()

SECTIONS = (
    ('articles', 'Articles', CONFIG['SITE_ARTICLES_DESCRIPTION']),
    ('health', 'Weekly reviews', CONFIG['SITE_HEALTH_DESCRIPTION']),
    ('incidents', 'Incidents', CONFIG['SITE_INCIDENTS_DESCRIPTION']),
)


# These pages belong to this generator and are absent from source-pages.json.
GENERATED = (
    ('index.html', 'Lab dashboard', 'At-a-glance lab health, actionable alerts, hosts, endpoints, containers and backup evidence.'),
    ('docs/inventory/observed.html', 'Observed inventory', 'Safe facts from the latest explicit collection.'),
    ('reports/index.html', 'Reports', CONFIG['SITE_REPORTS_DESCRIPTION']),
    ('sitemap.html', 'All pages', CONFIG['SITE_DIRECTORY_DESCRIPTION']),
    *((folder + '/index.html', title, description) for folder, title, description in SECTIONS),
)


def metas(record, name):
    return [meta.get('content', '') for meta in record['meta'] if meta.get('name') == name]


def one(record, name):
    return next(iter(metas(record, name)), '')


def validate(record):
    name, role = record['source'], one(record, 'role')
    for field in ('title', 'description'):
        if not (record[field] or '').strip():
            raise ValueError(f'{name}: authored {field} is required')
    if '/' not in name and name not in ('status.html', 'status.md', '404.html', 'index.html', 'index.md', 'sitemap.html') \
            and role not in ('history', 'bookmark'):
        raise ValueError(f'{name}: new reports belong in articles/, incidents/, or health/; old URLs use role: history')
    date = record['date']
    if name.startswith(('health/', 'incidents/')) and role != 'history' and not date:
        raise ValueError(f'{name}: observation date is required (historical unknowns use role: history)')
    if date:
        try:
            datetime.fromisoformat(date.replace('Z', '+00:00'))
        except ValueError as error:
            raise ValueError(f'{name}: date must be ISO 8601') from error


def read_pages(path):
    report = json.loads(path.read_text())
    if report.get('schemaVersion') != 1:
        raise ValueError('Unsupported Unify source inventory schema')
    pages, seen = [], set()
    for record in report['pages']:
        if 'meta' not in record:
            raise ValueError('Navigation needs Unify 0.9.4+ source metadata')
        validate(record)
        href, name = record['href'], record['source']
        if href in seen:
            raise ValueError('Duplicate navigation target: ' + href)
        seen.add(href)
        pages.append({
            'href': href, 'path': href, 'title': record['title'] or name,
            'desc': record['description'] or '', 'date': record['date'] or '',
            'part': one(record, 'part'), 'series': one(record, 'series'),
            'tags': metas(record, 'tags'), 'output': str(Path(name).with_suffix('.html')),
            'bookmark': one(record, 'role') == 'bookmark',
            'history': one(record, 'role') == 'history',
        })
    for name, title, description in GENERATED:
        href = '/' + name
        if href in seen and name in ('index.html', 'docs/inventory/observed.html'):
            continue  # An authored replacement uses Unify's normal source precedence.
        if href in seen:
            raise ValueError('Generated navigation collides with source: ' + name)
        pages.append({'href': href, 'path': href, 'title': title, 'desc': description,
                      'date': '', 'part': '', 'series': '', 'tags': [],
                      'output': name, 'bookmark': False, 'history': False, 'generated': True})
    return pages


def rows(pages, compact=False):
    result = []
    for entry in pages:
        date, part = entry['date'], entry['part']
        accessible_label = ''
        label = '' if compact else f'Part {part}' if part.isdigit() else part
        if date:
            parsed = datetime.fromisoformat(date.replace('Z', '+00:00'))
            short_date = f'{parsed:%b} {parsed.day}, {parsed.year}'
            stamp = f'<time datetime="{escape(date, quote=True)}">{escape(label or short_date)}</time>'
            if entry['output'].startswith('health/'):
                accessible_label = f' aria-label="{escape(entry["title"] + " — " + short_date, quote=True)}"'
        else:
            stamp = f'<span class="entry-meta">{escape(label)}</span>' if label else ''
        description = f'<p class="desc">{escape(entry["desc"])}</p>' if entry['desc'] and not compact else ''
        result.append(f'<li><a class="title" href="{escape(entry["href"], quote=True)}"{accessible_label}>{escape(entry["title"])}</a>{stamp}{description}</li>')
    return '\n'.join(result) or '<li>No entries in this section yet.</li>'


def page(output, name, title, description, content):
    target = output / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(f'''<!doctype html>
<html lang="en"><head><title>{escape(title)}</title>
<meta name="description" content="{escape(description, quote=True)}"></head>
<body class="wide"><h1>{escape(title)}</h1>{content}</body></html>
''')


def generate(source, output, inventory):
    pages = read_pages(inventory)
    collections = {}
    for folder, title, description in SECTIONS:
        selected = [p for p in pages if p['output'].startswith(folder + '/')
                    and p['output'] != folder + '/index.html' and not p['bookmark']]
        selected.sort(key=lambda p: (p['date'], p['title']), reverse=True)
        if folder == 'health':
            if len(selected) > CONFIG['REPORTS_WEEKLY_KEEP'] or any(
                    Path(p['output']).name.startswith(CONFIG['REPORTS_HEALTH_PREFIX'] + '-spot-') for p in selected):
                raise ValueError(f'Health publication is limited to {CONFIG["REPORTS_WEEKLY_KEEP"]} weekly reviews and no spot reports; run health retention first')
            description = CONFIG['SITE_HEALTH_INTRO']
            selected = [{**p, 'title': 'Weekly review'} for p in selected]
        if folder == 'articles':
            selected.sort(key=lambda p: (not bool(p['series']), p['series'].casefold(),
                                        0 if p['part'].isdigit() else 1,
                                        int(p['part']) if p['part'].isdigit() else 0))
        collections[folder] = selected
        context = '<p><a href="/status.html">Current status</a></p>' if folder == 'health' else ''
        page(output, folder + '/index.html', title, description,
             f'<p>{escape(description)}</p>{context}<ul class="reports">{rows(selected, compact=folder == "health")}</ul>')
    # Preserve older root report URLs, but make their content discoverable in
    # Reports rather than treating every historical report as a hidden bookmark.
    reports = [p for p in pages if not p['bookmark'] and
               (p['output'].startswith(('health/', 'incidents/')) and not p['output'].endswith('/index.html')
                or '/' not in p['output'] and p['output'] not in ('index.html', 'status.html', 'sitemap.html', '404.html'))]
    reports = [{**p, 'title': 'Weekly review'} if p['output'].startswith('health/') else p for p in reports]
    reports.sort(key=lambda p: (bool(p['date']), p['date'], p['title']), reverse=True)
    page(output, 'reports/index.html', 'Reports', CONFIG['SITE_REPORTS_DESCRIPTION'],
         '<p class="lede">' + escape(CONFIG['SITE_REPORTS_INTRO']) + '</p><ul class="reports">' + rows(reports, compact=True) + '</ul>')
    build_sitemap(output, pages, CONFIG['SITE_SITEMAP_DESCRIPTION'])
    print(f'navigation: {len(pages)} Unify page records', file=sys.stderr)
    return pages


if __name__ == '__main__':
    try:
        pages = generate(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
        config, snapshot = load_lab(), load_snapshot()
        spec = importlib.util.spec_from_file_location('dashboard', Path(__file__).parent / 'status-dashboard.py')
        dashboard = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(dashboard)
        previous_path = Path(os.environ.get('LAB_PREVIOUS', str(Path(__file__).parent.parent / 'state/previous.json')))
        previous = json.loads(previous_path.read_text()) if previous_path.exists() else {}
        if any(p['output'] == 'index.html' and p.get('generated') for p in pages):
            Path(sys.argv[2]).joinpath('index.html').write_text(dashboard.render(snapshot, config, previous))
        if any(p['output'] == 'docs/inventory/observed.html' and p.get('generated') for p in pages):
            content = '<p>Observed: ' + escape(snapshot.get('observed_at') or 'Not collected') + '</p>'
            for name, host in snapshot.get('hosts', {}).items():
                if name not in {item['id'] for item in config.get('hosts', [])}:
                    continue
                content += '<h2>' + escape(name) + '</h2>'
                content += '<p>' + ('Collected' if host.get('collected') else 'Unavailable or not probed') + '</p>'
                content += dashboard.definition([(key, '; '.join(values)) for key, values in host.get('facts', {}).items()])
                content += '<ul>' + ''.join('<li>' + escape(c['name']) + ' · ' + escape(c.get('state', 'Unknown')) + '</li>' for c in host.get('docker', [])) + '</ul>'
            page(Path(sys.argv[2]), 'docs/inventory/observed.html', 'Observed inventory',
                 'Safe facts from the latest explicit collection.', content)
        fragments = Path(sys.argv[2]) / '_generated'
        fragments.mkdir(exist_ok=True)
        fragments.joinpath('head.html').write_text(
            f'<title>— {escape(CONFIG["SITE_TITLE"])}</title>\n'
            f'    <meta name="description" content="{escape(CONFIG["SITE_DESCRIPTION"], quote=True)}">')
        fragments.joinpath('brand.html').write_text(
            f'<p class="mark"><a href="/" aria-label="{escape(CONFIG["SITE_HOME_LABEL"], quote=True)}">'
            f'<span>{escape(CONFIG["SITE_BRAND_PREFIX"])}</span>{escape(CONFIG["SITE_BRAND"])}</a></p>\n'
            f'        <p class="tag">{escape(CONFIG["SITE_BADGE"])}</p>')
        footer = f'<p>{escape(CONFIG["SITE_FOOTER_TEXT"]).replace("·", "&middot;")}</p>\n'
        if CONFIG['SITE_FILES_URL']:
            footer += f'<a href="{escape(CONFIG["SITE_FILES_URL"], quote=True)}">{escape(CONFIG["SITE_FILES_LABEL"])}</a>\n'
        fragments.joinpath('footer.html').write_text(footer.rstrip('\n'))
    except (ValueError, KeyError, OSError) as error:
        sys.exit('reports: ' + str(error))
