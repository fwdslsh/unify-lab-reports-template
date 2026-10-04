#!/usr/bin/env python3
"""Narrow health retention. Default is a preview; --apply mutates sources.

Only timestamped configured-prefix spot/review files directly in reports/ or health/
qualify. --commit checkpoints new snapshots before deletion and commits only
managed changes. Incidents, articles, unknown files and symlinks never qualify.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import re
import subprocess
from zoneinfo import ZoneInfo
from settings import load

CONFIG = load()
NAME = re.compile(r'^' + re.escape(CONFIG['REPORTS_HEALTH_PREFIX']) + r'-(spot|review)-(\d{14})\.(md|html)$')
POLICY = {'spot': 0, 'review': CONFIG['REPORTS_WEEKLY_KEEP']}
LOCAL_TIMEZONE = ZoneInfo(CONFIG['REPORTS_TIMEZONE'])

def git(root, *args):
    return subprocess.run(['git', '-C', str(root), *args], check=True,
                          capture_output=True, text=True).stdout.strip()

def committed(root, path):
    proc = subprocess.run(['git', '-C', str(root), 'cat-file', '-e',
                           'HEAD:' + str(path.relative_to(root))], capture_output=True)
    return proc.returncode == 0

def commit_paths(repo, paths, message):
    names = sorted({str(p.relative_to(repo)) for p in paths})
    if not names:
        return
    git(repo, 'add', '-A', '--', *names)
    changed = git(repo, 'diff', '--cached', '--name-only', '--', *names)
    if changed:
        git(repo, 'commit', '--only', '-m', message, '--', *names)

def report_date(path, match):
    text = path.read_text(encoding='utf-8')
    if text.startswith('---\n'):
        header = text.split('\n---', 1)[0]
        field = re.search(r'^date:\s*[\"\']?([^\"\'\n]+)', header, re.M)
        if field:
            value = datetime.fromisoformat(field[1].strip().replace('Z', '+00:00'))
            return value.replace(tzinfo=LOCAL_TIMEZONE) if value.tzinfo is None else value
    return datetime.strptime(match[2], '%Y%m%d%H%M%S').replace(tzinfo=LOCAL_TIMEZONE)

def plan(root, now):
    root = Path(root).absolute()
    health = root / 'health'
    if root.is_symlink() or health.is_symlink():
        raise ValueError('Report source and health directory must not be symlinks')
    groups = {}
    ignored = []
    for folder in (root, health):
        if not folder.exists():
            continue
        for path in sorted(folder.iterdir()):
            match = NAME.fullmatch(path.name)
            if not match or not path.is_file() or path.is_symlink():
                continue
            try:
                date = report_date(path, match)
            except (ValueError, UnicodeError):
                ignored.append(str(path.relative_to(root)))
                continue
            if date > now + timedelta(minutes=5):
                ignored.append(str(path.relative_to(root)))
                continue
            key = (match[1], match[2])
            group = groups.setdefault(key, {'date': date, 'paths': []})
            group['date'] = max(group['date'], date)
            group['paths'].append(path)
    keep, delete = [], []
    for kind, limit in POLICY.items():
        ordered = sorted(((key, value) for key, value in groups.items() if key[0] == kind),
                         key=lambda entry: entry[1]['date'], reverse=True)
        for number, (_, group) in enumerate(ordered):
            destination = keep if number < limit else delete
            destination.extend(group['paths'])
    moves = [(path, health / path.name) for path in keep if path.parent == root]
    for old, new in moves:
        if new.exists() or new.is_symlink():
            raise ValueError(f'Migration collision: {new.name}; no files changed')
    return keep, delete, moves, ignored

def apply(root, now, commit=False):
    root = Path(root).absolute()
    repo = Path(git(root, 'rev-parse', '--show-toplevel'))
    keep, delete, moves, ignored = plan(root, now)
    selected = keep + delete
    # Never erase modified tracked snapshots, even though their names qualify.
    for path in selected:
        if committed(repo, path):
            name = str(path.relative_to(repo))
            if git(repo, 'diff', 'HEAD', '--', name):
                raise ValueError(f'Modified snapshot must be reviewed first: {name}')
    if commit:
        commit_paths(repo, selected, 'Checkpoint new health snapshots')
    for path in delete:
        if not committed(repo, path):
            raise ValueError(f'Uncommitted snapshot will not be deleted: {path.name}')
    (root / 'health').mkdir(exist_ok=True)
    for old, new in moves:
        old.rename(new)
    for path in delete:
        path.unlink()
    changed = delete + [old for old, _ in moves] + [new for _, new in moves]
    if commit:
        commit_paths(repo, changed, 'Apply bounded health report retention')
    return {'retained_files': len(keep), 'deleted_files': len(delete),
            'moved_files': len(moves), 'ignored_dates': ignored}

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--root', type=Path, default=Path(__file__).resolve().parent.parent / 'site')
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--commit', action='store_true')
    ap.add_argument('--now', help='ISO timestamp for deterministic previews/tests')
    args = ap.parse_args()
    args.root = args.root.absolute()
    now = datetime.fromisoformat(args.now.replace('Z', '+00:00')) if args.now else datetime.now(timezone.utc)
    if now.tzinfo is None:
        ap.error('--now must have a timezone')
    try:
        if args.apply:
            result = apply(args.root, now, args.commit)
        else:
            keep, delete, moves, ignored = plan(args.root, now)
            result = {'retained_files': len(keep),
                      'delete': [str(p.relative_to(args.root)) for p in delete],
                      'move': [str(p.relative_to(args.root)) for p, _ in moves],
                      'ignored_dates': ignored}
        print(json.dumps(result, indent=2))
    except (ValueError, subprocess.CalledProcessError) as error:
        ap.exit(1, f'Health retention stopped safely: {error}\n')

if __name__ == '__main__':
    main()
