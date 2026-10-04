import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readlinkSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fixtureEnvironment } from './fixture-env.mjs';

const script = fileURLToPath(new URL('../scripts/deploy.sh', import.meta.url));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'reports-deploy-test.'));
  const repo = join(root, 'author');
  mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Deployment test');
  git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(repo, 'config.json'), '{}');
  const fake = join(root, 'bun');
  writeFileSync(fake, `#!/usr/bin/env bash
set -eu
if [ "$1" = install ]; then exit 0; fi
[ ! -f fail-build ] || exit 1
out="\${@: -1}"
for page in index status sitemap; do cp page.html "$out/$page.html"; done
mkdir -p "$out/reports"
cp page.html "$out/reports/index.html"
printf 'body { color: green; }' > "$out/styles.css"
`, { mode: 0o755 });
  const commit = (text) => {
    writeFileSync(join(repo, 'page.html'), text);
    git('add', '-A'); git('commit', '-qm', text);
    return git('rev-parse', 'HEAD');
  };
  const env = { ...fixtureEnvironment(), REPO_URL: repo, STATE_DIR: join(root, 'state'), PUBLISH_DIR: join(root, 'public'), BUN: fake };
  const run = () => spawnSync('bash', [script], { env, encoding: 'utf8' });
  const publicFile = (name = 'index.html') => readFileSync(join(env.PUBLISH_DIR, 'current', name), 'utf8');
  return { root, repo, git, commit, env, run, publicFile, close: () => rmSync(root, { recursive: true, force: true }) };
}

test('new revisions publish atomically, unchanged revisions do not rebuild, and reverts work', () => {
  const f = fixture();
  try {
    const first = f.commit('first site');
    assert.equal(f.run().status, 0);
    assert.equal(f.publicFile(), 'first site');
    assert.equal(JSON.parse(f.publicFile('deployment.json')).revision, first);
    const unchanged = f.run();
    assert.equal(unchanged.status, 0);
    assert.equal(unchanged.stdout, '');
    const second = f.commit('second site');
    assert.equal(f.run().status, 0);
    assert.equal(f.publicFile(), 'second site');
    assert.ok(readlinkSync(join(f.env.PUBLISH_DIR, 'current')).startsWith('_releases/' + second + '-'));
    f.git('revert', '--no-edit', 'HEAD');
    assert.equal(f.run().status, 0);
    assert.equal(f.publicFile(), 'first site');
    assert.equal(readdirSync(join(f.env.PUBLISH_DIR, '_releases')).length, 2);
  } finally { f.close(); }
});

test('failed build and failed fetch retain the served revision and remove only temporary artifacts', () => {
  const f = fixture();
  try {
    const first = f.commit('good site');
    assert.equal(f.run().status, 0);
    writeFileSync(join(f.repo, 'fail-build'), 'intentional fixture failure');
    f.commit('bad site');
    assert.notEqual(f.run().status, 0);
    assert.equal(f.publicFile(), 'good site');
    assert.equal(JSON.parse(f.publicFile('deployment.json')).revision, first);
    assert.equal(readdirSync(join(f.env.PUBLISH_DIR, '_releases')).length, 1);
    assert.equal(readdirSync(f.env.STATE_DIR).some(name => name.startsWith('build.')), false);
    f.env.REPO_URL = join(f.root, 'missing-origin');
    assert.notEqual(f.run().status, 0);
    assert.equal(f.publicFile(), 'good site');
    assert.equal(existsSync(join(f.repo, 'page.html')), true);
  } finally { f.close(); }
});

test('missing required output cannot replace a working site', () => {
  const f = fixture();
  try {
    f.commit('good site'); assert.equal(f.run().status, 0);
    writeFileSync(f.env.BUN, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    f.commit('incomplete site');
    assert.notEqual(f.run().status, 0);
    assert.equal(f.publicFile(), 'good site');
  } finally { f.close(); }
});

test('one config file changes publication; unrelated environment does not', () => {
  const f = fixture();
  try {
    const revision = f.commit('same source');
    assert.equal(f.run().status, 0);
    const original = readlinkSync(join(f.env.PUBLISH_DIR, 'current'));
    f.env.CONFIG_FILE = join(f.root, 'config.json');
    writeFileSync(f.env.CONFIG_FILE, '{"site":{"brand":"Alternate lab"}}');
    assert.equal(f.run().status, 0);
    const configured = readlinkSync(join(f.env.PUBLISH_DIR, 'current'));
    assert.notEqual(configured, original);
    assert.ok(configured.startsWith('_releases/' + revision + '-'));
    assert.equal(JSON.parse(f.publicFile('deployment.json')).revision, revision);
    assert.equal(f.run().stdout, '');
    f.env.UNRELATED_SECRET = 'not-an-input';
    assert.equal(f.run().stdout, '');
    writeFileSync(f.env.BUN, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    writeFileSync(f.env.CONFIG_FILE, '{"site":{"brand":"Another lab"}}');
    assert.notEqual(f.run().status, 0);
    assert.equal(readlinkSync(join(f.env.PUBLISH_DIR, 'current')), configured);
    assert.equal(f.publicFile(), 'same source');
  } finally { f.close(); }
});
