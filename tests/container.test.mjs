import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fixtureEnvironment } from './fixture-env.mjs';

const poll = readFileSync(new URL('../deploy/poll.sh', import.meta.url), 'utf8');
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(condition, milliseconds = 15000) {
  const limit = Date.now() + milliseconds;
  while (!condition()) {
    if (Date.now() > limit) throw new Error('Scheduler did not reach expected state');
    await pause();
  }
}
test('container has no host control access and only dedicated writable mounts', () => {
  const compose = readFileSync(new URL('../compose.yaml', import.meta.url), 'utf8');
  const image = readFileSync(new URL('../deploy/Dockerfile', import.meta.url), 'utf8');
  for (const text of ['read_only: true', 'cap_drop: [ALL]', 'no-new-privileges:true', 'user:', 'init: true', '/run/ssh:ro']) expect(compose).toContain(text);
  for (const text of ['docker.sock', 'privileged:', 'ports:', '/home/', 'pid: host', 'network_mode: host']) expect(compose).not.toContain(text);
  expect(image).toContain('USER ${PUBLISH_UID}:${PUBLISH_GID}');
  expect(image).toContain('getent passwd "$PUBLISH_UID"');
  expect(compose).toContain('PUBLISH_UID: ${PUBLISH_UID:-1000}');
  expect(compose).toContain('PUBLISH_GID: ${PUBLISH_GID:-1000}');
  expect(image).toContain('sha256:');
  expect(poll).not.toContain('apt-get');
  expect(poll).not.toContain('systemctl');
  expect(image).not.toContain('python');
  expect(image).not.toContain('jq');
  expect(compose).toContain('${STATE_PATH:-./state}:/state');
  expect(compose).toContain('${PUBLISH_PATH:-./published}:/publish');
  expect(image).toContain('bun add --exact --ignore-scripts @fwdslsh/unify@0.11.0');
});
test('invalid poll intervals are rejected', () => {
  for (const interval of ['0', '9', '121', 'not-a-number']) {
    const result = spawnSync('bash', ['-c', poll], { env: { ...fixtureEnvironment(), POLL_SECONDS: interval }, encoding: 'utf8' });
    expect(result.status).toBe(2);
  }
});
test('polling retries a failed check, marks only success, and stops promptly', async () => {
  const root = mkdtempSync(join(tmpdir(), 'reports-poll.'));
  const fake = join(root, 'deploy.sh');
  const runner = join(root, 'poll.sh');
  writeFileSync(fake, '#!/bin/bash\necho call >> "$STATE_DIR/calls"\n[ "$(wc -l < "$STATE_DIR/calls")" -gt 1 ]\n');
  writeFileSync(runner, poll.replace('/app/scripts/deploy.sh', fake));
  const child = spawn('bash', [runner], { env: { ...fixtureEnvironment(), STATE_DIR: root, POLL_SECONDS: '10' }, stdio: 'ignore' });
  let exited = false;
  child.on('exit', () => { exited = true; });
  try {
    await until(() => existsSync(join(root, 'calls')));
    expect(existsSync(join(root, 'last-check-ok'))).toBe(false);
    await until(() => existsSync(join(root, 'last-check-ok')));
    expect(Number(readFileSync(join(root, 'last-check-ok'), 'utf8'))).toBeGreaterThan(0);
    child.kill('SIGTERM');
    await until(() => exited, 2000);
  } finally {
    child.kill('SIGKILL');
    await until(() => exited, 2000);
    rmSync(root, { recursive: true, force: true });
  }
}, 20000);
