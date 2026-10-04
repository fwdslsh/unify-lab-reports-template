import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { fixtureEnvironment } from './fixture-env.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'node_modules/@fwdslsh/unify/src/cli.js');
const run = (args, cwd) => spawnSync('bun', [cli, ...args], { cwd, env: fixtureEnvironment(), encoding: 'utf8' });
const hashes = dir => Object.fromEntries(readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const path = join(dir, e.name);
  return e.isDirectory() ? Object.entries(hashes(path)).map(([name, hash]) => [e.name + '/' + name, hash]) : [[e.name, createHash('sha256').update(readFileSync(path)).digest('hex')]];
}));
for (const form of ['directory', 'git']) test(`native ${form} init builds without a package manifest; repeated init preserves customizations`, () => {
  const temp = mkdtempSync(join(tmpdir(), 'reports-native-init.'));
  try {
    const template = join(temp, form === 'git' ? 'template.git' : 'template'), site = join(temp, 'site-project');
    cpSync(root, template, { recursive: true, filter: path => !path.slice(root.length).split('/').some(p => ['node_modules', '.git', 'dist', 'state', 'published', 'ssh', '.env'].includes(p) || p.endsWith('.tgz')) });
    mkdirSync(site);
    if (form === 'git') {
      const git = args => { const r = spawnSync('git', args, { cwd: template, encoding: 'utf8' }); expect(r.status, r.stderr).toBe(0); };
      git(['init', '-q', '-b', 'main']); git(['config', 'user.name', 'Init fixture']); git(['config', 'user.email', 'test@example.invalid']); git(['add', '-A']); git(['commit', '-qm', 'Fixture']);
    }
    const source = form === 'git' ? 'file://' + template + '#main' : template;
    const initialized = run(['init', source], site); expect(initialized.status, initialized.stderr).toBe(0);
    expect(existsSync(join(site, 'package.json'))).toBe(false);
    expect(existsSync(join(site, 'bun.lock'))).toBe(false);
    for (const name of ['config.json', 'compose.yaml', 'docs/agent-install.md', 'site/index.html', 'scripts/gen.mjs']) expect(existsSync(join(site, name))).toBe(true);
    const built = run(['build', '--clean', '--audit', '--strict'], site); expect(built.status, built.stderr).toBe(0);
    expect(readFileSync(join(site, 'dist/index.html'), 'utf8')).toContain('Not collected');
    writeFileSync(join(site, 'config.json'), '{"site":{"brand":"Keep my lab"}}');
    writeFileSync(join(site, '.env'), 'PRIVATE_TOKEN=keep-this-private');
    mkdirSync(join(site, 'state')); writeFileSync(join(site, 'state/observed.json'), 'runtime-canary');
    writeFileSync(join(site, 'site/articles/custom.md'), '---\ntitle: Keep\ndescription: Custom article\n---\n# Keep my article\n');
    const before = hashes(site), repeated = run(['init', source], site);
    expect(repeated.status).not.toBe(0); expect(repeated.stderr).toContain('already exist');
    expect(hashes(site)).toEqual(before);
  } finally { rmSync(temp, { recursive: true, force: true }); }
}, 60000);
