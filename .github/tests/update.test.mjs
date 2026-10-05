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
  const run = args => spawnSync('bun', [cli, ...args], { cwd: project, env: fixtureEnvironment(), encoding: 'utf8' });
  const changed = () => {
    write(join(template, 'config.json'), '{"reports":{"weeklyKeep":4}}');
    write(join(template, 'compose.yaml'), '# Incoming deployment defaults\n');
    write(join(template, 'unify.yaml'), '# Incoming build defaults\n');
    write(join(template, 'site/_includes/header.html'), readFileSync(join(template, 'site/_includes/header.html'), 'utf8').replace('home</a>', 'Incoming lab</a>'));
    write(join(template, 'site/articles/welcome.md'), '# Incoming welcome seed');
    write(join(template, 'scripts/html.mjs'), readFileSync(join(template, 'scripts/html.mjs'), 'utf8') + '\n// Upstream shared improvement\n');
    write(join(template, 'scripts/new-fixture.mjs'), '// Newly shared fixture\n');
    rmSync(join(template, 'scripts/retired-fixture.mjs'));
    commit();
  };
  return { temp, template, project, source, commit, run, changed, close: () => rmSync(temp, { recursive: true, force: true }) };
}

for (const form of ['directory', 'git']) test(`native ${form} update changes shared tools without resetting content/config/private state`, () => {
  const f = fixture(form);
  try {
    const initialized = f.run(['init', f.source]); expect(initialized.status, initialized.stderr).toBe(0);
    write(join(f.project, 'config.json'), '{"reports":{"weeklyKeep":3}}');
    const header = join(f.project, 'site/_includes/header.html'); write(header, readFileSync(header, 'utf8').replace('home</a>', 'My configured lab</a>'));
    for (const name of ['.env', 'ssh/key', 'state/private.txt', 'published/private.txt', 'site/assets/custom.css']) write(join(f.project, name), 'private fixture bytes');
    write(join(f.project, 'site/articles/custom.md'), '---\ntitle: Custom\ndescription: My article\n---\n# My article\n');
    const protectedFiles = ['config.json', 'compose.yaml', 'unify.yaml', 'site/_includes/header.html', 'site/articles/welcome.md', 'site/articles/custom.md', '.env', 'ssh/key', 'state/private.txt', 'published/private.txt', 'site/assets/custom.css'];
    const before = digest(f.project);
    f.changed();
    const preview = f.run(['update', '--dry-run']); expect(preview.status, preview.stderr).toBe(0);
    expect(preview.stdout).toContain('would update scripts/html.mjs');
    expect(preview.stdout).toContain('would remove scripts/retired-fixture.mjs');
    expect(digest(f.project)).toEqual(before);
    const update = f.run(['update']); expect(update.status, update.stderr).toBe(0);
    expect(readFileSync(join(f.project, 'scripts/html.mjs'), 'utf8')).toContain('Upstream shared improvement');
    expect(existsSync(join(f.project, 'scripts/new-fixture.mjs'))).toBe(true);
    expect(existsSync(join(f.project, 'scripts/retired-fixture.mjs'))).toBe(false);
    const after = digest(f.project);
    for (const name of protectedFiles) expect(after[name], name).toBe(before[name]);
    const repeat = f.run(['update']); expect(repeat.status, repeat.stderr).toBe(0); expect(repeat.stdout).toContain('nothing to do');
    expect(digest(f.project)).toEqual(after);
    const build = f.run(['build', '--clean', '--audit', '--strict']); expect(build.status, build.stderr).toBe(0);
    expect(readFileSync(join(f.project, 'dist/index.html'), 'utf8')).toContain('My configured lab');
    expect(existsSync(join(f.project, 'dist/unify.template.json'))).toBe(false);
    expect(existsSync(join(f.project, 'dist/config.json'))).toBe(false);
  } finally { f.close(); }
}, 60000);

test('native updates preserve and repeatedly report local shared-file conflicts', () => {
  const f = fixture();
  try {
    expect(f.run(['init', f.source]).status).toBe(0);
    const file = join(f.project, 'scripts/html.mjs');
    write(file, readFileSync(file, 'utf8') + '\n// Operator customization\n');
    const local = readFileSync(file, 'utf8');
    f.changed();
    for (let i = 0; i < 2; i++) {
      const update = f.run(['update']); expect(update.status).toBe(1);
      expect(update.stdout).toContain('conflict scripts/html.mjs'); expect(readFileSync(file, 'utf8')).toBe(local);
    }
    // Non-conflicting updates apply even though the conflict yields exit 1.
    expect(existsSync(join(f.project, 'scripts/new-fixture.mjs'))).toBe(true);
    write(file, readFileSync(join(f.template, 'scripts/html.mjs'), 'utf8'));
    expect(f.run(['update']).status).toBe(0);
    expect(f.run(['update']).stdout).toContain('nothing to do');
  } finally { f.close(); }
});

test('adoption records an older site without changing its files, then updates through native ownership', () => {
  const f = fixture();
  try {
    cpSync(f.template, f.project, { recursive: true, filter: path => !path.endsWith('/unify.template.json') });
    write(join(f.template, 'unify.template.json'), '{}'); // Older template had no owned declaration.
    write(join(f.project, 'config.json'), '{"reports":{"weeklyKeep":3}}');
    const before = digest(f.project);
    expect(f.run(['update']).status).toBe(2);
    expect(f.run(['update', '--adopt', f.source, '--dry-run']).status).toBe(0);
    expect(digest(f.project)).toEqual(before);
    const adopt = f.run(['update', '--adopt', f.source]); expect(adopt.status, adopt.stderr).toBe(0);
    const after = digest(f.project); delete after['unify.template.json']; expect(after).toEqual(before);
    write(join(f.template, 'unify.template.json'), readFileSync(join(root, 'unify.template.json'), 'utf8'));
    f.changed();
    const updated = f.run(['update']); expect(updated.status, updated.stderr).toBe(0);
    expect(readFileSync(join(f.project, 'config.json'), 'utf8')).toContain('weeklyKeep');
    expect(readFileSync(join(f.project, 'scripts/html.mjs'), 'utf8')).toContain('Upstream shared improvement');
  } finally { f.close(); }
});

test('failed template fetch and symlink conflicts do not overwrite local or external data', () => {
  const f = fixture();
  try {
    expect(f.run(['init', f.source]).status).toBe(0);
    const before = digest(f.project);
    const failed = f.run(['update', join(f.temp, 'missing-template')]); expect(failed.status).not.toBe(0); expect(digest(f.project)).toEqual(before);
    const external = join(f.temp, 'external'); write(external, 'Outside project');
    const file = join(f.project, 'scripts/html.mjs'); rmSync(file); symlinkSync(external, file);
    f.changed();
    const update = f.run(['update']); expect(update.status).toBe(1); expect(update.stdout).toContain('symlink');
    expect(readFileSync(external, 'utf8')).toBe('Outside project');
  } finally { f.close(); }
});
