// Preview by default. Only explicitly managed, Git-recoverable health snapshots qualify.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { resolve, join, relative, dirname, basename } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { loadConfig, ROOT } from './config.mjs';
import { isoDate } from './html.mjs';

export const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const symlink = path => { try { return lstatSync(path).isSymbolicLink(); } catch { return false; } };
function localDate(value, timezone) {
  isoDate(value);
  if (/(Z|[+-]\d\d:\d\d)$/.test(value)) return new Date(value);
  const desired = value.length === 10 ? value + 'T00:00:00' : value;
  const civil = date => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const get = key => parts.find(p => p.type === key).value;
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
  };
  const target = new Date(desired + 'Z').getTime();
  let result = new Date(target);
  for (let i = 0; i < 3; i++) result = new Date(result.getTime() + target - Date.parse(civil(result) + 'Z'));
  // Preserve ambiguous/nonexistent civil dates rather than guessing across DST.
  if (civil(result) !== desired.slice(0, 19) || [-3600000, 3600000].some(delta => civil(new Date(result.getTime() + delta)) === civil(result))) throw new Error('Ambiguous local date; use an explicit timezone offset');
  return result;
}
export function plan(root, now, reports = loadConfig().reports) {
  root = resolve(root);
  const health = join(root, 'health');
  if (symlink(root) || symlink(health)) throw new Error('Report source and health directory must not be symlinks');
  const pattern = new RegExp('^' + reports.prefix + '-(spot|review)-(\\d{14})\\.(md|html)$'), groups = new Map(), ignored = [];
  for (const folder of [root, health]) {
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name), match = pattern.exec(name);
      if (!match || !lstatSync(path).isFile() || symlink(path)) continue;
      let date;
      try {
        const text = readFileSync(path, 'utf8');
        const field = text.startsWith('---\n') ? /^date:\s*["']?([^"'\n]+)/m.exec(text.split('\n---')[0]) : null;
        const s = match[2], value = field ? field[1].trim() : `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}`;
        date = localDate(value, reports.timezone);
        if (date - now > 300000) throw new Error('Future report');
      } catch { ignored.push(relative(root, path)); continue; }
      const key = match[1] + match[2], group = groups.get(key) ?? { kind: match[1], date, paths: [] };
      if (date > group.date) group.date = date;
      group.paths.push(path); groups.set(key, group);
    }
  }
  const keep = [], remove = [];
  for (const [kind, limit] of [['spot', 0], ['review', reports.weeklyKeep]]) {
    [...groups.values()].filter(g => g.kind === kind).sort((a, b) => b.date - a.date).forEach((group, i) => (i < limit ? keep : remove).push(...group.paths));
  }
  const moves = keep.filter(path => dirname(path) === root).map(path => [path, join(health, basename(path))]);
  if (moves.some(([, target]) => existsSync(target) || symlink(target))) throw new Error('Migration collision; no files changed');
  return { keep, remove, moves, ignored };
}
export function apply(root, now, commit = false, reports = loadConfig().reports) {
  root = resolve(root);
  const repo = git(root, 'rev-parse', '--show-toplevel'), selected = plan(root, now, reports);
  const committed = path => spawnSync('git', ['-C', repo, 'cat-file', '-e', 'HEAD:' + relative(repo, path)], { stdio: 'ignore' }).status === 0;
  const commitPaths = (paths, message) => {
    const names = [...new Set(paths.map(p => relative(repo, p)))].sort();
    if (!names.length) return;
    git(repo, 'add', '-A', '--', ...names);
    if (git(repo, 'diff', '--cached', '--name-only', '--', ...names)) git(repo, 'commit', '--only', '-m', message, '--', ...names);
  };
  for (const path of [...selected.keep, ...selected.remove]) if (committed(path) && git(repo, 'diff', 'HEAD', '--', relative(repo, path))) throw new Error('Modified snapshot must be reviewed first: ' + relative(repo, path));
  if (commit) commitPaths([...selected.keep, ...selected.remove], 'Checkpoint new health snapshots');
  if (selected.remove.some(path => !committed(path))) throw new Error('Uncommitted snapshot will not be deleted');
  mkdirSync(join(root, 'health'), { recursive: true });
  for (const [from, to] of selected.moves) renameSync(from, to);
  for (const path of selected.remove) unlinkSync(path);
  if (commit) commitPaths([...selected.remove, ...selected.moves.flat()], 'Apply bounded health report retention');
  return { retained_files: selected.keep.length, deleted_files: selected.remove.length, moved_files: selected.moves.length, ignored_dates: selected.ignored };
}
if (import.meta.main) {
  const { values } = parseArgs({ options: { root: { type: 'string' }, apply: { type: 'boolean' }, commit: { type: 'boolean' }, now: { type: 'string' } }, strict: true });
  const root = resolve(values.root ?? join(ROOT, 'site')), now = new Date(values.now ?? Date.now());
  if (!Number.isFinite(now.getTime()) || values.now && !/(Z|[+-]\d\d:\d\d)$/.test(values.now)) throw new Error('--now needs an ISO timestamp with timezone');
  const selected = values.apply ? apply(root, now, values.commit) : plan(root, now);
  console.log(JSON.stringify(values.apply ? selected : { retained_files: selected.keep.length, delete: selected.remove.map(p => relative(root, p)), move: selected.moves.map(([from]) => relative(root, from)), ignored_dates: selected.ignored }, null, 2));
}
