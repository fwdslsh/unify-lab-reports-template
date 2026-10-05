import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fixtureEnvironment } from '../../tests/fixture-env.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = join(root, 'node_modules/@fwdslsh/unify/src/cli.js');
const clean = path => !path.slice(root.length).split('/').some(p => ['node_modules', '.git', 'dist', 'state', 'published', 'ssh', '.env', '__pycache__'].includes(p) || p.endsWith('.tgz'));
const write = (path, content) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); };
const digest = dir => Object.fromEntries(readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const path = join(dir, e.name);
  return e.isDirectory() ? Object.entries(digest(path)).map(([name, hash]) => [e.name + '/' + name, hash]) : [[e.name, createHash('sha256').update(readFileSync(path)).digest('hex')]];
}));
function fixture(form = 'directory') {
  const temp = mkdtempSync(join(tmpdir(), 'reports-native-update.'));
  const template = join(temp, 'template'), project = join(temp, 'project');
  cpSync(root, template, { recursive: true, filter: clean });
  write(join(template, 'scripts/retired-fixture.mjs'), '// Shared fixture removed by the next template\n');
  mkdirSync(project);
  const git = args => { const r = spawnSync('git', args, { cwd: template, encoding: 'utf8' }); expect(r.status, r.stderr).toBe(0); return r.stdout.trim(); };
  if (form === 'git') {
    git(['init', '-q', '-b', 'main']); git(['config', 'user.name', 'Update fixture']); git(['config', 'user.email', 'test@example.invalid']);
  }
  const commit = () => { if (form === 'git') { git(['add', '-A']); git(['commit', '-qm', 'Fixture revision']); } };
  commit();
  const source = form === 'git' ? 'file://' + template + '#main' : template;
  const run = (args, input = '') => spawnSync('bun', [cli, ...args], { cwd: project, env: fixtureEnvironment(), encoding: 'utf8', input });
  const changed = () => {
    write(join(template, 'site/_examples/config.json'), '{"reports":{"weeklyKeep":4}}');
    write(join(template, 'scripts/html.mjs'), readFileSync(join(template, 'scripts/html.mjs'), 'utf8') + '\n// Upstream shared improvement\n');
    write(join(template, 'scripts/new-fixture.mjs'), '// Newly shared fixture\n');
    rmSync(join(template, 'scripts/retired-fixture.mjs'));
    commit();
  };
  return { temp, template, project, source, commit, run, changed, close: () => rmSync(temp, { recursive: true, force: true }) };
}

for (const form of ['directory', 'git']) test(`native ${form} update preserves actual content/settings and requires confirmation`, () => {
  const f = fixture(form);
  try {
    const init = f.run(['init', f.source, '--audit']); expect(init.status, init.stderr).toBe(0);
    expect(existsSync(join(f.project, 'unify.template.json'))).toBe(false);
    expect(readFileSync(join(f.project, 'unify.yaml'), 'utf8')).toContain('template:');
    expect(existsSync(join(f.project, 'config.json'))).toBe(false);
    write(join(f.project, 'config.json'), '{"reports":{"weeklyKeep":3}}');
    write(join(f.project, 'site/index.html'), '<!doctype html><html><head><title>Custom home</title><meta name="description" content="My lab"></head><body><div slot="brand">My configured lab</div><h1>My dashboard</h1></body></html>');
    write(join(f.project, 'site/articles/custom.md'), '---\ntitle: Custom\ndescription: My article\n---\n# My article\n');
    write(join(f.project, 'site/docs/custom.md'), '---\ntitle: My guide\ndescription: My guide\n---\n# My guide\n');
    const protectedFiles = ['config.json', 'site/index.html', 'site/articles/custom.md', 'site/docs/custom.md', '.env', 'ssh/key', 'state/private.txt', 'published/private.txt'];
    for (const name of protectedFiles.slice(4)) write(join(f.project, name), 'private fixture bytes');
    const before = digest(f.project); f.changed();
    const preview = f.run(['update', '--dry-run']); expect(preview.status, preview.stderr).toBe(0);
    expect(preview.stdout).toContain('would overwrite scripts/html.mjs');
    expect(preview.stdout).toContain('would add scripts/new-fixture.mjs');
    expect(digest(f.project)).toEqual(before);
    for (const input of ['', 'n\n']) {
      const declined = f.run(['update'], input);
      expect(declined.status).toBe(1); expect(declined.stdout).toContain('nothing written');
      expect(digest(f.project)).toEqual(before);
    }
    const updated = f.run(['update', '--yes']); expect(updated.status, updated.stderr).toBe(0);
    expect(readFileSync(join(f.project, 'scripts/html.mjs'), 'utf8')).toContain('Upstream shared improvement');
    expect(existsSync(join(f.project, 'scripts/new-fixture.mjs'))).toBe(true);
    expect(existsSync(join(f.project, 'scripts/retired-fixture.mjs'))).toBe(true);
    const after = digest(f.project);
    for (const name of protectedFiles) expect(after[name], name).toBe(before[name]);
    const repeat = f.run(['update']); expect(repeat.status, repeat.stderr).toBe(0);
    expect(repeat.stdout).toContain('nothing to do'); expect(digest(f.project)).toEqual(after);
    const build = f.run(['build', '--clean', '--audit', '--strict']); expect(build.status, build.stderr).toBe(0);
    expect(readFileSync(join(f.project, 'dist/index.html'), 'utf8')).toContain('My configured lab');
    expect(existsSync(join(f.project, 'dist/_examples'))).toBe(false);
    expect(existsSync(join(f.project, 'dist/config.json'))).toBe(false);
  } finally { f.close(); }
}, 60000);

test('shared local edits are preserved on decline and replaced only after explicit acceptance', () => {
  const f = fixture();
  try {
    expect(f.run(['init', f.source]).status).toBe(0);
    const file = join(f.project, 'scripts/html.mjs');
    write(file, readFileSync(file, 'utf8') + '\n// Local customization\n');
    const before = digest(f.project);
    const declined = f.run(['update'], 'n\n'); expect(declined.status).toBe(1);
    expect(digest(f.project)).toEqual(before);
    const accepted = f.run(['update'], 'y\n'); expect(accepted.status, accepted.stderr).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(readFileSync(join(f.template, 'scripts/html.mjs'), 'utf8'));
    expect(f.run(['update']).stdout).toContain('nothing to do');
  } finally { f.close(); }
});

test('failed fetch and symlink targets leave external data untouched', () => {
  const f = fixture();
  try {
    expect(f.run(['init', f.source]).status).toBe(0);
    const before = digest(f.project);
    const failed = f.run(['update', join(f.temp, 'missing-template'), '--yes']);
    expect(failed.status).not.toBe(0); expect(digest(f.project)).toEqual(before);
    const external = join(f.temp, 'external'); write(external, 'Outside project');
    const file = join(f.project, 'scripts/html.mjs'); rmSync(file); symlinkSync(external, file);
    f.changed();
    const updated = f.run(['update', '--yes']); expect(updated.status, updated.stderr).toBe(0);
    expect(updated.stdout).toContain('symlink');
    expect(readFileSync(external, 'utf8')).toBe('Outside project');
  } finally { f.close(); }
});
