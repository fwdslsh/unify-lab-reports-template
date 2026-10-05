import { test, expect } from 'bun:test';
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readPages, generate } from '../scripts/gen.mjs';
import { validateConfig } from '../scripts/config.mjs';
import { fixtureEnvironment } from './fixture-env.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const record = (source, title = 'Example', meta = [], date = null) => ({ source, title, description: 'Useful description', date, meta, href: '/' + source.replace(/\.[^.]+$/, '.html') });
const inventory = pages => ({ schemaVersion: 1, pages });
test('source inventory schema, duplicate paths, metadata and generated collisions fail closed', () => {
  for (const input of [{ schemaVersion: 99, pages: [] }, inventory([record('articles/x.md'), record('articles/x.md')]), inventory([{ ...record('articles/x.md'), meta: undefined }]), inventory([record('reports/index.md')])]) expect(() => readPages(input)).toThrow();
});
for (const page of [{ ...record('articles/x.md'), title: null }, { ...record('articles/x.md'), description: '' }, record('new-report.md'), record('health/review.md'), record('incidents/incident.md'), record('articles/bad.md', 'Date', [], '2026-02-30')]) test(`invalid authored metadata ${JSON.stringify(page)} is rejected`, () => expect(() => readPages(inventory([page]))).toThrow());
test('series, part, roles and repeated tags come only from authored metadata', () => {
  const pages = readPages(inventory([record('articles/x.md', 'X', [{ name: 'series', content: 'Models' }, { name: 'part', content: '2' }, { name: 'tags', content: 'ai' }, { name: 'tags', content: 'lab' }]), record('old.html', 'Old', [{ name: 'role', content: 'history' }]), record('bookmark.html', 'Bookmark', [{ name: 'role', content: 'bookmark' }])]));
  expect(pages[0].series).toBe('Models'); expect(pages[0].part).toBe('2'); expect(pages[0].tags).toEqual(['ai', 'lab']); expect(pages[1].history).toBe(true); expect(pages[2].bookmark).toBe(true);
});
test('generation is repeatable, escapes search data, and includes historical reports without invented dates', () => {
  const temp = mkdtempSync(join(tmpdir(), 'generation.'));
  try {
    const pages = inventory([record('index.html', 'Lab dashboard'), record('old.html', 'Old & <new>', [{ name: 'role', content: 'history' }]), record('articles/series2.md', 'Second', [{ name: 'series', content: 'Series' }, { name: 'part', content: '2' }]), record('articles/series1.md', 'First', [{ name: 'series', content: 'Series' }, { name: 'part', content: '1' }]), record('old-bookmark.html', 'Archived bookmark', [{ name: 'role', content: 'bookmark' }])]);
    const config = validateConfig({}), snapshot = { observed_at: null, hosts: {}, endpoints: [] };
    generate(temp, pages, config, snapshot);
    expect(readFileSync(join(temp, '_generated/brand.html'), 'utf8')).toContain('<span>/</span>home</a>');
    const reports = readFileSync(join(temp, 'reports/index.html'), 'utf8'), sitemap = readFileSync(join(temp, 'sitemap.html'), 'utf8'), articles = readFileSync(join(temp, 'articles/index.html'), 'utf8');
    expect(reports).toContain('Old &amp; &lt;new&gt;'); expect(reports).not.toContain('<time'); expect(reports).not.toContain('Archived bookmark');
    expect(sitemap).toContain('Archived bookmark'); expect(sitemap).toContain('Other pages and bookmarks'); expect(sitemap).toContain('<noscript>'); expect(sitemap).toContain('data-search=');
    expect(articles.indexOf('First')).toBeLessThan(articles.indexOf('Second'));
    generate(temp, pages, config, snapshot); expect(readFileSync(join(temp, 'sitemap.html'), 'utf8')).toBe(sitemap);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
test('the one retention setting controls both generation and retention', () => {
  const temp = mkdtempSync(join(tmpdir(), 'health-cap.'));
  try {
    const pages = inventory([1, 2, 3].map(i => record(`health/lab-review-${i}.md`, 'Review', [], `2026-09-0${i}`)));
    const snapshot = { observed_at: null, hosts: {}, endpoints: [] };
    expect(() => generate(temp, pages, validateConfig({}), snapshot)).toThrow('limited to 2');
    generate(temp, pages, validateConfig({ reports: { weeklyKeep: 3 } }), snapshot);
    expect((readFileSync(join(temp, 'health/index.html'), 'utf8').match(/class="title"/g) ?? []).length).toBe(3);
    expect(() => generate(temp, inventory([record('health/lab-spot-1.md', 'Spot', [], '2026-09-01')]), validateConfig({}), snapshot)).toThrow('no spot');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
test('flat includes, explicit homepage and original responsive theme are normal source', () => {
  const layout = readFileSync(join(root, 'site/_layout.html'), 'utf8'), nav = readFileSync(join(root, 'includes/nav.html'), 'utf8'), css = readFileSync(join(root, 'site/styles.css'), 'utf8');
  expect(layout).toContain('/includes/nav.html'); expect(layout).not.toContain('includes/base/'); expect(existsSync(join(root, 'site/index.html'))).toBe(true);
  for (const label of ['Reports', 'Guides', 'Articles', 'All pages']) expect(nav).toContain(`<span>${label}</span>`);
  expect(css).toContain('--primary: #3fb950'); expect(css).toContain('env(safe-area-inset-bottom'); expect(css).toContain('position: fixed'); expect(css).toContain('min-height: 56px');
});
test('site-owned section copy and home label survive shared generator updates', () => {
  const temp = mkdtempSync(join(tmpdir(), 'custom-section-copy.'));
  try {
    const site = { homeLabel: 'My dashboard', articlesDescription: 'Custom articles', healthDescription: 'Custom health', healthIntro: 'Custom health intro', reportsDescription: 'Custom report metadata', reportsIntro: 'Custom report intro', directoryDescription: 'Custom directory metadata', sitemapDescription: 'Custom sitemap metadata', incidentsDescription: 'Custom incidents' };
    generate(temp, inventory([]), validateConfig({ site }), { observed_at: null, hosts: {}, endpoints: [] });
    expect(readFileSync(join(temp, 'articles/index.html'), 'utf8')).toContain('Custom articles');
    expect(readFileSync(join(temp, 'health/index.html'), 'utf8')).toContain('Custom health intro');
    expect(readFileSync(join(temp, 'reports/index.html'), 'utf8')).toContain('Custom report intro');
    expect(readFileSync(join(temp, 'sitemap.html'), 'utf8')).toContain('Custom sitemap metadata');
    expect(readFileSync(join(temp, '_generated/brand.html'), 'utf8')).toContain('My dashboard');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
function project() {
  const path = mkdtempSync(join(tmpdir(), 'unify-project.'));
  for (const name of ['scripts', 'includes', 'config.json', 'unify.yaml', 'package.json', 'bun.lock']) cpSync(join(root, name), join(path, name), { recursive: true });
  mkdirSync(join(path, 'site'));
  for (const name of ['_layout.html', 'styles.css', 'assets']) cpSync(join(root, 'site', name), join(path, 'site', name), { recursive: true });
  const env = fixtureEnvironment();
  const run = args => spawnSync('bun', args, { cwd: path, env, encoding: 'utf8' });
  const install = run(['install', '--frozen-lockfile', '--ignore-scripts']); expect(install.status, install.stderr).toBe(0);
  const write = (name, text) => { const file = join(path, 'site', name); mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text); };
  write('index.html', '<!doctype html><html lang="en"><head><title>Lab dashboard</title><meta name="description" content="Lab observations"></head><body class="wide"><include src="/_generated/dashboard.html"></include></body></html>');
  write('docs/index.md', '---\ntitle: Guides\ndescription: Lab guide\n---\n# Guides\n[Backups](services/backups.html)\n');
  write('docs/services/backups.md', '---\ntitle: Backups\ndescription: Backup guide\n---\n# Backups\n');
  const html = name => readFileSync(join(path, 'dist', name), 'utf8');
  return { path, env, run, write, html, close: () => rmSync(path, { recursive: true, force: true }) };
}
test('real Unify builds, rewrites prefixed URLs and indexes metadata/content without leaking private files', () => {
  const f = project();
  try {
    f.write('articles/first.md', '---\ntitle: First\ndescription: Series entry\nseries: Models\npart: 1\ntags: [models, lab]\n---\n# First\nBodyOnlyCanary\n');
    writeFileSync(join(f.path, '.env'), 'PRIVATE_TOKEN=never-publish-canary'); writeFileSync(join(f.path, 'site/.env'), 'never-publish-canary');
    const config = JSON.parse(readFileSync(join(f.path, 'config.json'), 'utf8')); config.site.brand = 'Fresh <lab>'; writeFileSync(join(f.path, 'config.json'), JSON.stringify(config));
    const result = f.run(['run', 'build', '--', '--base-url', 'https://example.test/lab/', '--pretty-urls']); expect(result.status, result.stderr).toBe(0);
    const home = f.html('index.html'); expect(home).toContain('Fresh &lt;lab&gt;'); expect(home).toContain('/lab/docs/'); expect(home).not.toContain('never-publish-canary'); expect(home).not.toContain('<input');
    expect(f.html('sitemap/index.html')).toContain('models lab'); expect(f.html('assets/unify/search-corpus.json')).toContain('BodyOnlyCanary');
    expect(existsSync(join(f.path, 'dist/config.json'))).toBe(false); expect(existsSync(join(f.path, 'dist/.env'))).toBe(false); expect(home).toContain('noindex');
  } finally { f.close(); }
}, 60000);
test('one build handles report additions, edits and deletions; bad metadata preserves the old output', () => {
  const f = project();
  try {
    const body = title => `---\ntitle: ${title}\ndescription: An article\n---\n# ${title}\n`;
    f.write('articles/added.md', body('Added')); expect(f.run(['run', 'build']).status).toBe(0); expect(f.html('articles/index.html')).toContain('Added');
    f.write('articles/added.md', body('Edited')); expect(f.run(['run', 'build']).status).toBe(0); expect(f.html('articles/index.html')).toContain('Edited');
    rmSync(join(f.path, 'site/articles/added.md')); expect(f.run(['run', 'build']).status).toBe(0); expect(f.html('articles/index.html')).not.toContain('Edited');
    const good = f.html('index.html'); f.write('articles/bad.md', '---\ntitle: No description\n---\n# Bad\n');
    expect(f.run(['run', 'build']).status).not.toBe(0); expect(f.html('index.html')).toBe(good);
  } finally { f.close(); }
}, 60000);
test('invalid config and audited dangling links cannot replace good output', () => {
  const f = project();
  try {
    expect(f.run(['run', 'build']).status).toBe(0); const good = f.html('index.html'), path = join(f.path, 'config.json'), original = readFileSync(path, 'utf8');
    writeFileSync(path, '{"reports":{"weeklyKeep":0}}'); expect(f.run(['run', 'build']).status).not.toBe(0); expect(f.html('index.html')).toBe(good);
    writeFileSync(path, original); f.write('articles/link.md', '---\ntitle: Broken\ndescription: Broken link\n---\n[Missing](/missing.html)\n');
    expect(f.run(['run', 'build']).status).not.toBe(0); expect(f.html('index.html')).toBe(good);
  } finally { f.close(); }
}, 60000);
