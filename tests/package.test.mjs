import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fixtureEnvironment } from './fixture-env.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
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
    for (const required of ['.env.example', '.gitignore', 'bun.lock', 'lab.json', 'site.config.json', 'DEPLOY.md', 'LICENSE', 'NOTICE.md', 'LICENSES/CC-BY-4.0.txt', 'scripts/gen.mjs', 'scripts/probes/linux.sh']) expect(names).toContain(required);
    expect(packed.name).toBe('@fwdslsh/unify-lab-reports-template');
    expect(names.some(name => /^(\.env$|state\/|ssh\/|published\/|dist\/|node_modules\/|\.git\/)/.test(name))).toBe(false);
    const extracted = join(temp, 'extracted');
    mkdirSync(extracted);
    run('tar', ['-xzf', join(temp, packed.filename), '-C', extracted], author);
    const project = join(extracted, 'package');
    run('bun', ['install', '--frozen-lockfile', '--ignore-scripts'], project);
    run('bun', ['run', 'build'], project);
    const home = readFileSync(join(project, 'dist/index.html'), 'utf8');
    expect(home).toContain('No observations yet');
    expect(home).toContain('Not assessed');
    expect(home).not.toContain('No issues in checked signals');
    expect(home).not.toContain('<input');
    run('bun', ['run', 'build'], project, { SITE_BRAND: 'Fresh lab', SITE_HOME_LABEL: 'Fresh dashboard' });
    expect(readFileSync(join(project, 'dist/index.html'), 'utf8')).toContain('Fresh lab');
    function files(path) { return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)]); }
    for (const file of files(project).filter(path => !path.includes('/node_modules/'))) expect(readFileSync(file, 'utf8')).not.toContain(secret);
  } finally { rmSync(temp, { recursive: true, force: true }); }
}, 60000);

test('explicit collection probes local HTTP but never stores response bodies', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'lab-collection-http.'));
  const body = 'fixture-private-response-' + 'do-not-copy';
  const server = createServer((request, response) => { response.statusCode = request.url === '/health' ? 200 : 503; response.end(body); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const config = join(temp, 'lab.json');
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
    run('bun', ['run', 'build', '--', '-o', join(temp, 'dist')], root, { LAB_CONFIG: config, LAB_SNAPSHOT: snapshot });
    const html = readFileSync(join(temp, 'dist/index.html'), 'utf8');
    expect(html).toContain('Down · unreachable');
    expect(html).toContain('HTTP reachability only');
    expect(html).not.toContain(body);
    expect(readFileSync(join(temp, 'dist/docs/inventory/observed.html'), 'utf8')).not.toContain('outside-inventory-scope');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(temp, { recursive: true, force: true }); }
}, 60000);
