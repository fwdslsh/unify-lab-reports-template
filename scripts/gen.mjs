// Unify owns discovery, metadata, composition and URLs. This writes its overlay.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig, readSnapshot, runtimePath } from './config.mjs';
import { renderDashboard } from './dashboard.mjs';
import { escape as e, isoDate, definition } from './html.mjs';

const collections = [['articles', 'Articles', 'Articles and references.'], ['health', 'Weekly reviews', 'The latest weekly health reviews. Older reviews remain in Git.'], ['incidents', 'Incidents', 'Investigations and incident reports.']];
const generated = [['docs/inventory/observed.html', 'Observed inventory', 'Safe facts from the latest explicit collection.'], ['reports/index.html', 'Reports', 'Reviews, investigations and recorded measurements.'], ['sitemap.html', 'All pages', 'Find any published page.'], ...collections.map(([folder, title, description]) => [folder + '/index.html', title, description])];
const metas = (record, name) => record.meta.filter(m => m.name === name).map(m => m.content ?? '');
export function readPages(inventory, site = {}) {
  if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.pages)) throw new Error('Unsupported Unify source inventory schema');
  const pages = [], seen = new Set();
  for (const record of inventory.pages) {
    if (!Array.isArray(record.meta)) throw new Error('Navigation needs Unify source metadata');
    const role = metas(record, 'role')[0], name = record.source;
    for (const field of ['title', 'description']) if (!record[field]?.trim()) throw new Error(`${name}: authored ${field} is required`);
    if (!name.includes('/') && !['status.html', 'status.md', '404.html', 'index.html', 'index.md', 'sitemap.html'].includes(name) && !['history', 'bookmark'].includes(role)) throw new Error(`${name}: new reports belong in articles/, incidents/, or health/; old URLs use role: history`);
    if (/^(health|incidents)\//.test(name) && role !== 'history' && !record.date) throw new Error(`${name}: observation date is required (historical unknowns use role: history)`);
    if (record.date) isoDate(record.date);
    if (seen.has(record.href)) throw new Error('Duplicate navigation target: ' + record.href);
    seen.add(record.href);
    pages.push({ href: record.href, path: record.href, title: record.title, desc: record.description, date: record.date ?? '', part: metas(record, 'part')[0] ?? '', series: metas(record, 'series')[0] ?? '', tags: metas(record, 'tags'), output: name.replace(/\.[^.]+$/, '.html'), bookmark: role === 'bookmark', history: role === 'history' });
  }
  for (const [name, title, desc] of generated) {
    if (seen.has('/' + name)) {
      if (name === 'docs/inventory/observed.html') continue;
      throw new Error('Generated navigation collides with source: ' + name);
    }
    const textKey = { 'reports/index.html': 'reportsDescription', 'sitemap.html': 'directoryDescription', 'articles/index.html': 'articlesDescription', 'health/index.html': 'healthDescription', 'incidents/index.html': 'incidentsDescription' }[name];
    pages.push({ href: '/' + name, path: '/' + name, title, desc: site[textKey] ?? desc, date: '', part: '', series: '', tags: [], output: name, bookmark: false, generated: true });
  }
  return pages;
}
const newest = (a, b) => b.date.localeCompare(a.date) || b.title.localeCompare(a.title);
function rows(pages, compact = false) {
  return pages.map(entry => {
    const label = compact ? '' : /^\d+$/.test(entry.part) ? 'Part ' + entry.part : entry.part;
    const date = entry.date ? new Date(entry.date) : null;
    const short = date ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(date) : '';
    const stamp = date ? `<time datetime="${e(entry.date)}">${e(label || short)}</time>` : label ? `<span class="entry-meta">${e(label)}</span>` : '';
    const aria = date && entry.output.startsWith('health/') ? ` aria-label="${e(entry.title + ' — ' + short)}"` : '';
    return `<li><a class="title" href="${e(entry.href)}"${aria}>${e(entry.title)}</a>${stamp}${entry.desc && !compact ? `<p class="desc">${e(entry.desc)}</p>` : ''}</li>`;
  }).join('\n') || '<li>No entries in this section yet.</li>';
}
function write(output, name, content) { const path = join(output, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
function page(output, name, title, description, content) { write(output, name, `<!doctype html><html lang="en"><head><title>${e(title)}</title><meta name="description" content="${e(description)}"></head><body class="wide"><h1>${e(title)}</h1>${content}</body></html>\n`); }
function sitemap(output, pages, site) {
  const groups = new Map(['Dashboard', 'Reports', 'Guides', 'Articles', 'Other pages and bookmarks'].map(name => [name, []]));
  for (const entry of pages) {
    const name = entry.output;
    const group = entry.bookmark || name === 'sitemap.html' || name.startsWith('docs/history/') ? 'Other pages and bookmarks' : name.startsWith('docs/') ? 'Guides' : ['index.html', 'status.html'].includes(name) ? 'Dashboard' : name.startsWith('articles/') ? 'Articles' : 'Reports';
    groups.get(group).push(entry);
  }
  const sections = [], jumps = [];
  let index = 0;
  for (const [title, entries] of groups) {
    const id = 'section-' + index++;
    if (!entries.length) continue;
    if (title !== 'Other pages and bookmarks') jumps.push(`<a href="#${id}">${e(title)}</a>`);
    entries.sort(title === 'Reports' ? newest : (a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()) || a.href.localeCompare(b.href));
    if (title === 'Dashboard') entries.sort((a, b) => Number(a.output !== 'index.html') - Number(b.output !== 'index.html'));
    const items = entries.map(p => `<li data-page data-page-path="${e(p.path)}" data-search="${e([p.title, p.path, p.desc, p.series, ...p.tags].filter(Boolean).join(' ').toLowerCase())}"><a href="${e(p.href)}" title="${e(p.path)}">${e(p.title)}</a><small hidden>${e(p.path)}</small></li>`).join('');
    sections.push(title === 'Other pages and bookmarks' ? `<details data-page-group id="${id}"><summary>${e(title)} <span class="dim">(${entries.length})</span></summary><ul>${items}</ul></details>` : `<section data-page-group id="${id}"><h2>${e(title)}</h2><ul>${items}</ul></section>`);
  }
  page(output, 'sitemap.html', 'All pages', site.sitemapDescription ?? 'Find guides, articles, incidents and weekly reviews.', `<div class="sitemap"><label for="page-search">Find a page</label><input type="search" id="page-search" placeholder="Search pages…" aria-controls="page-list" autocomplete="off"><p id="page-count" class="dim" role="status" aria-live="polite">${pages.length} pages</p><nav class="sitemap-jumps" aria-label="Page sections">${jumps.join('')}</nav><div id="page-list">${sections.join('')}</div><p id="no-pages" hidden>No matching pages. Try a different title, address or description.</p><noscript><p>All pages remain listed. Enable JavaScript to filter or search page content.</p></noscript></div><script type="module" src="/assets/navigation.js"></script>`);
}
export function generate(output, inventory, config, snapshot, previous = {}) {
  const pages = readPages(inventory, config.site);
  for (const [folder, title, fallback] of collections) {
    const description = config.site[folder + 'Description'] ?? fallback;
    let selected = pages.filter(p => p.output.startsWith(folder + '/') && p.output !== folder + '/index.html' && !p.bookmark).sort(newest);
    if (folder === 'health') {
      if (selected.length > config.reports.weeklyKeep || selected.some(p => p.output.split('/').at(-1).startsWith(config.reports.prefix + '-spot-'))) throw new Error(`Health publication is limited to ${config.reports.weeklyKeep} weekly reviews and no spot reports; run health retention first`);
      selected = selected.map(p => ({ ...p, title: 'Weekly review' }));
    }
    if (folder === 'articles') selected.sort((a, b) => Number(!a.series) - Number(!b.series) || a.series.toLowerCase().localeCompare(b.series.toLowerCase()) || Number(!/^\d+$/.test(a.part)) - Number(!/^\d+$/.test(b.part)) || (Number(a.part) || 0) - (Number(b.part) || 0));
    page(output, folder + '/index.html', title, description, `<p>${e(folder === 'health' ? config.site.healthIntro ?? description : description)}</p>${folder === 'health' ? '<p><a href="/">Current status</a></p>' : ''}<ul class="reports">${rows(selected, folder === 'health')}</ul>`);
  }
  const reports = pages.filter(p => !p.bookmark && (/^(health|incidents)\//.test(p.output) && !p.output.endsWith('/index.html') || !p.output.includes('/') && !['index.html', 'status.html', 'sitemap.html', '404.html'].includes(p.output))).map(p => p.output.startsWith('health/') ? { ...p, title: 'Weekly review' } : p).sort(newest);
  page(output, 'reports/index.html', 'Reports', config.site.reportsDescription ?? 'Reviews, investigations and recorded measurements.', `${config.site.reportsIntro ? '<p>' + e(config.site.reportsIntro) + '</p>' : ''}<ul class="reports">${rows(reports, true)}</ul>`);
  sitemap(output, pages, config.site);
  write(output, '_generated/dashboard.html', renderDashboard(snapshot, config, previous));
  if (pages.some(p => p.output === 'docs/inventory/observed.html' && p.generated)) {
    let content = '<p>Observed: ' + e(snapshot.observed_at || 'Not collected') + '</p>';
    for (const host of config.hosts) {
      const observed = snapshot.hosts?.[host.id] ?? {};
      content += `<h2>${e(host.id)}</h2><p>${observed.collected ? 'Collected' : 'Unavailable or not probed'}</p>` + definition(Object.entries(observed.facts ?? {}).map(([key, values]) => [key, values.join('; ')]));
      content += '<ul>' + (observed.docker ?? []).map(c => `<li>${e(c.name)} · ${e(c.state ?? 'Unknown')}</li>`).join('') + '</ul>';
    }
    page(output, 'docs/inventory/observed.html', 'Observed inventory', 'Safe facts from the latest explicit collection.', content);
  }
  const s = config.site;
  write(output, '_generated/head.html', `<title>— ${e(s.title)}</title><meta name="description" content="${e(s.description)}">`);
  write(output, '_generated/brand.html', `<p class="mark"><a href="/" aria-label="${e(s.homeLabel ?? s.title + ' home')}"><span>${e(s.prefix)}</span>${e(s.brand)}</a></p><p class="tag">${e(s.badge)}</p>`);
  write(output, '_generated/footer.html', `<p>${e(s.footer)}</p>${s.filesUrl ? `<a href="${e(s.filesUrl)}">${e(s.filesLabel)}</a>` : ''}`);
  return pages;
}
if (import.meta.main) {
  const [, , , output, contextPath] = process.argv;
  const context = JSON.parse(readFileSync(contextPath, 'utf8'));
  if (context.schemaVersion !== 1 || !context.inputs?.sourcePages) throw new Error('Navigation needs Unify source inventory');
  generate(output, JSON.parse(readFileSync(context.inputs.sourcePages, 'utf8')), loadConfig(), readSnapshot(), readSnapshot(runtimePath('PREVIOUS_FILE', 'state/previous.json')));
}
