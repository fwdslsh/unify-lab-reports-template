import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plan as rawPlan, apply as rawApply, git } from '../scripts/retain-health.mjs';
import { validateConfig } from '../scripts/config.mjs';
const fixturePolicy = validateConfig({}).reports;
const plan = (root, now, reports = fixturePolicy) => rawPlan(root, now, reports);
const apply = (root, now, commit = false, reports = fixturePolicy) => rawApply(root, now, commit, reports);
const now = new Date('2026-10-01T18:00:00Z');
function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'retention.')), root = join(repo, 'reports'); mkdirSync(root);
  git(repo, 'init', '-q'); git(repo, 'config', 'user.name', 'Fixture'); git(repo, 'config', 'user.email', 'fixture@example.invalid'); git(repo, 'commit', '--allow-empty', '-qm', 'fixture');
  const file = (name, date = '2026-09-30T12:00:00Z') => { const path = join(root, name); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, `---\ndate: ${date}\n---\n# Fixture\n`); return path; };
  return { repo, root, file, close: () => rmSync(repo, { recursive: true, force: true }) };
}
test('two weekly snapshots and no spots, counting HTML/Markdown twins as one', () => {
  const f = fixture();
  try {
    for (let hour = 0; hour < 4; hour++) for (const ext of ['md', 'html']) f.file(`health/lab-review-202609300${hour}0000.${ext}`, `2026-09-30T0${hour}:00:00Z`);
    const spot = f.file('lab-spot-20260101000000.md', '2026-01-01T00:00:00Z'), selected = plan(f.root, now);
    expect(selected.keep).toHaveLength(4); expect(selected.remove).toHaveLength(5); expect(selected.remove).toContain(spot);
  } finally { f.close(); }
});
test('articles, incidents, unknown files and symlinks are untouched', () => {
  const f = fixture();
  try {
    for (const path of ['articles/lab-review-20260101000000.md', 'incidents/lab-spot-20260101000000.md', 'health/unknown.md', 'model-ledger.html']) f.file(path);
    symlinkSync(join(f.root, 'health/unknown.md'), join(f.root, 'health/lab-spot-20260102000000.md'));
    expect(plan(f.root, now).remove).toEqual([]);
    const alias = join(f.repo, 'alias'); symlinkSync(f.root, alias); expect(() => plan(alias, now)).toThrow('symlinks');
  } finally { f.close(); }
});
test('collisions and invalid/future dates fail safely before mutation', () => {
  const f = fixture();
  try {
    f.file('health/lab-review-20261010000000.md', '2026-10-10T00:00:00Z'); f.file('health/lab-review-20261011000000.md', 'not-a-date');
    expect(plan(f.root, now).ignored).toHaveLength(2);
    f.file('lab-review-20260930000000.md'); f.file('health/lab-review-20260930000000.md'); expect(() => plan(f.root, now)).toThrow('collision');
  } finally { f.close(); }
});
test('checkpoint/delete/move preserves unrelated staging and is idempotent', () => {
  const f = fixture();
  try {
    const old = f.file('lab-spot-20260101000000.md', '2026-01-01T00:00:00Z'); f.file('lab-review-20260930000000.md');
    writeFileSync(join(f.repo, 'unrelated.txt'), 'keep'); git(f.repo, 'add', 'unrelated.txt');
    expect(apply(f.root, now, true).deleted_files).toBe(1); expect(existsSync(old)).toBe(false);
    expect(git(f.repo, 'show', 'HEAD~1:reports/lab-spot-20260101000000.md')).toContain('Fixture');
    expect(git(f.repo, 'diff', '--cached', '--name-only')).toBe('unrelated.txt'); expect(apply(f.root, now, true).moved_files).toBe(0);
  } finally { f.close(); }
});
test('modified and uncommitted snapshots cannot be erased', () => {
  const f = fixture();
  try {
    const old = f.file('health/lab-spot-20260101000000.md', '2026-01-01T00:00:00Z'); expect(() => apply(f.root, now)).toThrow('Uncommitted');
    git(f.repo, 'add', '.'); git(f.repo, 'commit', '-qm', 'snapshot'); writeFileSync(old, readFileSync(old, 'utf8') + 'user edit\n');
    expect(() => apply(f.root, now, true)).toThrow('Modified'); expect(existsSync(old)).toBe(true);
  } finally { f.close(); }
});
test('custom prefix, timezone and weekly cap come from the same config', () => {
  const f = fixture();
  try {
    for (let day = 1; day <= 4; day++) f.file(`my-lab-review-2026090${day}000000.md`, `2026-09-0${day}T00:00:00`);
    f.file('lab-review-20260901000000.md');
    const selected = plan(f.root, now, { prefix: 'my-lab', weeklyKeep: 3, timezone: 'America/Chicago' });
    expect(selected.keep).toHaveLength(3); expect(selected.remove).toHaveLength(1); expect(selected.moves).toHaveLength(3);
  } finally { f.close(); }
});
