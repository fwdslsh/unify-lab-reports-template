import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fixtureEnvironment } from '../../tests/fixture-env.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
function run(command, args, cwd, overrides = {}) {
  const result = spawnSync(command, args, { cwd, env: { ...fixtureEnvironment(), ...overrides }, encoding: 'utf8' });
  expect(result.status, result.stderr + result.stdout).toBe(0);
  return result.stdout;
}

test('real npm payload excludes private state and builds with only shipped files', () => {
  const temp = mkdtempSync(join(tmpdir(), 'lab-template-pack.'));
  try {
    const author = join(temp, 'author');
    const excluded = new Set(['node_modules', '.git', 'dist', 'state', 'published', 'ssh', '__pycache__']);
    cpSync(root, author, { recursive: true, filter: path => !path.slice(root.length).split('/').some(part => excluded.has(part) || part === '.env' || part.endsWith('.tgz')) });
    const secret = 'fixture-private-' + 'never-distribute';
    writeFileSync(join(author, '.env'), 'PRIVATE_TOKEN=' + secret);
    for (const name of ['state', 'ssh', 'published']) {
      mkdirSync(join(author, name), { recursive: true });
      writeFileSync(join(author, name, 'private.txt'), secret);
    }
    const [packed] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp], author));
    const names = packed.files.map(file => file.path);
    for (const required of ['.env.example', '.gitignore', 'bun.lock', 'config.json', 'unify.template.json', 'compose.yaml', 'docs/agent-install.md', 'site/index.html', 'includes/nav.html', 'DEPLOY.md', 'LICENSE', 'scripts/gen.mjs', 'scripts/deploy.sh', 'scripts/probes/monitor.sh']) expect(names).toContain(required);
    expect(packed.name).toBe('@fwdslsh/unify-lab-reports-template');
    expect(names.some(name => name.endsWith('.py') || name.startsWith('includes/base/') || name.startsWith('LICENSES/'))).toBe(false);
    expect(names.some(name => /^(\.env$|state\/|ssh\/|published\/|dist\/|node_modules\/|\.git\/)/.test(name))).toBe(false);
    const extracted = join(temp, 'extracted');
    mkdirSync(extracted);
    run('tar', ['-xzf', join(temp, packed.filename), '-C', extracted], author);
    const project = join(extracted, 'package');
    expect(Object.keys(JSON.parse(readFileSync(join(project, 'unify.template.json'), 'utf8')))).toEqual(['owned']);
    run('bun', ['install', '--frozen-lockfile', '--ignore-scripts'], project);
    run('bun', ['run', 'build'], project);
    const home = readFileSync(join(project, 'dist/index.html'), 'utf8');
    expect(home).toContain('No observations yet');
    expect(home).toContain('Not assessed');
    expect(home).not.toContain('No issues in checked signals');
    expect(home).not.toContain('<input');
    const configPath = join(project, 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.site.brand = 'Fresh lab';
    writeFileSync(configPath, JSON.stringify(config));
    run('bun', ['run', 'build'], project);
    expect(readFileSync(join(project, 'dist/index.html'), 'utf8')).toContain('Fresh lab');
    function files(path) { return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)]); }
    for (const file of files(project).filter(path => !path.includes('/node_modules/'))) expect(readFileSync(file, 'utf8')).not.toContain(secret);
  } finally { rmSync(temp, { recursive: true, force: true }); }
}, 60000);

test('native npm init and versioned updates use real tarballs without publishing to a registry', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'lab-template-npm-init.'));
  let registry;
  try {
    const [packed] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp], root));
    const packages = [packed];
    const spec = packed.name + '@' + packed.version;
    registry = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
      const tarball = packages.find(pkg => new URL(request.url).pathname === '/' + pkg.filename);
      if (tarball) return new Response(Bun.file(join(temp, tarball.filename)));
      return Response.json({ name: packed.name, 'dist-tags': { latest: packages.at(-1).version }, versions: Object.fromEntries(packages.map(pkg => [pkg.version, { name: pkg.name, version: pkg.version, dist: { tarball: `http://127.0.0.1:${registry.port}/${pkg.filename}` } }])) });
    } });
    const project = join(temp, 'project'); mkdirSync(project);
    const cli = join(root, 'node_modules/@fwdslsh/unify/src/cli.js');
    const child = Bun.spawn(['bun', cli, 'init', spec], { cwd: project, env: { ...fixtureEnvironment(), npm_config_registry: `http://127.0.0.1:${registry.port}`, npm_config_cache: join(temp, 'npm-cache') }, stdout: 'pipe', stderr: 'pipe' });
    expect(await child.exited, await new Response(child.stderr).text()).toBe(0);
    const record = JSON.parse(readFileSync(join(project, 'unify.template.json'), 'utf8'));
    expect(record.schemaVersion).toBe(1);
    expect(record.owned).toContain('config.json');
    expect(record.source).toBe(spec);
    expect(readFileSync(join(project, 'compose.yaml'), 'utf8')).toContain('${STATE_PATH:-./state}');
    expect(readFileSync(join(project, 'docs/agent-install.md'), 'utf8')).toContain('Docker');
    const build = run('bun', [cli, 'build', '--clean', '--audit', '--strict'], project);
    expect(readFileSync(join(project, 'dist/index.html'), 'utf8')).toContain('Not collected');
    writeFileSync(join(project, 'config.json'), '{"site":{"brand":"Npm custom lab"}}');
    const beforeUpdate = readFileSync(join(project, 'config.json'), 'utf8');
    const update = Bun.spawn(['bun', cli, 'update'], { cwd: project, env: { ...fixtureEnvironment(), npm_config_registry: `http://127.0.0.1:${registry.port}`, npm_config_cache: join(temp, 'npm-cache') }, stdout: 'pipe', stderr: 'pipe' });
    expect(await update.exited, await new Response(update.stderr).text()).toBe(0);
    expect(await new Response(update.stdout).text()).toContain('nothing to do');
    expect(readFileSync(join(project, 'config.json'), 'utf8')).toBe(beforeUpdate);
    const author = join(temp, 'next-author');
    const excluded = new Set(['node_modules', '.git', 'dist', 'state', 'published', 'ssh', '__pycache__']);
    cpSync(root, author, { recursive: true, filter: path => !path.slice(root.length).split('/').some(p => excluded.has(p) || p === '.env' || p.endsWith('.tgz')) });
    const pkg = JSON.parse(readFileSync(join(author, 'package.json'), 'utf8'));
    pkg.version = '9.9.9-update-fixture.1'; writeFileSync(join(author, 'package.json'), JSON.stringify(pkg));
    writeFileSync(join(author, 'config.json'), '{"site":{"brand":"New default"}}');
    writeFileSync(join(author, 'scripts/html.mjs'), readFileSync(join(author, 'scripts/html.mjs'), 'utf8') + '\n// npm template improvement\n');
    const [next] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp], author)); packages.push(next);
    const upgraded = Bun.spawn(['bun', cli, 'update', `${next.name}@${next.version}`], { cwd: project, env: { ...fixtureEnvironment(), npm_config_registry: `http://127.0.0.1:${registry.port}`, npm_config_cache: join(temp, 'npm-cache') }, stdout: 'pipe', stderr: 'pipe' });
    expect(await upgraded.exited, await new Response(upgraded.stderr).text()).toBe(0);
    expect(readFileSync(join(project, 'config.json'), 'utf8')).toBe(beforeUpdate);
    expect(readFileSync(join(project, 'scripts/html.mjs'), 'utf8')).toContain('npm template improvement');
    expect(JSON.parse(readFileSync(join(project, 'unify.template.json'), 'utf8')).revision).toBe(next.version);
    run('bun', [cli, 'build', '--clean', '--audit', '--strict'], project);
    expect(readFileSync(join(project, 'dist/index.html'), 'utf8')).toContain('Npm custom lab');
  } finally { registry?.stop(true); rmSync(temp, { recursive: true, force: true }); }
}, 60000);

test('explicit collection probes local HTTP but never stores response bodies', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'lab-collection-http.'));
  const body = 'fixture-private-response-' + 'do-not-copy';
  const server = createServer((request, response) => { response.statusCode = request.url === '/health' ? 200 : 503; response.end(body); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const config = join(temp, 'config.json');
    const snapshot = join(temp, 'observed.json');
    writeFileSync(config, JSON.stringify({ hosts: [], endpoints: [
      { id: 'up', label: 'Up', url: `http://127.0.0.1:${port}/health` },
      { id: 'down', label: 'Down', url: `http://127.0.0.1:${port}/error` }
    ] }));
    // Async child keeps the local fixture server responsive.
    const child = Bun.spawn(['bun', 'scripts/collect.mjs', '--config', config, '--output', snapshot], { cwd: root, env: fixtureEnvironment(), stdout: 'pipe', stderr: 'pipe' });
    const status = await child.exited;
    expect(status, await new Response(child.stderr).text()).toBe(0);
    const data = readFileSync(snapshot, 'utf8');
    expect(data).not.toContain(body);
    expect(JSON.parse(data).endpoints.map(row => row.status)).toEqual(['200', '503']);
    const observed = JSON.parse(data);
    observed.hosts['not-configured'] = { collected: true, facts: { host: ['outside-inventory-scope'] } };
    writeFileSync(snapshot, JSON.stringify(observed));
    run('bun', ['run', 'build', '--', '-o', join(temp, 'dist')], root, { CONFIG_FILE: config, SNAPSHOT_FILE: snapshot });
    const html = readFileSync(join(temp, 'dist/index.html'), 'utf8');
    expect(html).toContain('Down · unreachable');
    expect(html).toContain('HTTP reachability only');
    expect(html).not.toContain(body);
    expect(readFileSync(join(temp, 'dist/docs/inventory/observed.html'), 'utf8')).not.toContain('outside-inventory-scope');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(temp, { recursive: true, force: true }); }
}, 60000);
