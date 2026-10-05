import { test, expect } from 'bun:test';
import { mkdtempSync, cpSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { renderPreview } from '../node_modules/@fwdslsh/unify/src/core/preview.js';
import { resolutionRoots } from '../node_modules/@fwdslsh/unify/src/core/paths.js';

const root = fileURLToPath(new URL('../', import.meta.url));
test('native source previews resolve every authored include without a build or overlay', async () => {
  const project = mkdtempSync(join(tmpdir(), 'reports-preview.'));
  try {
    const sourceRoot = join(project, 'site');
    cpSync(join(root, 'site'), sourceRoot, { recursive: true });
    const roots = resolutionRoots(sourceRoot, null, project);
    for (const relPath of ['_layout.html', '_includes/header.html', '_includes/nav.html', '_includes/footer.html', ...['dashboard', 'inventory', 'articles', 'health', 'incidents', 'reports', 'sitemap'].map(id => `_includes/${id}.fragment.html`)]) {
      const preview = await renderPreview({ sourceRoot, roots, relPath, config: false });
      expect(preview.status, relPath).toBe(200);
      expect(preview.html, relPath).not.toContain('unify-preview-problems');
      expect(preview.html, relPath).not.toContain('_generated/');
      expect(preview.html, relPath).toContain('/styles.css');
    }
    expect(existsSync(join(project, 'dist'))).toBe(false);
    writeFileSync(join(sourceRoot, '_includes/footer.html'), '<p>Preview default footer</p>');
    writeFileSync(join(sourceRoot, 'preview.md'), '---\ntitle: Preview\ndescription: Preview fixture\n---\n# Markdown main content\n');
    const md = await renderPreview({ sourceRoot, roots, relPath: '_layout.html', page: 'preview.md', config: false });
    expect(md.status).toBe(200); expect(md.html).not.toContain('unify-preview-problems');
    expect(md.html).toContain('Preview default footer'); expect(md.html).toContain('Markdown main content');
    writeFileSync(join(sourceRoot, 'example.html'), '<!doctype html><html><head><title>Custom page</title><meta name="description" content="A custom page"></head><body><div slot="brand">Custom brand</div><p slot="footer">Custom footer</p><h1>Main content</h1></body></html>');
    const html = await renderPreview({ sourceRoot, roots, relPath: '_layout.html', page: 'example.html', config: false });
    expect(html.status).toBe(200); expect(html.html).not.toContain('unify-preview-problems');
    expect(html.html).toContain('Custom brand'); expect(html.html).toContain('Custom footer'); expect(html.html).toContain('Main content');
    expect(html.html).not.toContain('Preview default footer'); expect(html.html).not.toContain('<slot');
  } finally { rmSync(project, { recursive: true, force: true }); }
});
