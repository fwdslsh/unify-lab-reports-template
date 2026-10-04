"""Render a JavaScript-optional page directory from Unify page records."""
from html import escape
from pathlib import PurePosixPath

SECTIONS = ('Dashboard', 'Reports', 'Guides', 'Articles', 'Other pages and bookmarks')


def section(output):
    parts = PurePosixPath(output).parts
    if parts[0] == 'docs':
        return 'Other pages and bookmarks' if len(parts) > 1 and parts[1] == 'history' else 'Guides'
    if output in ('index.html', 'status.html'):
        return 'Dashboard'
    return 'Articles' if parts[0] == 'articles' else 'Reports'


def build_sitemap(output, pages, description):
    groups = {name: [] for name in SECTIONS}
    for entry in pages:
        name = entry['output']
        secondary = entry['bookmark'] or name == 'sitemap.html'
        group = 'Other pages and bookmarks' if secondary else section(name)
        groups[group].append(entry)
    sections, jumps = [], []
    for number, (title, entries) in enumerate(groups.items()):
        if not entries:
            continue
        identity = f'section-{number}'
        if title != 'Other pages and bookmarks':
            jumps.append(f'<a href="#{identity}">{escape(title)}</a>')
        rows = []
        ordered = sorted(entries, key=lambda p: (p['date'], p['title']), reverse=True) if title == 'Reports' \
            else sorted(entries, key=lambda p: (p['title'].casefold(), p['href']))
        if title == 'Dashboard':
            ordered.sort(key=lambda p: p['output'] != 'index.html')
        for entry in ordered:
            href = escape(entry['href'], quote=True)
            address = escape(entry['path'])
            query = escape(' '.join(filter(None, (entry['title'], entry['path'], entry['desc'],
                                                 entry['series'], *entry['tags']))).lower(), quote=True)
            rows.append(f'<li data-page data-page-path="{escape(entry["path"], quote=True)}" data-search="{query}"><a href="{href}" title="{address}">{escape(entry["title"])}</a><small hidden>{address}</small></li>')
        if title == 'Other pages and bookmarks':
            sections.append(f'<details data-page-group id="{identity}"><summary>{escape(title)} <span class="dim">({len(entries)})</span></summary><ul>{"".join(rows)}</ul></details>')
        else:
            sections.append(f'<section data-page-group id="{identity}"><h2>{escape(title)}</h2><ul>{"".join(rows)}</ul></section>')
    (output / 'sitemap.html').write_text(f'''<!doctype html>
<html lang="en"><head><title>All pages</title>
<meta name="description" content="{escape(description, quote=True)}"></head>
<body class="wide"><div class="sitemap"><h1>All pages</h1>
<label for="page-search">Find a page</label>
<input type="search" id="page-search" placeholder="Search pages…" aria-controls="page-list" autocomplete="off">
<p id="page-count" class="dim" role="status" aria-live="polite">{len(pages)} pages</p>
<nav class="sitemap-jumps" aria-label="Page sections">{''.join(jumps)}</nav>
<div id="page-list">{''.join(sections)}</div>
<p id="no-pages" hidden>No matching pages. Try a different title, address or description.</p>
<noscript><p>All pages remain listed. Enable JavaScript to filter or search page content.</p></noscript>
</div><script type="module" src="/assets/navigation.js"></script></body></html>
''')
